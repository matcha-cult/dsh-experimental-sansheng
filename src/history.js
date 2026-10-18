/**
 * Case-level detailed history projection.
 *
 * This projection is mounted for every session but only the Lead session's
 * view is rendered by the board. It folds user/assistant text, tool calls,
 * tool results and teammate inbox deliveries into a bounded, replay-safe
 * chronological log. Assistant reasoning blocks are deliberately excluded:
 * the log is an audit trail, not a copy of DSH's Trajectory.
 *
 * No custom session event is ever appended; every entry is derived from one
 * of the host's existing event types, so restart/fork/compaction rebuild the
 * same log.
 *
 * @module dsh-experimental-sansheng/history
 */

/** Maximum retained entries (oldest are dropped first). */
export const DETAIL_MAX_ENTRIES = 240
/** Maximum retained characters across all titles/details. */
export const DETAIL_MAX_CHARS = 120000
/** Maximum characters in one entry title/detail. */
const MAX_TITLE_CHARS = 160
const MAX_DETAIL_CHARS = 1200

/**
 * @returns {{entries: Array<object>, dropped: number, totalChars: number, updatedAt: number|null}} Empty state.
 */
export function createHistoryState() {
  return { entries: [], dropped: 0, totalChars: 0, updatedAt: null }
}

/**
 * Clamp one string and report its normalized length.
 * @param {unknown} value Raw value.
 * @param {number} max Maximum characters.
 * @returns {string} Clamped string.
 */
function clamp(value, max) {
  const text = typeof value === 'string' ? value : ''
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

/**
 * Extract text blocks from an OpenAI-style content array.
 * @param {unknown} content Content blocks.
 * @returns {string} Concatenated text.
 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
}

/**
 * @param {object} entry New entry to append.
 * @param {object} state Current history state.
 * @returns {object} Bounded state.
 */
function appendEntry(state, entry) {
  const entries = [...state.entries, entry]
  let dropped = state.dropped
  let totalChars = state.totalChars + entry.title.length + entry.detail.length
  while (entries.length > DETAIL_MAX_ENTRIES || totalChars > DETAIL_MAX_CHARS) {
    const removed = entries.shift()
    totalChars -= removed.title.length + removed.detail.length
    dropped += 1
    if (entries.length === 0) break
  }
  return { entries, dropped, totalChars, updatedAt: entry.at ?? state.updatedAt }
}

/**
 * Scan recent entries for the name of the call this result belongs to.
 * @param {Array<object>} entries Existing entries.
 * @param {string} callId Tool call id.
 * @returns {string|undefined} Tool name.
 */
function findCallName(entries, callId) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.kind === 'tool-call' && entry.callId === callId) return entry.tool
  }
  return undefined
}

/**
 * Harness-injected user-role context (runtime snapshot, time sample,
 * compaction summary, skill catalog) is not human input and should not appear
 * in the case's detailed history.
 * @param {string} text Candidate user text.
 * @returns {boolean} True for synthetic harness context.
 */
function isSyntheticUserText(text) {
  const value = text.trimStart()
  return value.startsWith('<system-reminder>')
    || value.startsWith('<available_skills>')
    || value.startsWith('Current runtime context.')
    || value.startsWith('Time sampled while preparing turn')
    || value.startsWith('This is an automatically generated checkpoint')
    || value.startsWith('The available skill catalog changed.')
}

/**
 * @param {object} state Current state.
 * @param {string} text Candidate user/inbox text.
 * @returns {boolean} True when the same text was just recorded.
 */
function isDuplicateMessage(state, text) {
  const normalized = text.trim()
  if (normalized === '') return true
  const recent = state.entries.slice(-10)
  return recent.some((entry) => (entry.kind === 'user' || entry.kind === 'inbox') && entry.detail === normalized)
}

/**
 * Fold one session event into the detailed history.
 * @param {object} state Current history state.
 * @param {object} event Append-only session event.
 * @returns {object} Next history state.
 */
export function foldHistoryEvent(state, event) {
  const type = event?.type
  const at = Number.isInteger(event?.time) && event.time > 0 ? event.time : state.updatedAt
  const seq = state.entries.length + state.dropped + 1
  let entry = null

  if (type === 'user/message') {
    const text = clamp(contentText(event.data?.content), MAX_DETAIL_CHARS)
    if (text !== '' && !isSyntheticUserText(text) && !isDuplicateMessage(state, text)) {
      entry = { id: `h-${seq}`, seq, at, kind: 'user', title: clamp(text.split('\n')[0], MAX_TITLE_CHARS), detail: text }
    }
  } else if (type === 'agent/inbox/spliced') {
    const inserted = Array.isArray(event.data?.inserted) ? event.data.inserted : []
    const text = clamp(inserted.map((item) => contentText(item?.content)).filter((part) => part !== '').join('\n\n'), MAX_DETAIL_CHARS)
    if (text !== '' && !isDuplicateMessage(state, text)) {
      entry = { id: `h-${seq}`, seq, at, kind: 'inbox', title: '团队来信', detail: text }
    }
  } else if (type === 'assistant/message') {
    const text = clamp(contentText(event.data?.message?.content), MAX_DETAIL_CHARS)
    if (text !== '') {
      entry = { id: `h-${seq}`, seq, at, kind: 'assistant', title: clamp(text.split('\n')[0], MAX_TITLE_CHARS), detail: text }
    }
  } else if (type === 'tool/call') {
    const tool = typeof event.data?.name === 'string' ? event.data.name : 'tool'
    const args = clamp(event.data?.arguments, MAX_DETAIL_CHARS)
    entry = {
      id: `h-${seq}`,
      seq,
      at,
      kind: 'tool-call',
      tool,
      callId: typeof event.data?.callId === 'string' ? event.data.callId : undefined,
      title: tool,
      detail: args,
    }
  } else if (type === 'tool/result') {
    const message = event.data?.message
    const callId = typeof message?.toolCallId === 'string'
      ? message.toolCallId
      : typeof message?.source?.callId === 'string' ? message.source.callId : undefined
    const tool = findCallName(state.entries, callId) ?? 'tool'
    const isError = message?.isError === true
    const text = clamp(contentText(message?.content), MAX_DETAIL_CHARS)
    entry = {
      id: `h-${seq}`,
      seq,
      at,
      kind: 'tool-result',
      tool,
      callId,
      isError,
      title: `${tool} ${isError ? '失败' : '返回'}`,
      detail: text === '' ? (isError ? 'error' : 'ok') : text,
    }
  }

  return entry === null ? state : appendEntry(state, entry)
}

/**
 * 三省六部 (Sān Shěng Liù Bù) — pure policy layer.
 *
 * This module owns everything that can be decided without a runtime: the
 * append-only board state fold, the hard-gate validators, and compact board
 * summaries. It imports nothing, so `node --test` can exercise it directly.
 *
 * Naming note: 省 here means a government department and is read **shěng**
 * (Sān Shěng Liù Bù), never *xǐng*.
 */

/** Maximum teammate count per task tier. The Lead is never counted. */
export const TIERS = Object.freeze({ small: 0, medium: 5, large: 9 })

/** Absolute roster cap accepted regardless of tier (matches the skill's hard limit). */
export const MAX_ROSTER_CAP = 16

/** The six executing ministries (六部). Appointments are scoped to these. */
export const DEPARTMENT_NAMES = Object.freeze(['吏部', '户部', '礼部', '兵部', '刑部', '工部'])

/** The two independent review gates (门下省). */
export const GATE_KINDS = Object.freeze(['plan', 'result'])

/**
 * Protocol marker for one 三省六部 record carried by a tool result or a
 * teammate message. Tool results carry the bare JSON envelope; teammate
 * messages prefix this marker so the Lead can tell the record apart from prose.
 */
export const RECORD_MARKER = 'SANS_RECORD_V1'

/** Record envelope version. */
export const RECORD_VERSION = 1

/** Record operations the board fold understands. */
export const RECORD_OPS = Object.freeze(['mode', 'edict', 'appoint', 'gate', 'evidence', 'close', 'board'])


/** Deployment-owned default guidance rendered while the mode is active. */
export const DEFAULT_SECTION = `You are in 三省六部 mode (Sān Shěng Liù Bù — "Three Departments and Six Ministries"), for complex multi-deliverable work. Follow the three-departments-six-ministries skill for the full procedure; this section only states the enforced state machine.

Procedure (all state is recorded in this session's event log — never coordinate through files or temp directories):
1. 政事堂 (Lead) drafts the edict: sansheng_edict {goal, acceptance, boundaries, tier, roster_cap, departments}.
2. 门下省 reviews the plan: an independent teammate calls sansheng_gate {kind: "plan", verdict}. The Lead can never approve its own plan.
3. Only after the plan gate passes: sansheng_appoint each teammate to one of the 六部, then create team tasks and spawn teammates.
4. 六部 execute. 刑部 submits reproducible evidence with sansheng_evidence {task_id, command, exit_code, digest?, excerpt?}.
5. 门下省 reviews the result: a teammate not appointed to any 部 calls sansheng_gate {kind: "result", verdict}.
6. Only after both gates pass and every completed task has evidence, the Lead calls sansheng_close and reports the result.

Hard gates enforced by the tools: appointing before the plan gate passes is rejected; self-review is rejected; closing before both gates pass is rejected. Never claim completion before sansheng_close returns. Use sansheng_board for the current board state.`

/** One typed failure from the 三省六部 policy layer. */
export class SanshengError extends Error {
  /**
   * @param {string} code Stable machine-readable failure code.
   * @param {string} message Human/model-readable explanation.
   */
  constructor(code, message) {
    super(message)
    this.name = 'SanshengError'
    this.code = code
  }
}

/**
 * @param {string} code Stable failure code.
 * @param {string} message Explanation.
 * @returns {never}
 */
function fail(code, message) {
  throw new SanshengError(code, `${code}: ${message}`)
}

/** @returns {boolean} whether a value is a 三省六部 policy failure. */
export function isSanshengError(value) {
  return value instanceof SanshengError
}

/**
 * Initial board state for one session. A session composed from the 三省六部
 * agent preset starts with the mode active; every other session starts
 * inactive and enters explicitly. The header is durable, so resume and fork
 * keep the preset-derived default.
 * @param {{agentPreset?: string}|undefined} header Session header.
 * @param {string} presetId Preset identity that implies the mode.
 * @returns {object} Initial board state.
 */
export function createInitialState(header, presetId) {
  const state = createEmptyState()
  if (typeof presetId === 'string' && presetId !== '' && header?.agentPreset === presetId) {
    state.active = true
  }
  return state
}

/** @returns {object} the empty board state before any event. */
export function createEmptyState() {
  return {
    active: false,
    edict: null,
    appointments: [],
    gates: [],
    evidence: [],
    closure: null,
    revision: 0,
  }
}

/**
 * Serialize one record envelope for a tool result (bare JSON, no marker).
 * @param {string} op Record operation.
 * @param {object} payload Record payload.
 * @returns {string} JSON text.
 */
export function serializeRecord(op, payload) {
  return JSON.stringify({ sansheng: RECORD_VERSION, op, ...payload })
}

/**
 * Serialize one record for a Teammate-to-Lead message. The marker lets the
 * Lead's projection find the record inside the message without confusing it
 * with ordinary prose.
 * @param {string} op Record operation.
 * @param {object} payload Record payload.
 * @returns {string} Marked message text.
 */
export function serializeMessageRecord(op, payload) {
  return `${RECORD_MARKER} ${serializeRecord(op, payload)}`
}

/**
 * Parse a record envelope out of a tool-result text or a teammate message.
 * Accepts both the bare JSON form and the marked message form; anything else
 * is ignored. Replay must stay total, so this never throws.
 * @param {unknown} text Candidate text.
 * @returns {object|null} Parsed record or null.
 */
export function parseRecordText(text) {
  if (typeof text !== 'string') return null
  const at = text.indexOf(RECORD_MARKER)
  const candidate = (at >= 0 ? text.slice(at + RECORD_MARKER.length) : text).trim()
  if (candidate.startsWith('{') === false) return null
  let record
  try {
    record = JSON.parse(candidate)
  } catch {
    return null
  }
  if (record === null || typeof record !== 'object') return null
  if (record.sansheng !== RECORD_VERSION) return null
  if (typeof record.op !== 'string') return null
  return record
}

/**
 * Apply one record envelope to the board state.
 * @param {object} state Previous board state.
 * @param {object} record Parsed record envelope.
 * @returns {object} Next board state.
 */
export function applyRecord(state, record) {
  if (record === null || typeof record !== 'object') return state
  switch (record.op) {
    case 'mode':
      return typeof record.active === 'boolean' ? commit(state, { active: record.active }) : state
    case 'edict': {
      const edict = normalizeStoredEdict(record.edict)
      return edict === null ? state : commit(state, { edict })
    }
    case 'appoint': {
      const appointment = normalizeStoredAppointment(record.appointment)
      return appointment === null ? state : commit(state, { appointments: [...state.appointments, appointment] })
    }
    case 'gate': {
      const gate = normalizeStoredGate(record.gate)
      return gate === null ? state : commit(state, { gates: [...state.gates, gate] })
    }
    case 'evidence': {
      const evidence = normalizeStoredEvidence(record.evidence)
      return evidence === null ? state : commit(state, { evidence: [...state.evidence, evidence] })
    }
    case 'close': {
      const closure = normalizeStoredClosure(record.closure)
      return closure === null ? state : commit(state, { closure })
    }
    default:
      return state
  }
}

/**
 * Apply one committed session event to the board state. The board derives from
 * two DSH event families only, so resume, fork, and compaction stay safe:
 * - `tool/result` — a Lead-side `sansheng_*` tool returned one record envelope;
 * - `user/message` — a teammate published one marked record to the Lead.
 * Unknown events and malformed payloads are ignored: replay must stay total so
 * a projection failure can never hide the rest of the board.
 *
 * @param {object} state Previous board state.
 * @param {{type?: string, data?: unknown}} event Committed session event.
 * @param {string} [presetId] Preset identity that implies the mode.
 * @returns {object} Next board state (new object per applied record).
 */
export function foldEvent(state, event, presetId) {
  const type = event?.type
  if (type === 'agent-preset/selected') {
    const selected = event?.data?.agentPreset
    if (typeof selected !== 'string') return state
    return commit(state, { active: typeof presetId === 'string' && presetId !== '' && selected === presetId })
  }
  if (type === 'tool/result') {
    if (event.data?.message?.isError === true) return state
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return state
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const record = parseRecordText(block.text)
      if (record !== null) return applyRecord(state, record)
    }
    return state
  }
  if (type === 'user/message') {
    const content = event.data?.content
    if (!Array.isArray(content)) return state
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const record = parseRecordText(block.text)
      if (record !== null) return applyRecord(state, record)
    }
  }
  return state
}

/**
 * Replace selected fields and bump the projection revision.
 * @param {object} state Previous state.
 * @param {object} patch Fields to replace.
 * @returns {object} Next state.
 */
function commit(state, patch) {
  return { ...state, ...patch, revision: (state.revision ?? 0) + 1 }
}

/**
 * Latest gate of one kind; later verdicts override earlier ones.
 * @param {object} state Board state.
 * @param {'plan'|'result'} kind Gate kind.
 * @returns {object|undefined} The latest gate record.
 */
export function latestGate(state, kind) {
  for (let index = state.gates.length - 1; index >= 0; index -= 1) {
    if (state.gates[index].kind === kind) return state.gates[index]
  }
  return undefined
}

/**
 * Distinct appointed teammate names.
 * @param {object} state Board state.
 * @returns {string[]} Unique member names in appointment order.
 */
export function appointedMembers(state) {
  const names = []
  for (const appointment of state.appointments) {
    if (!names.includes(appointment.member)) names.push(appointment.member)
  }
  return names
}

/**
 * Completed team tasks that have no evidence record yet.
 * @param {object} state Board state.
 * @param {Array<{id: string, status?: string}>} tasks Current Team task views.
 * @returns {string[]} Completed task ids missing evidence.
 */
export function completedTasksWithoutEvidence(state, tasks) {
  const covered = new Set(state.evidence.map((record) => record.taskId).filter((taskId) => typeof taskId === 'string'))
  return tasks
    .filter((task) => task?.status === 'completed' && typeof task.id === 'string' && !covered.has(task.id))
    .map((task) => task.id)
}

/**
 * Compact model-facing board summary.
 * @param {object} state Board state.
 * @param {Array<object>} tasks Current Team task views.
 * @returns {object} JSON-safe summary.
 */
export function summarizeBoard(state, tasks = []) {
  const planGate = latestGate(state, 'plan')
  const resultGate = latestGate(state, 'result')
  return {
    active: state.active,
    edict: state.edict === null ? null : {
      revision: state.edict.revision,
      goal: state.edict.goal,
      tier: state.edict.tier,
      rosterCap: state.edict.rosterCap,
      departments: state.edict.departments,
    },
    planGate: compactGate(planGate),
    resultGate: compactGate(resultGate),
    appointments: state.appointments.map((appointment) => ({
      member: appointment.member,
      department: appointment.department,
      writeScopes: appointment.writeScopes,
    })),
    evidenceCount: state.evidence.length,
    completedTasks: tasks.filter((task) => task?.status === 'completed').map((task) => task.id),
    missingEvidence: completedTasksWithoutEvidence(state, tasks),
    closure: state.closure === null ? null : {
      conclusions: state.closure.conclusions,
      deliverables: state.closure.deliverables,
      unknowns: state.closure.unknowns,
      next: state.closure.next,
      closedBy: state.closure.closedBy,
    },
  }
}

/**
 * @param {object|undefined} gate Gate record.
 * @returns {object|null} Compact gate projection.
 */
function compactGate(gate) {
  if (gate === undefined) return null
  return {
    verdict: gate.verdict,
    reviewer: gate.reviewer,
    defects: gate.defects,
    summary: gate.summary,
    at: gate.createdAt,
  }
}

/* ------------------------------------------------------------------ */
/* Hard-gate validators                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate a mode transition request.
 * @param {unknown} action Raw action value.
 * @returns {'enter'|'leave'|'status'} Normalized action.
 */
export function validateModeAction(action) {
  if (action !== 'enter' && action !== 'leave' && action !== 'status') {
    fail('INVALID_ACTION', 'action must be one of: enter, leave, status')
  }
  return action
}

/**
 * Validate and normalize an edict (制敕) draft.
 * @param {object} input Raw tool arguments.
 * @returns {{goal: string, acceptance: string[], boundaries: string[], tier: 'small'|'medium'|'large', rosterCap: number, departments: string[]}} Normalized edict.
 */
export function validateEdictInput(input) {
  const goal = requiredString(input?.goal, 'goal', 4000)
  const acceptance = stringList(input?.acceptance, 'acceptance', 1, 20)
  const boundaries = stringList(input?.boundaries, 'boundaries', 0, 20)
  const tier = input?.tier
  if (tier !== 'small' && tier !== 'medium' && tier !== 'large') {
    fail('INVALID_TIER', 'tier must be one of: small, medium, large')
  }
  const maxRoster = TIERS[tier]
  const rosterCap = input?.roster_cap === undefined ? maxRoster : input.roster_cap
  if (!Number.isInteger(rosterCap) || rosterCap < 0 || rosterCap > MAX_ROSTER_CAP) {
    fail('INVALID_ROSTER_CAP', `roster_cap must be an integer from 0 through ${MAX_ROSTER_CAP}`)
  }
  if (tier === 'small' && rosterCap !== 0) {
    fail('SMALL_TIER_NEEDS_NO_TEAM', 'small tier is handled by a single agent; set roster_cap 0 or do not enter this mode')
  }
  if (rosterCap > maxRoster) {
    fail('ROSTER_CAP_ABOVE_TIER', `${tier} tier allows at most ${maxRoster} teammates; got roster_cap ${rosterCap}`)
  }
  const departments = stringList(input?.departments, 'departments', 0, 9)
  return { goal, acceptance, boundaries, tier, rosterCap, departments }
}

/**
 * Validate one 六部 appointment against the current hard gates.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @returns {{member: string, department: string, responsibility: string|null, writeScopes: string[]}} Normalized appointment.
 */
export function validateAppointInput(state, input, caller) {
  assertActive(state)
  if (caller.role !== 'lead') fail('LEAD_ONLY', 'only the Lead (政事堂) may appoint 六部')
  if (latestGate(state, 'plan')?.verdict !== 'pass') {
    fail('PLAN_GATE_NOT_PASSED', 'the 门下省 plan gate must pass before 尚书省 dispatches the 六部')
  }
  if (state.edict.tier === 'small') {
    fail('SMALL_TIER_NEEDS_NO_TEAM', 'small tier runs without teammates; do not appoint 六部')
  }
  const member = requiredString(input?.member, 'member', 120)
  if (member === 'lead') fail('CANNOT_APPOINT_LEAD', 'the Lead is 政事堂 itself and cannot be appointed to a 部')
  const department = requiredString(input?.department, 'department', 40)
  if (!DEPARTMENT_NAMES.includes(department)) {
    fail('UNKNOWN_DEPARTMENT', `department must be one of: ${DEPARTMENT_NAMES.join(', ')}`)
  }
  if (state.appointments.some((appointment) => appointment.member === member)) {
    fail('MEMBER_ALREADY_APPOINTED', `${member} is already appointed; one member cannot run several 部 (一人多部 is a fake roster)`)
  }
  const rosterAfter = appointedMembers(state).length + 1
  if (rosterAfter > state.edict.rosterCap) {
    fail('ROSTER_CAP_EXCEEDED', `roster_cap ${state.edict.rosterCap} would be exceeded by appointing ${member}`)
  }
  const responsibility = input?.responsibility === undefined || input.responsibility === null
    ? null
    : requiredString(input.responsibility, 'responsibility', 500)
  const writeScopes = scopeList(input?.write_scopes, 'write_scopes')
  return { member, department, responsibility, writeScopes }
}

/**
 * Validate one 门下省 gate verdict.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @returns {{kind: 'plan'|'result', verdict: 'pass'|'reject', defects: string[], summary: string|null}} Normalized gate.
 */
export function validateGateInput(state, input, caller) {
  assertActive(state)
  if (caller.role !== 'teammate') {
    fail('REVIEWER_MUST_BE_TEAMMATE', 'the reviewer must be an independent teammate; the Lead (and 政事堂) can never approve its own work')
  }
  const kind = input?.kind
  if (!GATE_KINDS.includes(kind)) fail('INVALID_GATE_KIND', 'kind must be "plan" or "result"')
  const verdict = input?.verdict
  if (verdict !== 'pass' && verdict !== 'reject') fail('INVALID_VERDICT', 'verdict must be "pass" or "reject"')
  if (kind === 'result' && latestGate(state, 'plan')?.verdict !== 'pass') {
    fail('PLAN_GATE_NOT_PASSED', 'the plan gate must pass before the result gate can be reviewed')
  }
  const defects = stringList(input?.defects, 'defects', verdict === 'reject' ? 1 : 0, 20)
  if (verdict === 'pass' && defects.length > 0) {
    fail('DEFECTS_ON_PASS', 'a passing verdict cannot carry blocking defects')
  }
  if (verdict === 'pass' && kind === 'result' && state.evidence.length === 0) {
    fail('NO_EVIDENCE_TO_REVIEW', 'the result gate needs at least one evidence record submitted by 刑部')
  }
  if (appointedMembers(state).includes(caller.name)) {
    fail('SELF_REVIEW_NOT_ALLOWED', `${caller.name} is appointed to a 六部 and cannot review its own delivery; the reviewer must be outside the executing ministries`)
  }
  const summary = input?.summary === undefined || input.summary === null
    ? null
    : requiredString(input.summary, 'summary', 2000)
  return { kind, verdict, defects, summary }
}

/**
 * Validate one 刑部 evidence record.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {Array<{id: string}>} tasks Current Team task views.
 * @returns {{taskId: string|null, command: string, exitCode: number, digest: string|null, excerpt: string|null, sourceSessionId: string|null}} Normalized evidence.
 */
export function validateEvidenceInput(state, input, tasks = []) {
  assertActive(state)
  const command = requiredString(input?.command, 'command', 4000)
  const exitCode = input?.exit_code
  if (!Number.isInteger(exitCode)) fail('INVALID_EXIT_CODE', 'exit_code must be an integer process exit code')
  let taskId = null
  if (input?.task_id !== undefined && input.task_id !== null && input.task_id !== '') {
    taskId = requiredString(input.task_id, 'task_id', 32)
    if (!/^task-\d+$/.test(taskId)) fail('INVALID_TASK_ID', 'task_id must look like task-<n>')
    if (!tasks.some((task) => task?.id === taskId)) {
      fail('TASK_NOT_FOUND', `${taskId} is not on the shared task board; create the task before submitting evidence`)
    }
  }
  const digest = optionalString(input?.digest, 'digest', 200)
  const excerpt = optionalString(input?.excerpt, 'excerpt', 8000)
  const sourceSessionId = optionalString(input?.source_session_id, 'source_session_id', 200)
  return { taskId, command, exitCode, digest, excerpt, sourceSessionId }
}

/**
 * Validate the closing report and every hard gate in front of it.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {Array<{id: string, status?: string}>} tasks Current Team task views.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @returns {{conclusions: string[], deliverables: string[], unknowns: string[], next: string[]}} Normalized closure.
 */
export function validateCloseInput(state, input, tasks, caller) {
  assertActive(state)
  if (caller.role !== 'lead') fail('LEAD_ONLY', 'only the Lead (政事堂) may close the case')
  if (latestGate(state, 'plan')?.verdict !== 'pass') {
    fail('PLAN_GATE_NOT_PASSED', 'cannot close before the 门下省 plan gate passes')
  }
  if (latestGate(state, 'result')?.verdict !== 'pass') {
    fail('RESULT_GATE_NOT_PASSED', 'cannot close before the 门下省 result gate passes')
  }
  const roster = appointedMembers(state).length
  if (roster > state.edict.rosterCap) {
    fail('ROSTER_CAP_EXCEEDED', `appointed ${roster} members but roster_cap is ${state.edict.rosterCap}`)
  }
  if (state.evidence.length === 0) {
    fail('NO_EVIDENCE', 'cannot close without at least one 刑部 evidence record')
  }
  const missing = completedTasksWithoutEvidence(state, tasks)
  if (missing.length > 0) {
    fail('COMPLETED_TASK_WITHOUT_EVIDENCE', `completed tasks without evidence: ${missing.join(', ')}`)
  }
  const conclusions = stringList(input?.conclusions, 'conclusions', 1, 20)
  const deliverables = stringList(input?.deliverables, 'deliverables', 1, 20)
  const unknowns = stringList(input?.unknowns, 'unknowns', 0, 20)
  const next = stringList(input?.next, 'next', 0, 20)
  return { conclusions, deliverables, unknowns, next }
}

/* ------------------------------------------------------------------ */
/* Small validators                                                    */
/* ------------------------------------------------------------------ */

/** @param {object} state Board state. @returns {void} */
function assertActive(state) {
  if (state.active !== true) {
    fail('MODE_NOT_ACTIVE', 'enter 三省六部 mode first with sansheng_mode {action: "enter"}')
  }
  if (state.edict === null) {
    fail('NO_EDICT', 'draft the edict first with sansheng_edict')
  }
}

/**
 * @param {unknown} value Raw value.
 * @param {string} field Field name for messages.
 * @param {number} max Maximum length.
 * @returns {string} Trimmed non-empty string.
 */
function requiredString(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_FIELD', `${field} must be a non-empty string`)
  const text = value.trim()
  if (text.length > max) fail('FIELD_TOO_LONG', `${field} must be at most ${max} characters`)
  return text
}

/**
 * @param {unknown} value Raw value.
 * @param {string} field Field name for messages.
 * @param {number} max Maximum length.
 * @returns {string|null} Trimmed string or null.
 */
function optionalString(value, field, max) {
  if (value === undefined || value === null || value === '') return null
  return requiredString(value, field, max)
}

/**
 * @param {unknown} value Raw list.
 * @param {string} field Field name for messages.
 * @param {number} min Minimum item count.
 * @param {number} max Maximum item count.
 * @returns {string[]} Trimmed strings.
 */
function stringList(value, field, min, max) {
  if (value === undefined || value === null) {
    if (min === 0) return []
    fail('INVALID_FIELD', `${field} must contain at least ${min} item(s)`)
  }
  if (!Array.isArray(value)) fail('INVALID_FIELD', `${field} must be an array of strings`)
  if (value.length < min) fail('INVALID_FIELD', `${field} must contain at least ${min} item(s)`)
  if (value.length > max) fail('INVALID_FIELD', `${field} must contain at most ${max} item(s)`)
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, 4000))
}

/**
 * Normalize advisory write scopes: workspace-relative prefixes only.
 * @param {unknown} value Raw list.
 * @param {string} field Field name for messages.
 * @returns {string[]} Normalized scopes.
 */
function scopeList(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail('INVALID_FIELD', `${field} must be an array of workspace-relative prefixes`)
  if (value.length > 16) fail('INVALID_FIELD', `${field} must contain at most 16 items`)
  return value.map((item, index) => {
    const scope = requiredString(item, `${field}[${index}]`, 200)
    if (scope.startsWith('/') || scope.startsWith('\\') || /^[A-Za-z]:/.test(scope)) {
      fail('INVALID_WRITE_SCOPE', `${field}[${index}] must be workspace-relative, not absolute`)
    }
    if (scope.split(/[\\/]/).includes('..')) {
      fail('INVALID_WRITE_SCOPE', `${field}[${index}] must not climb out of the workspace with ".."`)
    }
    return scope
  })
}

/* ------------------------------------------------------------------ */
/* Stored-record guards (projection replay must stay total)            */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} value Raw stored edict.
 * @returns {object|null} Stored edict or null when malformed.
 */
function normalizeStoredEdict(value) {
  if (!value || typeof value !== 'object') return null
  if (!Number.isInteger(value.revision) || value.revision < 1) return null
  if (typeof value.goal !== 'string') return null
  if (!Array.isArray(value.acceptance) || !Array.isArray(value.boundaries)) return null
  if (typeof value.tier !== 'string' || typeof value.rosterCap !== 'number') return null
  if (!Array.isArray(value.departments)) return null
  return {
    revision: value.revision,
    goal: value.goal,
    acceptance: value.acceptance.filter((item) => typeof item === 'string'),
    boundaries: value.boundaries.filter((item) => typeof item === 'string'),
    tier: value.tier,
    rosterCap: value.rosterCap,
    departments: value.departments.filter((item) => typeof item === 'string'),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

/**
 * @param {unknown} value Raw stored appointment.
 * @returns {object|null} Stored appointment or null.
 */
function normalizeStoredAppointment(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || typeof value.member !== 'string' || typeof value.department !== 'string') return null
  return {
    id: value.id,
    member: value.member,
    department: value.department,
    responsibility: typeof value.responsibility === 'string' ? value.responsibility : null,
    writeScopes: Array.isArray(value.writeScopes) ? value.writeScopes.filter((item) => typeof item === 'string') : [],
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

/**
 * @param {unknown} value Raw stored gate.
 * @returns {object|null} Stored gate or null.
 */
function normalizeStoredGate(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || typeof value.kind !== 'string' || typeof value.verdict !== 'string') return null
  if (!GATE_KINDS.includes(value.kind)) return null
  if (value.verdict !== 'pass' && value.verdict !== 'reject') return null
  if (typeof value.reviewer !== 'string') return null
  return {
    id: value.id,
    kind: value.kind,
    verdict: value.verdict,
    reviewer: value.reviewer,
    defects: Array.isArray(value.defects) ? value.defects.filter((item) => typeof item === 'string') : [],
    summary: typeof value.summary === 'string' ? value.summary : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

/**
 * @param {unknown} value Raw stored evidence.
 * @returns {object|null} Stored evidence or null.
 */
function normalizeStoredEvidence(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || typeof value.command !== 'string') return null
  if (typeof value.submittedBy !== 'string') return null
  if (!Number.isInteger(value.exitCode)) return null
  return {
    id: value.id,
    taskId: typeof value.taskId === 'string' ? value.taskId : null,
    command: value.command,
    exitCode: value.exitCode,
    digest: typeof value.digest === 'string' ? value.digest : null,
    excerpt: typeof value.excerpt === 'string' ? value.excerpt : null,
    submittedBy: value.submittedBy,
    sourceSessionId: typeof value.sourceSessionId === 'string' ? value.sourceSessionId : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

/**
 * @param {unknown} value Raw stored closure.
 * @returns {object|null} Stored closure or null.
 */
function normalizeStoredClosure(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || typeof value.closedBy !== 'string') return null
  const list = (candidate) => Array.isArray(candidate) ? candidate.filter((item) => typeof item === 'string') : []
  return {
    id: value.id,
    conclusions: list(value.conclusions),
    deliverables: list(value.deliverables),
    unknowns: list(value.unknowns),
    next: list(value.next),
    closedBy: value.closedBy,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

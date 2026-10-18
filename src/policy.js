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
import { ministryRole } from './ministries.js'


/** Maximum teammate count per task tier. The Lead is never counted. */
export const TIERS = Object.freeze({ small: 0, medium: 5, large: 9 })

/** Accepted edict risk levels. */
export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'irreversible'])

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

const RECORD_MARKER = 'SANS_RECORD_V1'

/** Record envelope version. */
export const RECORD_VERSION = 1

/** Record operations the board fold understands. */
export const RECORD_OPS = Object.freeze(['mode', 'edict', 'appoint', 'gate', 'audit', 'evidence', 'close', 'board'])

/** Bounded audit history kept on the board for the timeline view. */
export const MAX_HISTORY = 200

/** Rejects on one gate before the case must be escalated to the user. */
export const MAX_GATE_REJECTS = 3

/** A stalled board is flagged after this long without any new record. */
export const STALL_MS = 30 * 60 * 1000

/** Policy failure codes that may be folded into the audit history. */
const AUDIT_CODES = new Set([
  'CANNOT_APPOINT_LEAD', 'CASE_ALREADY_CLOSED', 'COMPLETED_TASK_WITHOUT_EVIDENCE',
  'DEFECTS_ON_PASS', 'DUPLICATE_EVIDENCE', 'DUPLICATE_TASK_REVIEW', 'FIELD_TOO_LONG',
  'INVALID_ACTION', 'INVALID_DIGEST', 'INVALID_EXIT_CODE', 'INVALID_FIELD',
  'INVALID_GATE_KIND', 'INVALID_ROSTER_CAP', 'INVALID_TASK_ID', 'INVALID_TIER',
  'INVALID_VERDICT', 'INVALID_WRITE_SCOPE', 'LEAD_ONLY',
  'LEAVE_REQUIRES_CLOSE_OR_ABANDON', 'MEMBER_ALREADY_APPOINTED',
  'MISSING_EXPECTED_REVISION', 'MODE_NOT_ACTIVE', 'NO_EDICT', 'NO_EVIDENCE',
  'NO_EVIDENCE_TO_REVIEW', 'OPEN_TASKS', 'PLAN_GATE_NOT_PASSED',
  'PLAN_NOT_REVISED', 'RESULT_GATE_NOT_PASSED', 'RESULT_NOT_REVISED',
  'REVIEWER_IS_EXECUTOR', 'REVIEWER_MUST_BE_TEAMMATE', 'REVIEWER_MUST_DIFFER',
  'ROSTER_CAP_ABOVE_TIER', 'ROSTER_CAP_EXCEEDED', 'SELF_REVIEW_NOT_ALLOWED',
  'SMALL_TIER_NEEDS_NO_TEAM', 'STALE_REVISION', 'TASK_NOT_COMPLETED',
  'TASK_NOT_FOUND', 'TASK_REVIEWS_INCOMPLETE', 'TASK_REVIEWS_REQUIRED',
  'USER_APPROVAL_NOT_READY', 'USER_APPROVAL_REQUIRED', 'USER_REJECTED_PLAN',
  'WORKSTREAM_DEPARTMENT_NOT_LISTED', 'WORKSTREAM_EVIDENCE_REQUIRED',
  'WORKSTREAM_REVIEW_REQUIRED', 'WORKSTREAM_REVIEWS_INCOMPLETE',
  'WORKSTREAM_WITHOUT_EVIDENCE', 'UNKNOWN_WORKSTREAM', 'SMALL_TIER_WORKSTREAMS',
  'DUPLICATE_WORKSTREAM', 'INVALID_WORKSTREAM_ID',
  'TASK_REVIEW_NOT_PASS', 'UNKNOWN_DEPARTMENT', 'UNKNOWN_REVIEW_TASK',
])


/** Deployment-owned default guidance rendered while the mode is active. */
export const DEFAULT_SECTION = `You are in 三省六部 mode (Sān Shěng Liù Bù — "Three Departments and Six Ministries"), for complex multi-deliverable work. The tool contract and state machine below are the authoritative procedure. If a three-departments-six-ministries skill is installed, use it only for role detail; the enforced rules below always win.

Every mutating tool takes expected_revision (the revision you last read from sansheng_board). A stale value is rejected — read the board again, do not guess. Every committed step increments the board revision.

Procedure (all state is recorded in this session's event log — never coordinate through files or temp directories):
The Lead wears two hats: 中书省 (receiving the emperor's intent and drafting the plan) and 尚书省 (dispatching after the gates and summarizing at close). 门下省 is an independent teammate; 政事堂 is the Lead's coordinating seat, not a fourth department. Ministry boundaries: 吏部=identity/permissions, 户部=budget/resources, 礼部=interaction/format, 兵部=security/incident, 刑部=audit/evidence, 工部=tools/infrastructure. These are responsibility boundaries, not a host sandbox.

1. 中书省 (Lead, drafting hat) receives the intent and drafts the edict: sansheng_edict {goal, acceptance, boundaries, tier, roster_cap, departments, assumptions, risks, tools, data_scope, risk_level, budget}. High/irreversible risk requires assumptions, risks, tools, data_scope and budget.
2. 门下省 reviews the plan: an independent teammate calls sansheng_gate {kind: "plan", verdict, checked, conditions?}. The Lead can never approve its own plan; a pass must cite at least one checked item. Optional conditions make it a conditional pass. A reject must carry defects; after a reject, revise the edict before a new plan review.
3. Only after the plan gate passes, and after a real user /sansheng approve when tier is large or risk_level is high/irreversible: 尚书省 (Lead, dispatch hat) uses sansheng_appoint for each teammate to one of the 六部, then creates team tasks and spawns teammates.
4. 六部 execute. 刑部 submits evidence for a completed shared task: sansheng_evidence {task_id, command, exit_code, digest, excerpt}. A digest (hex) and a bounded excerpt are required.
5. 门下省 reviews the result: a different teammate (never the plan reviewer, never a task owner) calls sansheng_gate {kind: "result", verdict, checked, conditions?, reviews}. For a pass, reviews must cover every completed shared task with verdict "pass".
5b. Independent audit: when a gate has conditions, or the edict risk is high/irreversible, an independent teammate calls sansheng_audit {scope, verdict, checks, conditions_met?}. An appointed 刑部 may audit; other appointed ministries may not. The auditor cannot own a task or be the gate reviewer. A passing audit confirms every condition.
6. Only after both gates pass, every shared task is completed or deleted, every completed task has evidence, every conditional gate has a newer passing audit, and high-risk work has a passing result audit, 尚书省 (Lead, summary hat) calls sansheng_close and reports the result.

Leaving the mode requires a closed case or an explicit abandon_reason; abandoning is recorded on the board. Closing with unfinished shared tasks is rejected. Never claim completion before sansheng_close returns. Use sansheng_board for the current board state and revision.`

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
    audits: [],
    closure: null,
    abandoned: null,
    approvals: [],
    history: [],
    updatedAt: null,
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
 * Append one bounded audit-history entry and stamp the board's update time.
 * @param {object} state Next board state.
 * @param {object} entry History entry.
 * @returns {object} State with history.
 */
function withHistory(state, entry) {
  const history = [...(state.history ?? []), entry].slice(-MAX_HISTORY)
  const updatedAt = typeof entry.at === 'number'
    ? Math.max(state.updatedAt ?? 0, entry.at)
    : state.updatedAt ?? null
  return { ...state, history, updatedAt }
}

/**
 * Resolve one record's display timestamp.
 * @param {object} record Parsed record.
 * @param {number|null} eventTime Session event time when available.
 * @param {number|null} fallback Object createdAt.
 * @returns {number|null} Timestamp or null.
 */
function recordTime(record, eventTime, fallback) {
  if (Number.isInteger(eventTime) && eventTime > 0) return eventTime
  if (typeof record.at === 'number' && record.at > 0) return record.at
  return typeof fallback === 'number' ? fallback : null
}

/**
 * Apply one record envelope to the board state.
 * @param {object} state Previous board state.
 * @param {object} record Parsed record envelope.
 * @param {number|null} [eventTime] Committed event timestamp for the timeline.
 * @returns {object} Next board state.
 */
export function applyRecord(state, record, eventTime = null) {
  if (record === null || typeof record !== 'object') return state
  const { revision, stale } = recordRevision(state, record)
  if (stale) return state
  switch (record.op) {
    case 'mode': {
      if (typeof record.active !== 'boolean') return state
      if (record.active === true) {
        return withHistory(
          commit(state, { active: true, abandoned: null }, revision),
          { op: 'mode', rev: revision, at: recordTime(record, eventTime, null), by: record.by ?? 'lead', active: true },
        )
      }
      const patch = { active: false }
      if (typeof record.abandoned === 'string' && record.abandoned.trim() !== '') {
        patch.abandoned = {
          reason: record.abandoned.trim(),
          at: typeof record.abandonedAt === 'number' ? record.abandonedAt : null,
        }
      }
      return withHistory(
        commit(state, patch, revision),
        {
          op: 'mode',
          rev: revision,
          at: recordTime(record, eventTime, patch.abandoned?.at ?? null),
          by: record.by ?? 'lead',
          active: false,
          abandoned: patch.abandoned?.reason ?? null,
        },
      )
    }
    case 'edict': {
      const edict = normalizeStoredEdict(record.edict)
      if (edict === null) return state
      return withHistory(
        commit(state, { edict }, revision),
        { op: 'edict', rev: revision, at: recordTime(record, eventTime, edict.createdAt), by: record.by ?? 'lead', revisionNo: edict.revision, goal: edict.goal, tier: edict.tier },
      )
    }
    case 'appoint': {
      const appointment = normalizeStoredAppointment(record.appointment)
      if (appointment === null) return state
      return withHistory(
        commit(state, { appointments: [...state.appointments, appointment] }, revision),
        { op: 'appoint', rev: revision, at: recordTime(record, eventTime, appointment.createdAt), by: record.by ?? 'lead', member: appointment.member, department: appointment.department },
      )
    }
    case 'gate': {
      const gate = normalizeStoredGate(record.gate)
      if (gate === null) return state
      return withHistory(
        commit(state, { gates: [...state.gates, gate] }, revision),
        {
          op: 'gate',
          rev: revision,
          at: recordTime(record, eventTime, gate.createdAt),
          by: gate.reviewer,
          kind: gate.kind,
          verdict: gate.verdict,
          checked: gate.checked.length,
          reviews: gate.reviews.length,
          defects: gate.defects,
        },
      )
    }
    case 'evidence': {
      const evidence = normalizeStoredEvidence(record.evidence)
      if (evidence === null) return state
      return withHistory(
        commit(state, { evidence: [...state.evidence, evidence] }, revision),
        {
          op: 'evidence',
          rev: revision,
          at: recordTime(record, eventTime, evidence.createdAt),
          by: evidence.submittedBy,
          taskId: evidence.taskId,
          workstreamId: evidence.workstreamId,
          command: evidence.command,
          exitCode: evidence.exitCode,
          digest: evidence.digest,
        },
      )
    }
    case 'audit': {
      const audit = normalizeStoredAudit(record.audit)
      if (audit === null) return state
      return withHistory(
        commit(state, { audits: [...state.audits, audit] }, revision),
        {
          op: 'audit',
          rev: revision,
          at: recordTime(record, eventTime, audit.createdAt),
          by: audit.auditor,
          scope: audit.scope,
          verdict: audit.verdict,
          checks: audit.checks.length,
          conditionsMet: audit.conditionsMet.length,
          defects: audit.defects,
        },
      )
    }
    case 'close': {
      const closure = normalizeStoredClosure(record.closure)
      if (closure === null) return state
      return withHistory(
        commit(state, { closure }, revision),
        { op: 'close', rev: revision, at: recordTime(record, eventTime, closure.createdAt), by: closure.closedBy, conclusions: closure.conclusions },
      )
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
  const eventTime = Number.isInteger(event?.time) && event.time > 0 ? event.time : null
  if (type === 'tool/result') {
    const content = event.data?.message?.content
    if (event.data?.message?.isError === true) {
      if (!Array.isArray(content)) return state
      for (const block of content) {
        if (block?.type !== 'text' || typeof block.text !== 'string') continue
        const text = block.text.trim().replace(/^(?:Error:\s*)+/, '')
        const match = /^([A-Z][A-Z0-9_]+):/.exec(text)
        if (match === null || !AUDIT_CODES.has(match[1])) continue
        return withHistory(state, {
          op: 'denied',
          rev: state.revision,
          at: eventTime,
          by: null,
          code: match[1],
          message: text.slice(0, 240),
        })
      }
      return state
    }
    if (!Array.isArray(content)) return state
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const record = parseRecordText(block.text)
      if (record !== null) return applyRecord(state, record, eventTime)
    }
    return state
  }
  if (type === 'command/run') {
    const name = event.data?.name
    if (name !== 'sansheng') return state
    const raw = typeof event.data?.args === 'string' ? event.data.args.trim() : ''
    const tokens = raw.split(/\s+/).filter((token) => token !== '')
    const verb = tokens[0]
    if (verb !== 'approve' && verb !== 'reject') return state
    const plan = latestGate(state, 'plan')
    if (state.active !== true || state.closure !== null || plan === undefined || plan.verdict !== 'pass') {
      return withHistory(state, {
        op: 'denied',
        rev: state.revision,
        at: eventTime,
        by: 'user',
        code: 'USER_APPROVAL_NOT_READY',
        message: 'USER_APPROVAL_NOT_READY: 御批必须在模式激活且计划门通过后进行',
      })
    }
    const revision = (state.revision ?? 0) + 1
    const approval = {
      id: `ua-${(state.approvals ?? []).length + 1}`,
      decision: verb === 'approve' ? 'approve' : 'reject',
      reason: tokens.length > 1 ? tokens.slice(1).join(' ') : null,
      by: 'user',
      at: eventTime,
      rev: revision,
    }
    return withHistory(
      commit(state, { approvals: [...(state.approvals ?? []), approval] }, revision),
      { op: 'approval', rev: revision, at: eventTime, by: 'user', decision: approval.decision, reason: approval.reason },
    )
  }
  if (type === 'user/message') {
    const content = event.data?.content
    if (!Array.isArray(content)) return state
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const record = parseRecordText(block.text)
      if (record !== null) return applyRecord(state, record, eventTime)
    }
  }
  return state
}

/**
 * Replace selected fields and set the projection revision.
 * @param {object} state Previous state.
 * @param {object} patch Fields to replace.
 * @param {number} [revision] Absolute revision; defaults to the next step.
 * @returns {object} Next state.
 */
function commit(state, patch, revision) {
  const next = Number.isInteger(revision) && revision > 0 ? revision : (state.revision ?? 0) + 1
  return { ...state, ...patch, revision: next }
}

/**
 * Resolve one record's target revision.
 *
 * A record written by the CAS-aware tools carries its reserved `rev`; a record
 * from an older build carries none and replays as one sequential step. A `rev`
 * that is not newer than the folded state is a stale concurrent write and must
 * not move the board.
 * @param {object} state Current state.
 * @param {object} record Parsed record.
 * @returns {{revision: number, stale: boolean}} Target revision and staleness.
 */
function recordRevision(state, record) {
  const explicit = Number.isInteger(record.rev) && record.rev > 0 ? record.rev : null
  if (explicit === null) return { revision: (state.revision ?? 0) + 1, stale: false }
  return { revision: explicit, stale: explicit <= (state.revision ?? 0) }
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
 * Whether the current edict needs a real user `/sansheng approve` after the
 * plan gate before any appointment.
 * @param {object|null} edict Current edict.
 * @returns {boolean} True for large tier or high/irreversible risk.
 */
export function needsHumanApproval(edict) {
  if (edict === null || edict === undefined) return false
  return edict.tier === 'large' || edict.riskLevel === 'high' || edict.riskLevel === 'irreversible'
}

/**
 * Latest independent audit for one gate scope.
 * @param {object} state Board state.
 * @param {'plan'|'result'} scope Gate scope.
 * @returns {object|undefined} Latest audit.
 */
export function latestAudit(state, scope) {
  for (let index = state.audits.length - 1; index >= 0; index -= 1) {
    if (state.audits[index].scope === scope) return state.audits[index]
  }
  return undefined
}

/**
 * Derive the case's explicit state from the board projection. This is a
 * read-only view of the event fold; it never introduces a second state store.
 * @param {object} state Board state.
 * @returns {'idle'|'intake'|'plan_review'|'plan_rejected'|'awaiting_human'|'dispatching'|'executing'|'result_rejected'|'auditing'|'ready_to_close'|'closed'|'abandoned'} Case phase.
 */
export function casePhase(state) {
  if (state.active !== true) return 'idle'
  if (state.closure !== null) return 'closed'
  if (state.abandoned !== null && state.abandoned !== undefined) return 'abandoned'
  if (state.edict === null) return 'intake'
  const plan = latestGate(state, 'plan')
  if (plan === undefined) return 'plan_review'
  if (plan.verdict === 'reject') return 'plan_rejected'
  if (needsHumanApproval(state.edict)) {
    const approvals = Array.isArray(state.approvals) ? state.approvals : []
    const approval = approvals[approvals.length - 1]
    if (approval !== undefined && approval.rev > plan.rev && approval.decision === 'reject') return 'plan_rejected'
    if (approval === undefined || approval.rev <= plan.rev) return 'awaiting_human'
  }
  if (state.edict.tier !== 'small' && state.appointments.length === 0) return 'dispatching'
  const result = latestGate(state, 'result')
  if (result !== undefined && result.verdict === 'reject') return 'result_rejected'
  if (result !== undefined && result.verdict === 'pass') {
    for (const scope of GATE_KINDS) {
      const gate = latestGate(state, scope)
      const conditions = Array.isArray(gate?.conditions) ? gate.conditions : []
      if (conditions.length > 0) {
        const audit = latestAudit(state, scope)
        if (audit === undefined || audit.verdict !== 'pass' || audit.rev <= gate.rev) return 'auditing'
        const met = new Set(audit.conditionsMet)
        if (conditions.some((condition) => !met.has(condition))) return 'auditing'
      }
    }
    if (state.edict.riskLevel === 'high' || state.edict.riskLevel === 'irreversible') {
      const audit = latestAudit(state, 'result')
      if (audit === undefined || audit.verdict !== 'pass' || audit.rev <= result.rev) return 'auditing'
    }
    return 'ready_to_close'
  }
  return 'executing'
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
    phase: casePhase(state),
    revision: state.revision,
    updatedAt: state.updatedAt,
    abandoned: state.abandoned,
    openTasks: tasks
      .filter((task) => task !== null && typeof task === 'object' && task.status !== 'completed' && task.status !== 'deleted')
      .map((task) => task.id),
    planRounds: 1 + state.gates.filter((gate) => gate.kind === 'plan' && gate.verdict === 'reject').length,
    resultRounds: 1 + state.gates.filter((gate) => gate.kind === 'result' && gate.verdict === 'reject').length,
    edict: state.edict === null ? null : {
      revision: state.edict.revision,
      goal: state.edict.goal,
      tier: state.edict.tier,
      rosterCap: state.edict.rosterCap,
      departments: state.edict.departments,
      riskLevel: state.edict.riskLevel,
      assumptions: state.edict.assumptions,
      risks: state.edict.risks,
      tools: state.edict.tools,
      dataScope: state.edict.dataScope,
      budget: state.edict.budget,
    },
    planGate: compactGate(planGate),
    resultGate: compactGate(resultGate),
    appointments: state.appointments.map((appointment) => ({
      member: appointment.member,
      department: appointment.department,
      role: appointment.role,
      writeScopes: appointment.writeScopes,
    })),
    evidenceCount: state.evidence.length,
    completedTasks: tasks.filter((task) => task?.status === 'completed').map((task) => task.id),
    missingEvidence: completedTasksWithoutEvidence(state, tasks),
    taskReviews: resultGate === undefined ? [] : resultGate.reviews,
    workstreams: (Array.isArray(state.edict?.workstreams) ? state.edict.workstreams : []).map((workstream) => ({
      ...workstream,
      evidenceCount: state.evidence.filter((record) => record.workstreamId === workstream.id).length,
      reviewed: resultGate !== undefined && resultGate.verdict === 'pass'
        && resultGate.reviews.some((review) => review.workstreamId === workstream.id),
    })),
    approvals: (state.approvals ?? []).map((approval) => ({
      decision: approval.decision,
      reason: approval.reason,
      at: approval.at,
      rev: approval.rev,
    })),
    userApproval: (state.approvals ?? []).length === 0 ? null : (state.approvals ?? [])[state.approvals.length - 1],
    audits: (state.audits ?? []).map((audit) => ({
      scope: audit.scope,
      verdict: audit.verdict,
      auditor: audit.auditor,
      checks: audit.checks,
      conditionsMet: audit.conditionsMet,
      defects: audit.defects,
    })),
    alerts: boardAlerts(state, tasks),
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
 * Human/model-readable warnings for the current board, shown in the red zone.
 * @param {object} state Board state.
 * @param {Array<object>} tasks Current Team task views.
 * @param {number} [now] Current epoch ms (injectable for tests).
 * @returns {string[]} Warning lines.
 */
export function boardAlerts(state, tasks = [], now = Date.now()) {
  if (state.active !== true) return []
  const alerts = []
  if (state.abandoned !== null && state.abandoned !== undefined) {
    alerts.push(`案件已放弃：${state.abandoned.reason}。重新进入模式可继续。`)
  }
  if (state.closure !== null) return alerts
  if (state.edict === null) alerts.push('尚未拟旨：先调用 sansheng_edict。')
  const plan = latestGate(state, 'plan')
  const result = latestGate(state, 'result')
  if (state.edict !== null && plan === undefined) alerts.push('计划门未审：需要门下省 sansheng_gate {kind:"plan"}。')
  if (plan !== undefined && plan.verdict === 'reject') alerts.push('计划被门封驳：按 defects 整改并重新拟旨。')
  if (state.edict !== null && needsHumanApproval(state.edict) && plan?.verdict === 'pass' && state.closure === null) {
    const approvals = Array.isArray(state.approvals) ? state.approvals : []
    const approval = approvals[approvals.length - 1]
    if (approval === undefined || approval.rev <= plan.rev) {
      alerts.push('large 或高风险任务等待御批：请用户运行 /sansheng approve（或 reject）。')
    } else if (approval.decision === 'reject') {
      alerts.push('用户已封驳计划：修改制敕后重新过计划门，再请御批。')
    }
  }
  if (state.edict !== null && plan?.verdict === 'pass' && state.edict.tier !== 'small'
    && state.appointments.length === 0) {
    alerts.push('计划已过门但尚未派工：先 sansheng_appoint。')
  }
  const completed = tasks.filter((task) => task?.status === 'completed')
  const covered = new Set(state.evidence.map((record) => record.taskId))
  const missing = completed.filter((task) => covered.has(task.id) === false)
  if (missing.length > 0) alerts.push(`已完成任务缺少证据：${missing.map((task) => task.id).join(', ')}。`)
  const open = tasks.filter((task) => task !== null && typeof task === 'object'
    && task.status !== 'completed' && task.status !== 'deleted')
  if (open.length > 0) alerts.push(`未完成任务：${open.map((task) => task.id).join(', ')}。`)
  if (result !== undefined && result.verdict === 'reject') alerts.push('成果被门封驳：补充新证据后再审。')
  const workstreams = Array.isArray(state.edict?.workstreams) ? state.edict.workstreams : []
  if (workstreams.length > 0) {
    const coveredStreams = new Set(state.evidence.map((record) => record.workstreamId).filter((id) => typeof id === 'string'))
    const uncovered = workstreams.filter((workstream) => !coveredStreams.has(workstream.id)).map((workstream) => workstream.id)
    if (uncovered.length > 0 && completed.length > 0) alerts.push(`工作流缺证据：${uncovered.join(', ')}。`)
  }
  if (result !== undefined && result.verdict === 'pass' && result.reviews.length < completed.length) {
    alerts.push('成果门通过但逐任务 review 不完整。')
  }
  const planRejects = state.gates.filter((gate) => gate.kind === 'plan' && gate.verdict === 'reject').length
  const resultRejects = state.gates.filter((gate) => gate.kind === 'result' && gate.verdict === 'reject').length
  if (planRejects >= MAX_GATE_REJECTS) {
    alerts.push(`计划封驳已达 ${planRejects} 轮：停止循环，上奏用户裁决或显式放弃，不得继续重复评审。`)
  }
  if (resultRejects >= MAX_GATE_REJECTS) {
    alerts.push(`成果封驳已达 ${resultRejects} 轮：停止循环，上奏用户裁决或显式放弃，不得继续重复评审。`)
  }
  for (const scope of GATE_KINDS) {
    const gate = latestGate(state, scope)
    const conditions = Array.isArray(gate?.conditions) ? gate.conditions : []
    if (conditions.length === 0) continue
    const audit = latestAudit(state, scope)
    if (audit === undefined || audit.verdict !== 'pass' || audit.rev <= gate.rev) {
      alerts.push(`${scope === 'plan' ? '计划' : '成果'}门为有条件通过：需要独立审计确认 ${conditions.length} 项条件。`)
    }
  }
  if (state.edict !== null && (state.edict.riskLevel === 'high' || state.edict.riskLevel === 'irreversible')) {
    const resultGate = latestGate(state, 'result')
    const audit = latestAudit(state, 'result')
    if (audit === undefined || audit.verdict !== 'pass' || (resultGate !== undefined && audit.rev <= resultGate.rev)) {
      alerts.push('高风险案件：结案前需要独立的成果审计（sansheng_audit scope="result"）。')
    }
  }
  if (state.updatedAt !== null) {
    const idleMinutes = Math.round((now - state.updatedAt) / 60000)
    if (idleMinutes >= 120) {
      alerts.push(`看板已 ${idleMinutes} 分钟无新记录：必须向用户（皇上）上奏并等待指示，不得自行放宽验收。`)
    } else if (idleMinutes >= 60) {
      alerts.push(`看板已 ${idleMinutes} 分钟无新记录：对停滞成员执行 interrupt_agent 并 reassign，或上奏用户。`)
    } else if (idleMinutes >= 30) {
      alerts.push(`看板已 ${idleMinutes} 分钟无新记录：先 sansheng_board，再检查停滞成员。`)
    }
  }
  return alerts
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
    checked: gate.checked,
    conditions: gate.conditions,
    reviews: gate.reviews,
    summary: gate.summary,
    rev: gate.rev,
    at: gate.createdAt,
  }
}

/* ------------------------------------------------------------------ */
/* Hard-gate validators                                                */
/* ------------------------------------------------------------------ */

/**
 * Require the caller's expected projection revision (CAS guard).
 *
 * Every mutating tool must echo the `revision` it last read from
 * `sansheng_board`; a different value means another agent committed first and
 * the caller's decision may be based on a stale board.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @returns {void}
 */
function assertExpectedRevision(state, input) {
  const expected = input?.expected_revision
  if (!Number.isInteger(expected)) {
    fail('MISSING_EXPECTED_REVISION', `pass expected_revision = ${state.revision} (read sansheng_board first)`)
  }
  if (expected !== state.revision) {
    fail('STALE_REVISION', `expected revision ${expected} but the board is at ${state.revision}; call sansheng_board and retry`)
  }
}

/**
 * Validate a mode transition request.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @returns {{action: 'enter'|'leave'|'status', abandonReason: string|null}} Normalized action.
 */
export function validateModeAction(state, input) {
  const action = input?.action
  if (action !== 'enter' && action !== 'leave' && action !== 'status') {
    fail('INVALID_ACTION', 'action must be one of: enter, leave, status')
  }
  if (action === 'status') return { action, abandonReason: null }
  assertExpectedRevision(state, input)
  if (action === 'enter') {
    if (state.closure !== null) {
      fail('CASE_ALREADY_CLOSED', 'this case is already closed; start a new session for a new case')
    }
    return { action, abandonReason: null }
  }
  if (state.closure !== null) return { action, abandonReason: null }
  let abandonReason = null
  if (input?.abandon_reason !== undefined && input.abandon_reason !== null) {
    abandonReason = requiredString(input.abandon_reason, 'abandon_reason', 2000)
  }
  if (abandonReason === null) {
    fail('LEAVE_REQUIRES_CLOSE_OR_ABANDON', 'close the case with sansheng_close, or pass abandon_reason to record why the case is being dropped')
  }
  return { action, abandonReason }
}

/**
 * The latest plan gate, only when it is newer than the current edict revision.
 * Re-drafting the edict after a plan pass invalidates that pass; the plan must
 * be reviewed again before dispatch, result review or close.
 * @param {object} state Board state.
 * @returns {object|undefined} The valid plan gate.
 */
export function validPlanGate(state) {
  const plan = latestGate(state, 'plan')
  if (plan === undefined || plan.verdict !== 'pass') return undefined
  const edictRev = state.edict?.rev
  if (Number.isInteger(edictRev) && Number.isInteger(plan.rev) && plan.rev <= edictRev) return undefined
  return plan
}

/**
 * Normalize the optional per-department workstream list of one edict.
 * @param {unknown} value Raw `workstreams` value.
 * @returns {Array<{id: string, department: string, deliverable: string, acceptance: string[], writeScopes: string[]}>} Workstreams.
 */
function workstreamList(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail('INVALID_FIELD', 'workstreams must be an array')
  if (value.length > 16) fail('INVALID_FIELD', 'workstreams must contain at most 16 items')
  const seen = new Set()
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') fail('INVALID_FIELD', `workstreams[${index}] must be an object`)
    const id = requiredString(item.id, `workstreams[${index}].id`, 40)
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) {
      fail('INVALID_WORKSTREAM_ID', `workstreams[${index}].id must be lowercase letters, digits and hyphens`)
    }
    if (seen.has(id)) fail('DUPLICATE_WORKSTREAM', `${id} appears more than once in workstreams`)
    seen.add(id)
    const department = requiredString(item.department, `workstreams[${index}].department`, 40)
    if (!DEPARTMENT_NAMES.includes(department)) fail('UNKNOWN_DEPARTMENT', `workstreams[${index}].department must be one of: ${DEPARTMENT_NAMES.join(', ')}`)
    const deliverable = requiredString(item.deliverable, `workstreams[${index}].deliverable`, 500)
    const acceptance = stringList(item.acceptance, `workstreams[${index}].acceptance`, 1, 10)
    const writeScopes = scopeList(item.write_scopes, `workstreams[${index}].write_scopes`)
    return { id, department, deliverable, acceptance, writeScopes }
  })
}

/**
 * @param {object} state Board state.
 * @returns {string[]} Workstream ids of the current edict.
 */
function currentWorkstreamIds(state) {
  const workstreams = state.edict?.workstreams
  return Array.isArray(workstreams) ? workstreams.map((workstream) => workstream.id) : []
}

/**
 * Validate and normalize an edict (制敕) draft.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @returns {{goal: string, acceptance: string[], boundaries: string[], tier: 'small'|'medium'|'large', rosterCap: number, departments: string[]}} Normalized edict.
 */
export function validateEdictInput(state, input) {
  assertExpectedRevision(state, input)
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
  const assumptions = stringList(input?.assumptions, 'assumptions', 0, 20)
  const risks = stringList(input?.risks, 'risks', 0, 20)
  const tools = stringList(input?.tools, 'tools', 0, 32)
  const dataScope = stringList(input?.data_scope, 'data_scope', 0, 20)
  const riskLevel = input?.risk_level === undefined ? 'low' : input.risk_level
  if (!RISK_LEVELS.includes(riskLevel)) {
    fail('INVALID_RISK_LEVEL', `risk_level must be one of: ${RISK_LEVELS.join(', ')}`)
  }
  const budget = optionalString(input?.budget, 'budget', 500)
  if ((riskLevel === 'high' || riskLevel === 'irreversible')
    && (assumptions.length === 0 || risks.length === 0 || tools.length === 0 || dataScope.length === 0 || budget === null)) {
    fail('RISK_ANALYSIS_REQUIRED', 'high/irreversible work needs assumptions, risks, tools, data_scope and budget in the edict')
  }
  const workstreams = workstreamList(input?.workstreams)
  if (workstreams.length > 0 && tier === 'small') {
    fail('SMALL_TIER_WORKSTREAMS', 'small tier runs without teammates; omit workstreams')
  }
  for (const workstream of workstreams) {
    if (!departments.includes(workstream.department)) {
      fail('WORKSTREAM_DEPARTMENT_NOT_LISTED', `workstream "${workstream.id}" uses ${workstream.department}, which is not listed in departments`)
    }
  }
  return { goal, acceptance, boundaries, tier, rosterCap, departments, workstreams, assumptions, risks, tools, dataScope, riskLevel, budget }
}

/**
 * Validate one 六部 appointment against the current hard gates.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @returns {{member: string, department: string, responsibility: string|null, writeScopes: string[]}} Normalized appointment.
 */
export function validateAppointInput(state, input, caller) {
  assertExpectedRevision(state, input)
  assertActive(state)
  if (caller.role !== 'lead') fail('LEAD_ONLY', 'only the Lead (尚书省) may appoint 六部')
  const planGate = validPlanGate(state)
  if (planGate === undefined) {
    fail('PLAN_GATE_NOT_PASSED', 'the 门下省 plan gate must pass after the current edict revision before 尚书省 dispatches the 六部')
  }
  if (needsHumanApproval(state.edict)) {
    const approvals = Array.isArray(state.approvals) ? state.approvals : []
    const approval = approvals[approvals.length - 1]
    if (approval === undefined || approval.rev <= planGate.rev) {
      fail('USER_APPROVAL_REQUIRED', 'large or high-risk work needs the user to run /sansheng approve after the plan gate passes before any appointment')
    }
    if (approval.decision !== 'approve') {
      fail('USER_REJECTED_PLAN', 'the user rejected this plan; revise the edict and pass the plan gate again')
    }
  }
  if (state.edict.tier === 'small') {
    fail('SMALL_TIER_NEEDS_NO_TEAM', 'small tier runs without teammates; do not appoint 六部')
  }
  const member = requiredString(input?.member, 'member', 120)
  if (member === 'lead') fail('CANNOT_APPOINT_LEAD', 'the Lead cannot be appointed to a 部')
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
  const role = ministryRole(department)
  return { member, department, responsibility, writeScopes, role: role?.label ?? null, roleDuty: role?.duty ?? null }
}

/**
 * Normalize one per-task result review list: every completed task must be
 * reviewed exactly once and all reviews must pass before the result gate can.
 * @param {unknown} value Raw `reviews` value.
 * @param {Array<object>} tasks Current Team task views.
 * @returns {Array<{taskId: string, verdict: 'pass', defects: string[]}>} Reviews.
 */
function reviewList(value, tasks, workstreams = []) {
  const completed = tasks
    .filter((task) => task?.status === 'completed' && typeof task.id === 'string')
    .map((task) => task.id)
  if (value === undefined || value === null) {
    if (completed.length === 0) return []
    fail('TASK_REVIEWS_REQUIRED', `a passing result gate needs one review per completed task: ${completed.join(', ')}`)
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_FIELD', 'reviews must be a non-empty array for a passing result gate')
  }
  if (value.length > 64) fail('INVALID_FIELD', 'reviews must contain at most 64 items')
  const seen = new Set()
  const reviews = []
  for (const [index, item] of value.entries()) {
    if (item === null || typeof item !== 'object') fail('INVALID_FIELD', `reviews[${index}] must be an object`)
    const taskId = requiredString(item.task_id, `reviews[${index}].task_id`, 32)
    if (!completed.includes(taskId)) {
      fail('UNKNOWN_REVIEW_TASK', `reviews[${index}] names ${taskId}, which is not a completed shared task`)
    }
    if (seen.has(taskId)) fail('DUPLICATE_TASK_REVIEW', `${taskId} is reviewed more than once`)
    seen.add(taskId)
    if (item.verdict !== 'pass') {
      fail('TASK_REVIEW_NOT_PASS', `reviews[${index}] for ${taskId} is ${String(item.verdict)}; a passing result gate may only contain passing task reviews`)
    }
    const known = workstreams.map((workstream) => workstream.id)
    let workstreamId = null
    if (item.workstream_id !== undefined && item.workstream_id !== null && item.workstream_id !== '') {
      workstreamId = requiredString(item.workstream_id, `reviews[${index}].workstream_id`, 40)
      if (!known.includes(workstreamId)) {
        fail('UNKNOWN_WORKSTREAM', `reviews[${index}] names unknown workstream ${workstreamId}`)
      }
    } else if (workstreams.length > 0) {
      fail('WORKSTREAM_REVIEW_REQUIRED', `reviews[${index}] for ${taskId} must name its workstream_id`)
    }
    reviews.push({ taskId, workstreamId, verdict: 'pass', defects: [] })
  }
  const missing = completed.filter((taskId) => !seen.has(taskId))
  if (missing.length > 0) fail('TASK_REVIEWS_INCOMPLETE', `missing per-task reviews: ${missing.join(', ')}`)
  if (workstreams.length > 0) {
    const reviewed = new Set(reviews.map((review) => review.workstreamId))
    const uncovered = workstreams.filter((workstream) => !reviewed.has(workstream.id)).map((workstream) => workstream.id)
    if (uncovered.length > 0) fail('WORKSTREAM_REVIEWS_INCOMPLETE', `workstreams without a review: ${uncovered.join(', ')}`)
  }
  return reviews
}

/**
 * Validate one 门下省 gate verdict.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @param {Array<object>} tasks Current Team task views.
 * @returns {{kind: 'plan'|'result', verdict: 'pass'|'reject', defects: string[], checked: string[], reviews: Array<object>, summary: string|null}} Normalized gate.
 */
export function validateGateInput(state, input, caller, tasks = []) {
  assertExpectedRevision(state, input)
  assertActive(state)
  if (caller.role !== 'teammate') {
    fail('REVIEWER_MUST_BE_TEAMMATE', 'the reviewer must be an independent teammate; the Lead can never approve its own work')
  }
  const kind = input?.kind
  if (!GATE_KINDS.includes(kind)) fail('INVALID_GATE_KIND', 'kind must be "plan" or "result"')
  const verdict = input?.verdict
  if (verdict !== 'pass' && verdict !== 'reject') fail('INVALID_VERDICT', 'verdict must be "pass" or "reject"')
  if (kind === 'result' && validPlanGate(state) === undefined) {
    fail('PLAN_GATE_NOT_PASSED', 'the plan gate must pass after the current edict revision before the result gate can be reviewed')
  }
  const defects = stringList(input?.defects, 'defects', verdict === 'reject' ? 1 : 0, 20)
  if (verdict === 'pass' && defects.length > 0) {
    fail('DEFECTS_ON_PASS', 'a passing verdict cannot carry blocking defects')
  }
  if (appointedMembers(state).includes(caller.name)) {
    fail('SELF_REVIEW_NOT_ALLOWED', `${caller.name} is appointed to a 六部 and cannot review its own delivery; the reviewer must be outside the executing ministries`)
  }
  if (tasks.some((task) => task !== null && typeof task === 'object' && task.status !== 'deleted' && task.ownerName === caller.name)) {
    fail('REVIEWER_IS_EXECUTOR', `${caller.name} owns a shared task in this case and cannot review it`)
  }
  const checked = verdict === 'pass' ? stringList(input?.checked, 'checked', 1, 20) : []
  const conditions = stringList(input?.conditions, 'conditions', 0, 20)
  if (verdict === 'reject' && conditions.length > 0) {
    fail('CONDITIONS_ON_REJECT', 'a rejected verdict cannot carry approval conditions')
  }
  if (verdict === 'pass' && kind === 'plan') {
    const previous = latestGate(state, 'plan')
    if (previous !== undefined && previous.verdict === 'reject'
      && (state.edict.rev === null || state.edict.rev <= previous.rev)) {
      fail('PLAN_NOT_REVISED', 'the plan was 封驳; revise the edict with sansheng_edict before a new plan review')
    }
  }
  if (verdict === 'pass' && kind === 'result' && state.evidence.length === 0) {
    fail('NO_EVIDENCE_TO_REVIEW', 'the result gate needs at least one evidence record submitted by 刑部')
  }
  let reviews = []
  if (kind === 'result' && verdict === 'pass') {
    const planGate = latestGate(state, 'plan')
    if (planGate !== undefined && planGate.reviewer === caller.name) {
      fail('REVIEWER_MUST_DIFFER', 'the plan and result gates must be reviewed by different teammates')
    }
    const previousResult = latestGate(state, 'result')
    if (previousResult !== undefined && previousResult.verdict === 'reject') {
      const latestEvidenceRev = state.evidence.reduce((max, record) => Math.max(max, record.rev ?? 0), 0)
      if (latestEvidenceRev <= (previousResult.rev ?? 0)) {
        fail('RESULT_NOT_REVISED', 'the delivery was 封驳; submit new evidence after the rejection before a new result review')
      }
    }
    reviews = reviewList(input?.reviews, tasks, Array.isArray(state.edict?.workstreams) ? state.edict.workstreams : [])
  }
  const summary = input?.summary === undefined || input.summary === null
    ? null
    : requiredString(input.summary, 'summary', 2000)
  return { kind, verdict, defects, checked, conditions, reviews, summary }
}

/**
 * Validate one independent audit record. An auditor must be a teammate outside
 * the executing departments (except an appointed 刑部), must not own a shared
 * task, and must differ from the gate reviewer. A passing audit of a gate with
 * approval conditions must confirm every condition.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {Array<object>} tasks Current Team task views.
 * @param {{role: string, name: string}} caller Resolved Team membership.
 * @returns {{scope: 'plan'|'result', verdict: 'pass'|'reject', checks: string[], conditionsMet: string[], defects: string[], summary: string|null}} Normalized audit.
 */
export function validateAuditInput(state, input, tasks, caller) {
  assertExpectedRevision(state, input)
  assertActive(state)
  if (caller.role !== 'teammate') {
    fail('AUDITOR_MUST_BE_TEAMMATE', 'an independent teammate (not the Lead) must perform the audit')
  }
  const scope = input?.scope
  if (!GATE_KINDS.includes(scope)) fail('INVALID_AUDIT_SCOPE', 'scope must be "plan" or "result"')
  const gate = latestGate(state, scope)
  if (gate === undefined || gate.verdict !== 'pass') {
    fail('GATE_NOT_PASSED', `the ${scope} gate must pass before it can be audited`)
  }
  if (gate.reviewer === caller.name) {
    fail('AUDITOR_MUST_BE_INDEPENDENT', `${caller.name} reviewed this gate and cannot also audit it`)
  }
  const appointment = state.appointments.find((entry) => entry.member === caller.name)
  if (appointment !== undefined && appointment.department !== '刑部') {
    fail('AUDITOR_MUST_BE_INDEPENDENT', `${caller.name} is appointed to ${appointment.department}; only 刑部 may audit from inside the ministries`)
  }
  if (tasks.some((task) => task !== null && typeof task === 'object' && task.status !== 'deleted' && task.ownerName === caller.name)) {
    fail('AUDITOR_IS_EXECUTOR', `${caller.name} owns a shared task and cannot audit it`)
  }
  const verdict = input?.verdict
  if (verdict !== 'pass' && verdict !== 'reject') fail('INVALID_VERDICT', 'verdict must be "pass" or "reject"')
  const defects = stringList(input?.defects, 'defects', verdict === 'reject' ? 1 : 0, 20)
  if (verdict === 'pass' && defects.length > 0) {
    fail('DEFECTS_ON_PASS', 'a passing audit cannot carry blocking defects')
  }
  const conditions = Array.isArray(gate.conditions) ? gate.conditions : []
  const conditionsMet = stringList(input?.conditions_met, 'conditions_met', 0, 20)
  for (const condition of conditionsMet) {
    if (!conditions.includes(condition)) {
      fail('UNKNOWN_AUDIT_CONDITION', `"${condition}" is not an approval condition of the latest ${scope} gate`)
    }
  }
  if (verdict === 'pass') {
    const missing = conditions.filter((condition) => !conditionsMet.includes(condition))
    if (missing.length > 0) {
      fail('GATE_CONDITIONS_UNMET', `a passing audit must confirm every condition: ${missing.join(', ')}`)
    }
  }
  const checks = stringList(input?.checks, 'checks', 1, 20)
  const summary = input?.summary === undefined || input.summary === null
    ? null
    : requiredString(input.summary, 'summary', 2000)
  return { scope, verdict, checks, conditionsMet, defects, summary }
}

/**
 * Validate one 刑部 evidence record. Evidence must cover a completed shared
 * task and carry a digest and excerpt; the same command+digest cannot be
 * submitted twice for one task.
 * @param {object} state Board state.
 * @param {object} input Raw tool arguments.
 * @param {Array<{id: string, status?: string}>} tasks Current Team task views.
 * @returns {{taskId: string, command: string, exitCode: number, digest: string, excerpt: string, sourceSessionId: string|null}} Normalized evidence.
 */
export function validateEvidenceInput(state, input, tasks = []) {
  assertExpectedRevision(state, input)
  assertActive(state)
  const taskId = requiredString(input?.task_id, 'task_id', 32)
  if (!/^task-\d+$/.test(taskId)) fail('INVALID_TASK_ID', 'task_id must look like task-<n>')
  const task = tasks.find((candidate) => candidate?.id === taskId)
  if (task === undefined) {
    fail('TASK_NOT_FOUND', `${taskId} is not on the shared task board; create the task before submitting evidence`)
  }
  if (task.status !== 'completed') {
    fail('TASK_NOT_COMPLETED', `${taskId} is ${String(task.status)}; evidence must cover a completed shared task`)
  }
  const command = requiredString(input?.command, 'command', 4000)
  const exitCode = input?.exit_code
  if (!Number.isInteger(exitCode)) fail('INVALID_EXIT_CODE', 'exit_code must be an integer process exit code')
  const digest = requiredString(input?.digest, 'digest', 200)
  if (!/^[a-fA-F0-9]{16,128}$/.test(digest)) fail('INVALID_DIGEST', 'digest must be a hexadecimal output digest (16-128 characters)')
  const excerpt = requiredString(input?.excerpt, 'excerpt', 8000)
  const workstreams = Array.isArray(state.edict?.workstreams) ? state.edict.workstreams : []
  let workstreamId = null
  if (input?.workstream_id !== undefined && input.workstream_id !== null && input.workstream_id !== '') {
    workstreamId = requiredString(input.workstream_id, 'workstream_id', 40)
    if (!workstreams.some((workstream) => workstream.id === workstreamId)) {
      fail('UNKNOWN_WORKSTREAM', `${workstreamId} is not a workstream of the current edict`)
    }
  } else if (workstreams.length > 0) {
    fail('WORKSTREAM_EVIDENCE_REQUIRED', 'this edict declares workstreams; evidence must name its workstream_id')
  }
  if (state.evidence.some((record) => record.taskId === taskId && record.command === command && record.digest === digest)) {
    fail('DUPLICATE_EVIDENCE', `evidence for ${taskId} with this command and digest is already recorded`)
  }
  const sourceSessionId = optionalString(input?.source_session_id, 'source_session_id', 200)
  return { taskId, command, exitCode, digest, excerpt, workstreamId, sourceSessionId }
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
  assertExpectedRevision(state, input)
  assertActive(state)
  if (caller.role !== 'lead') fail('LEAD_ONLY', 'only the Lead (尚书省) may close the case')
  if (validPlanGate(state) === undefined) {
    fail('PLAN_GATE_NOT_PASSED', 'cannot close before the 门下省 plan gate passes after the current edict revision')
  }
  if (latestGate(state, 'result')?.verdict !== 'pass') {
    fail('RESULT_GATE_NOT_PASSED', 'cannot close before the 门下省 result gate passes')
  }
  const openTasks = tasks
    .filter((task) => task !== null && typeof task === 'object' && task.status !== 'completed' && task.status !== 'deleted')
    .map((task) => task.id)
  if (openTasks.length > 0) {
    fail('OPEN_TASKS', `cannot close with unfinished shared tasks: ${openTasks.join(', ')}`)
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
  const workstreams = Array.isArray(state.edict?.workstreams) ? state.edict.workstreams : []
  if (workstreams.length > 0) {
    const coveredStreams = new Set(state.evidence.map((record) => record.workstreamId).filter((id) => typeof id === 'string'))
    const uncovered = workstreams.filter((workstream) => !coveredStreams.has(workstream.id)).map((workstream) => workstream.id)
    if (uncovered.length > 0) fail('WORKSTREAM_WITHOUT_EVIDENCE', `workstreams without evidence: ${uncovered.join(', ')}`)
  }
  for (const scope of GATE_KINDS) {
    const gate = latestGate(state, scope)
    const conditions = Array.isArray(gate?.conditions) ? gate.conditions : []
    if (conditions.length === 0) continue
    const audit = latestAudit(state, scope)
    if (audit === undefined || audit.verdict !== 'pass' || audit.rev <= gate.rev) {
      fail('GATE_CONDITIONS_UNMET', `the ${scope} gate has approval conditions that need a newer passing independent audit`)
    }
    const met = new Set(audit.conditionsMet)
    const missing = conditions.filter((condition) => !met.has(condition))
    if (missing.length > 0) fail('GATE_CONDITIONS_UNMET', `unmet ${scope} conditions: ${missing.join(', ')}`)
  }
  if (state.edict.riskLevel === 'high' || state.edict.riskLevel === 'irreversible') {
    const resultGate = latestGate(state, 'result')
    const audit = latestAudit(state, 'result')
    if (audit === undefined || audit.verdict !== 'pass' || (resultGate !== undefined && audit.rev <= resultGate.rev)) {
      fail('HIGH_RISK_AUDIT_REQUIRED', 'high/irreversible work needs a passing independent result audit after the result gate')
    }
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
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.filter((item) => typeof item === 'string') : [],
    risks: Array.isArray(value.risks) ? value.risks.filter((item) => typeof item === 'string') : [],
    tools: Array.isArray(value.tools) ? value.tools.filter((item) => typeof item === 'string') : [],
    dataScope: Array.isArray(value.dataScope) ? value.dataScope.filter((item) => typeof item === 'string') : [],
    riskLevel: RISK_LEVELS.includes(value.riskLevel) ? value.riskLevel : 'low',
    budget: typeof value.budget === 'string' ? value.budget : null,
    workstreams: Array.isArray(value.workstreams)
      ? value.workstreams
        .filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string'
          && typeof item.department === 'string' && typeof item.deliverable === 'string')
        .map((item) => ({
          id: item.id,
          department: item.department,
          deliverable: item.deliverable,
          acceptance: Array.isArray(item.acceptance) ? item.acceptance.filter((entry) => typeof entry === 'string') : [],
          writeScopes: Array.isArray(item.writeScopes) ? item.writeScopes.filter((entry) => typeof entry === 'string') : [],
        }))
      : [],
    rev: Number.isInteger(value.rev) && value.rev > 0 ? value.rev : null,
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
    role: typeof value.role === 'string' ? value.role : (ministryRole(value.department)?.label ?? null),
    roleDuty: typeof value.roleDuty === 'string' ? value.roleDuty : (ministryRole(value.department)?.duty ?? null),
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
    checked: Array.isArray(value.checked) ? value.checked.filter((item) => typeof item === 'string') : [],
    conditions: Array.isArray(value.conditions) ? value.conditions.filter((item) => typeof item === 'string') : [],
    reviews: Array.isArray(value.reviews)
      ? value.reviews
        .filter((item) => item !== null && typeof item === 'object' && typeof item.taskId === 'string')
        .map((item) => ({
          taskId: item.taskId,
          workstreamId: typeof item.workstreamId === 'string' ? item.workstreamId : null,
          verdict: item.verdict === 'pass' ? 'pass' : 'reject',
          defects: Array.isArray(item.defects) ? item.defects.filter((entry) => typeof entry === 'string') : [],
        }))
      : [],
    summary: typeof value.summary === 'string' ? value.summary : null,
    rev: Number.isInteger(value.rev) && value.rev > 0 ? value.rev : null,
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
    workstreamId: typeof value.workstreamId === 'string' ? value.workstreamId : null,
    sourceSessionId: typeof value.sourceSessionId === 'string' ? value.sourceSessionId : null,
    rev: Number.isInteger(value.rev) && value.rev > 0 ? value.rev : null,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : null,
  }
}

/**
 * @param {unknown} value Raw stored audit.
 * @returns {object|null} Stored audit or null.
 */
function normalizeStoredAudit(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.id !== 'string' || typeof value.scope !== 'string' || typeof value.auditor !== 'string') return null
  if (!GATE_KINDS.includes(value.scope)) return null
  if (value.verdict !== 'pass' && value.verdict !== 'reject') return null
  return {
    id: value.id,
    scope: value.scope,
    verdict: value.verdict,
    auditor: value.auditor,
    checks: Array.isArray(value.checks) ? value.checks.filter((item) => typeof item === 'string') : [],
    conditionsMet: Array.isArray(value.conditionsMet) ? value.conditionsMet.filter((item) => typeof item === 'string') : [],
    defects: Array.isArray(value.defects) ? value.defects.filter((item) => typeof item === 'string') : [],
    summary: typeof value.summary === 'string' ? value.summary : null,
    rev: Number.isInteger(value.rev) && value.rev > 0 ? value.rev : null,
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

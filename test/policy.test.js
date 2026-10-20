import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_NAMES,
  SanshengError,
  TIERS,
  appointedMembers,
  boardAlerts,
  casePhase,
  completedTasksWithoutEvidence,
  createEmptyState,
  createInitialState,
  foldEvent,
  latestGate,
  summarizeBoard,
  validateAppointInput,
  validateAuditInput,
  validateCloseInput,
  validateEdictInput,
  validateEvidenceInput,
  validateGateInput,
  validateIntakeInput,
  validateModeAction,
  validateTriageInput,
} from '../src/policy.js'

const LEAD = { role: 'lead', name: 'lead' }
const REVIEWER = { role: 'teammate', name: 'menxia' }
const SECOND_REVIEWER = { role: 'teammate', name: 'yushi' }
const WORKER = { role: 'teammate', name: 'gongbu' }
const TASKS = [{ id: 'task-1', status: 'completed', ownerName: 'gongbu' }]

function assertCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof SanshengError, `expected SanshengError, got ${error}`)
    assert.equal(error.code, code, error.message)
    return true
  })
}

function record(op, payload, rev) {
  return JSON.stringify({ sansheng: 1, op, ...(rev === undefined ? {} : { rev }), ...payload })
}

function toolResult(text) {
  return { type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text }] } } }
}

function teammateMessage(text) {
  return {
    type: 'user/message',
    data: {
      source: { kind: 'agent-message' },
      content: [{ type: 'text', text: `Team message from menxia: ${text}` }],
    },
  }
}

function marked(text) {
  return `SANS_RECORD_V1 ${text}`
}

function append(state, op, payload) {
  const rev = state.revision + 1
  return foldEvent(state, toolResult(record(op, payload, rev)))
}

function baseEdict(overrides = {}) {
  return {
    revision: 1,
    rev: 2,
    goal: 'ship the change',
    acceptance: ['npm test passes'],
    boundaries: [],
    tier: 'medium',
    rosterCap: 5,
    departments: ['工部', '刑部'],
    createdAt: null,
    ...overrides,
  }
}

function activeState(edict = baseEdict()) {
  let state = append(createEmptyState(), 'mode', { active: true })
  state = append(state, 'intake', {
    intake: {
      id: 'intake-1',
      request: 'please ship the change',
      intent: 'ship the change',
      nonGoals: [],
      ambiguities: [],
      needsClarification: false,
      clarificationQuestion: null,
      by: 'lead',
      rev: state.revision + 1,
      createdAt: null,
    },
  })
  state = append(state, 'edict', { edict })
  return state
}

function planPass(state, options = {}) {
  const rev = options.rev ?? state.revision + 1
  return foldEvent(state, toolResult(record('gate', {
    gate: {
      id: 'gate-plan',
      kind: 'plan',
      verdict: 'pass',
      reviewer: options.reviewer ?? 'menxia',
      defects: [],
      checked: options.checked ?? ['acceptance reviewed'],
      conditions: options.conditions ?? [],
      reviews: [],
      summary: null,
      rev,
      createdAt: null,
    },
  }, rev)))
}

function planReject(state, options = {}) {
  const rev = options.rev ?? state.revision + 1
  return foldEvent(state, toolResult(record('gate', {
    gate: {
      id: 'gate-reject',
      kind: 'plan',
      verdict: 'reject',
      reviewer: 'menxia',
      defects: ['acceptance missing'],
      checked: [],
      conditions: [],
      reviews: [],
      summary: null,
      rev,
      createdAt: null,
    },
  }, rev)))
}

function appointment(state) {
  return append(state, 'appoint', {
    appointment: {
      id: 'ap-1',
      member: 'gongbu',
      department: '工部',
      responsibility: null,
      writeScopes: ['src'],
      createdAt: null,
    },
  })
}

function evidence(state, options = {}) {
  return append(state, 'evidence', {
    evidence: {
      id: 'ev-1',
      taskId: options.taskId ?? 'task-1',
      command: options.command ?? 'npm test',
      exitCode: 0,
      digest: options.digest ?? 'a'.repeat(64),
      excerpt: options.excerpt ?? 'ok',
      submittedBy: 'xingbu',
      workstreamId: options.workstreamId ?? null,
      sourceSessionId: null,
      rev: state.revision + 1,
      createdAt: null,
    },
  })
}

function resultPass(state, options = {}) {
  const rev = options.rev ?? state.revision + 1
  return foldEvent(state, toolResult(record('gate', {
    gate: {
      id: 'gate-result',
      kind: 'result',
      verdict: 'pass',
      reviewer: options.reviewer ?? 'yushi',
      defects: [],
      checked: options.checked ?? ['evidence reviewed'],
      conditions: options.conditions ?? [],
      reviews: options.reviews ?? [{ taskId: 'task-1', verdict: 'pass', defects: [] }],
      summary: null,
      rev,
      createdAt: null,
    },
  }, rev)))
}

function readyForResult() {
  return evidence(appointment(planPass(activeState())))
}

function closedState() {
  return resultPass(readyForResult())
}

function riskEdict(overrides = {}) {
  return baseEdict({
    riskLevel: 'high',
    assumptions: ['workspace is writable'],
    risks: ['a failed deployment may leave the workspace dirty'],
    tools: ['bash', 'edit'],
    dataScope: ['src/'],
    budget: 'max 40 tool calls, 2 engineers',
    ...overrides,
  })
}

function audit(state, options = {}) {
  return append(state, 'audit', {
    audit: {
      id: `audit-${options.id ?? 1}`,
      scope: options.scope ?? 'plan',
      verdict: options.verdict ?? 'pass',
      auditor: options.auditor ?? 'shenji',
      checks: options.checks ?? ['checked the gate conditions'],
      conditionsMet: options.conditionsMet ?? [],
      defects: options.defects ?? [],
      summary: null,
      rev: state.revision + 1,
      createdAt: null,
    },
  })
}

/* Projection fold */

test('an agent-preset selection event activates or deactivates the mode', () => {
  const base = createEmptyState()
  const selected = foldEvent(base, { type: 'agent-preset/selected', data: { agentPreset: 'sansheng' } }, 'sansheng')
  assert.equal(selected.active, true)
  assert.equal(selected.caseId, 1)
  const standard = foldEvent(selected, { type: 'agent-preset/selected', data: { agentPreset: 'standard' } }, 'sansheng')
  assert.equal(standard.active, false)
  const unrelated = foldEvent(base, { type: 'agent-preset/selected', data: { agentPreset: 'sansheng' } }, 'other')
  assert.equal(unrelated.active, false)
})

test('createInitialState activates only for the 三省六部 preset', () => {
  assert.equal(createInitialState(undefined, 'sansheng').active, false)
  assert.equal(createInitialState({ agentPreset: 'standard' }, 'sansheng').active, false)
  assert.equal(createInitialState({ agentPreset: 'sansheng' }, 'sansheng').active, true)
  assert.equal(createInitialState({ agentPreset: 'sansheng' }, '').active, false)
})

test('empty state starts inactive with a clean revision', () => {
  const state = createEmptyState()
  assert.equal(state.active, false)
  assert.equal(state.edict, null)
  assert.deepEqual(state.appointments, [])
  assert.deepEqual(state.gates, [])
  assert.deepEqual(state.evidence, [])
  assert.equal(state.closure, null)
  assert.equal(state.abandoned, null)
  assert.equal(state.revision, 0)
})

test('foldEvent applies explicit record revisions and ignores stale ones', () => {
  let state = createEmptyState()
  state = foldEvent(state, toolResult(record('mode', { active: true }, 1)))
  assert.equal(state.revision, 1)
  const stale = foldEvent(state, toolResult(record('mode', { active: false }, 1)))
  assert.equal(stale.revision, 1)
  assert.equal(stale.active, true)
  const next = foldEvent(state, toolResult(record('edict', { edict: baseEdict() }, 2)))
  assert.equal(next.revision, 2)
  assert.equal(next.edict.goal, baseEdict().goal)
})

test('legacy records without rev replay sequentially', () => {
  let state = createEmptyState()
  state = foldEvent(state, toolResult(record('mode', { active: true })))
  state = foldEvent(state, toolResult(record('edict', { edict: baseEdict() })))
  assert.equal(state.revision, 2)
  assert.equal(state.active, true)
})

test('an abandonment record is durable and a new enter clears it', () => {
  let state = activeState()
  state = foldEvent(state, toolResult(record('mode', { active: false, abandoned: 'budget cut' })))
  assert.equal(state.active, false)
  assert.equal(state.abandoned.reason, 'budget cut')
  state = foldEvent(state, toolResult(record('mode', { active: true })))
  assert.equal(state.abandoned, null)
})

test('later gate verdicts override earlier ones and gate revisions are stored', () => {
  let state = planReject(activeState())
  assert.equal(latestGate(state, 'plan')?.verdict, 'reject')
  assert.ok(latestGate(state, 'plan')?.rev > 0)
  state = planPass(state)
  assert.equal(latestGate(state, 'plan')?.verdict, 'pass')
  assert.equal(state.gates.length, 2)
})

test('unknown and malformed events are ignored during replay', () => {
  const state = activeState()
  assert.equal(foldEvent(state, { type: 'other/event', data: {} }), state)
  assert.equal(foldEvent(state, null), state)
  assert.equal(foldEvent(state, toolResult('not json')), state)
  assert.equal(foldEvent(state, toolResult(JSON.stringify({ sansheng: 1, op: 'gate' }))), state)
  assert.equal(foldEvent(state, toolResult(JSON.stringify({ hello: 1 }))), state)
  assert.equal(
    foldEvent(state, { type: 'tool/result', data: { message: { isError: true, content: [{ type: 'text', text: record('mode', { active: true }) }] } } }),
    state,
  )
})

test('a teammate message can carry a board record into the Lead log', () => {
  const state = activeState()
  const rev = state.revision + 1
  const next = foldEvent(state, teammateMessage(marked(record('gate', {
    gate: {
      id: 'gate-9', kind: 'plan', verdict: 'reject', reviewer: 'menxia',
      defects: ['no command'], checked: [], reviews: [], summary: null, rev, createdAt: null,
    },
  }, rev))))
  assert.equal(latestGate(next, 'plan')?.verdict, 'reject')
  assert.deepEqual(latestGate(next, 'plan')?.defects, ['no command'])
})

test('the board keeps a bounded audit history and folds denied calls', () => {
  let state = activeState()
  assert.equal(state.history.length, 3)
  assert.equal(state.history[0].op, 'mode')
  assert.equal(state.history[1].op, 'intake')
  assert.equal(state.history[2].op, 'edict')
  const denied = foldEvent(state, {
    type: 'tool/result',
    time: 1234567890,
    data: { message: { role: 'tool', isError: true, content: [{ type: 'text', text: 'Error: STALE_REVISION: expected revision 1 but board is at 2' }] } },
  })
  assert.equal(denied.revision, state.revision)
  assert.equal(denied.history.at(-1).op, 'denied')
  assert.equal(denied.history.at(-1).code, 'STALE_REVISION')
  assert.equal(denied.updatedAt, 1234567890)
})

test('board alerts escalate a stalled board through three levels', () => {
  const base = closedState()
  const at = (minutes) => ({ ...base, updatedAt: Date.now() - minutes * 60 * 1000 })
  const warn = boardAlerts(at(35), [{ id: 'task-1', status: 'completed' }])
  assert.ok(warn.some((line) => line.includes('先 sansheng_board')))
  const escalate = boardAlerts(at(65), [{ id: 'task-1', status: 'completed' }])
  assert.ok(escalate.some((line) => line.includes('interrupt_agent')))
  const emperor = boardAlerts(at(125), [{ id: 'task-1', status: 'completed' }])
  assert.ok(emperor.some((line) => line.includes('上奏')))
})

test('board alerts expose unfinished work and stale boards', () => {
  const state = closedState()
  const alerts = boardAlerts(state, [
    { id: 'task-1', status: 'completed' },
    { id: 'task-2', status: 'in_progress' },
  ], (state.updatedAt ?? Date.now()) + 31 * 60 * 1000)
  assert.ok(alerts.some((line) => line.includes('未完成任务')))
  const staleState = { ...state, updatedAt: Date.now() - 31 * 60 * 1000 }
  assert.ok(boardAlerts(staleState, [{ id: 'task-1', status: 'completed' }]).some((line) => line.includes('停滞')))
})

test('ordinary teammate messages do not change the board', () => {
  const state = activeState()
  assert.equal(foldEvent(state, teammateMessage('制敕已修订，请重新审议。')), state)
})

/* Mode action */

test('mode actions require the current revision and a close-or-abandon leave', () => {
  const state = activeState()
  assertCode(() => validateModeAction(state, { action: 'leave' }), 'MISSING_EXPECTED_REVISION')
  assertCode(
    () => validateModeAction(state, { action: 'leave', expected_revision: state.revision }),
    'LEAVE_REQUIRES_CLOSE_OR_ABANDON',
  )
  const abandoned = validateModeAction(state, {
    action: 'leave',
    expected_revision: state.revision,
    abandon_reason: 'budget cut',
  })
  assert.equal(abandoned.abandonReason, 'budget cut')
  assertCode(
    () => validateModeAction(state, { action: 'enter', expected_revision: state.revision - 1 }),
    'STALE_REVISION',
  )
  assert.equal(validateModeAction(state, { action: 'status' }).action, 'status')
})

test('enter after a closed case starts a new sequential case and archives the old one', () => {
  const state = foldEvent(closedState(), toolResult(record('close', {
    closure: { id: 'close-1', conclusions: ['done'], deliverables: ['d'], unknowns: [], next: [], closedBy: 'lead', createdAt: null },
  })))
  assert.doesNotThrow(() => validateModeAction(state, { action: 'enter', expected_revision: state.revision }))
  const reopened = append(state, 'mode', { active: true })
  assert.equal(reopened.active, true)
  assert.equal(reopened.caseId, 2)
  assert.equal(reopened.edict, null)
  assert.equal(reopened.closure, null)
  assert.deepEqual(reopened.appointments, [])
  assert.equal(reopened.cases.length, 1)
  assert.equal(reopened.cases[0].outcome, 'closed')
  assert.equal(reopened.cases[0].caseId, 1)
  assert.equal(reopened.history.at(-1).newCase, true)
})

test('first manual entry starts case 1 and re-entry after abandon starts a new case', () => {
  let state = append(createEmptyState(), 'mode', { active: true })
  assert.equal(state.caseId, 1)
  state = activeState()
  state = append(state, 'mode', { active: false, abandoned: 'switch task' })
  assert.equal(state.abandoned.reason, 'switch task')
  assert.doesNotThrow(() => validateModeAction(state, { action: 'enter', expected_revision: state.revision }))
  const reopened = append(state, 'mode', { active: true })
  assert.equal(reopened.caseId, 2)
  assert.equal(reopened.abandoned, null)
  assert.equal(reopened.cases.at(-1).outcome, 'abandoned')
})

/* Edict */

test('validateEdictInput normalizes a valid edict and defaults the roster cap', () => {
  const state = createEmptyState()
  const edict = validateEdictInput(state, {
    goal: '  ship it  ',
    acceptance: [' tests pass '],
    boundaries: [],
    tier: 'medium',
    departments: ['工部'],
    expected_revision: 0,
  })
  assert.equal(edict.goal, 'ship it')
  assert.deepEqual(edict.acceptance, ['tests pass'])
  assert.equal(edict.rosterCap, TIERS.medium)
  assert.deepEqual(edict.departments, ['工部'])
})

test('edict validation rejects bad tier, caps, missing fields and stale revisions', () => {
  const state = createEmptyState()
  const base = { acceptance: ['x'], tier: 'medium', expected_revision: 0 }
  assertCode(() => validateEdictInput(state, { ...base, goal: '' }), 'INVALID_FIELD')
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', acceptance: [] }), 'INVALID_FIELD')
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', tier: 'huge' }), 'INVALID_TIER')
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', roster_cap: 9 }), 'ROSTER_CAP_ABOVE_TIER')
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', tier: 'small', roster_cap: 2 }), 'SMALL_TIER_NEEDS_ONE_VERIFIER')
  assert.equal(validateEdictInput(state, { ...base, goal: 'g', tier: 'small', roster_cap: 1 }).rosterCap, 1)
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', roster_cap: 99 }), 'INVALID_ROSTER_CAP')
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', expected_revision: 1 }), 'STALE_REVISION')
})

/* Appointment */

test('appointment is rejected before the plan gate passes', () => {
  const state = activeState()
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD),
    'PLAN_GATE_NOT_PASSED',
  )
})

test('appointment succeeds after the plan gate and enforces departments', () => {
  const state = planPass(activeState())
  const appointmentResult = validateAppointInput(
    state,
    { member: 'gongbu', department: '工部', write_scopes: ['src/**'], responsibility: 'build', expected_revision: state.revision },
    LEAD,
  )
  assert.equal(appointmentResult.member, 'gongbu')
  assert.equal(appointmentResult.department, '工部')
  assert.deepEqual(appointmentResult.writeScopes, ['src/**'])
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '中书省', expected_revision: state.revision }, LEAD),
    'UNKNOWN_DEPARTMENT',
  )
  assert.ok(DEPARTMENT_NAMES.length === 6)
})

test('appointment is Lead-only and never duplicates a member', () => {
  const state = appointment(planPass(activeState()))
  assertCode(
    () => validateAppointInput(state, { member: 'xingbu', department: '刑部', expected_revision: state.revision }, WORKER),
    'LEAD_ONLY',
  )
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD),
    'MEMBER_ALREADY_APPOINTED',
  )
  assertCode(
    () => validateAppointInput(state, { member: 'lead', department: '工部', expected_revision: state.revision }, LEAD),
    'CANNOT_APPOINT_LEAD',
  )
})

test('appointment cannot exceed the roster cap', () => {
  const state = appointment(planPass(activeState(baseEdict({ rosterCap: 1 }))))
  assertCode(
    () => validateAppointInput(state, { member: 'xingbu', department: '刑部', expected_revision: state.revision }, LEAD),
    'ROSTER_CAP_EXCEEDED',
  )
})

test('write scopes must stay workspace-relative', () => {
  const state = planPass(activeState())
  assertCode(
    () => validateAppointInput(state, { member: 'a', department: '工部', write_scopes: ['/etc/passwd'], expected_revision: state.revision }, LEAD),
    'INVALID_WRITE_SCOPE',
  )
  assertCode(
    () => validateAppointInput(state, { member: 'a', department: '工部', write_scopes: ['../outside'], expected_revision: state.revision }, LEAD),
    'INVALID_WRITE_SCOPE',
  )
})

/* Gates */

test('a pass must cite checked items and be cast by an independent teammate', () => {
  const state = activeState()
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'pass', checked: ['x'], expected_revision: state.revision }, LEAD),
    'REVIEWER_MUST_BE_TEAMMATE',
  )
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'pass', expected_revision: state.revision }, REVIEWER),
    'INVALID_FIELD',
  )
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'reject', defects: [], expected_revision: state.revision }, REVIEWER),
    'INVALID_FIELD',
  )
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'pass', defects: ['oops'], checked: ['x'], expected_revision: state.revision }, REVIEWER),
    'DEFECTS_ON_PASS',
  )
})

test('small tier is a light path: one verifier, no plan gate, result gate + close', () => {
  let state = activeState(baseEdict({ tier: 'small', rosterCap: 1, departments: [] }))
  assert.equal(casePhase(state), 'executing')
  state = evidence(state)
  state = resultPass(state)
  assert.equal(casePhase(state), 'ready_to_close')
  const report = validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD)
  assert.deepEqual(report.conclusions, ['done'])
})

test('triage derives the four levels and an explicit user tier wins', () => {
  const trivial = validateTriageInput({ task: 'one command' })
  assert.equal(trivial.tier, 'trivial')
  assert.equal(trivial.useMode, false)
  assert.equal(validateTriageInput({ task: 'one change', needs_independent_review: true }).tier, 'small')
  assert.equal(validateTriageInput({ task: 'multi', needs_independent_review: true, needs_plan_gate: true }).tier, 'medium')
  assert.equal(validateTriageInput({ task: 'risky', needs_independent_review: true, needs_plan_gate: true, needs_meta_review: true }).tier, 'large')
  const requested = validateTriageInput({ task: 'make it medium', requested_tier: 'medium' })
  assert.equal(requested.tier, 'medium')
  assert.equal(requested.tierSource, 'user')
  assert.equal(requested.mismatch, true)
  assert.ok(requested.guidance.includes('完整中事'))
})

test('skip records a trivial preset session without drafting an edict', () => {
  const presetActive = foldEvent(createEmptyState(), { type: 'agent-preset/selected', data: { agentPreset: 'sansheng' } }, 'sansheng')
  assert.doesNotThrow(() => validateModeAction(presetActive, { action: 'skip', reason: 'trivial task', expected_revision: presetActive.revision }))
  const skipped = append(presetActive, 'mode', { active: false, skipped: true, reason: 'trivial task' })
  assert.equal(skipped.active, false)
  assert.equal(skipped.history.at(-1).skipped, true)
  const open = activeState()
  assertCode(() => validateModeAction(open, { action: 'skip', reason: 'late', expected_revision: open.revision }), 'SKIP_AFTER_EDICT')
})

test('case phase is derived from the same event log', () => {
  let state = createEmptyState()
  assert.equal(casePhase(state), 'idle')
  state = planPass(activeState())
  assert.equal(casePhase(state), 'dispatching')
  state = appointment(state)
  assert.equal(casePhase(state), 'executing')
  state = resultPass(evidence(state))
  assert.equal(casePhase(state), 'ready_to_close')
  let awaiting = planPass(activeState(riskEdict()))
  assert.equal(casePhase(awaiting), 'awaiting_human')
  awaiting = foldEvent(awaiting, {
    type: 'command/run', time: 1700000000000,
    data: { name: 'sansheng', args: 'approve 允许部署', source: { kind: 'user' } },
  })
  assert.equal(casePhase(awaiting), 'dispatching')
})

test('three rejections on one gate escalate to the user instead of looping', () => {
  let state = activeState()
  for (let index = 0; index < 3; index += 1) state = planReject(state)
  const alerts = boardAlerts(state, [])
  assert.ok(alerts.some((line) => line.includes('计划封驳已达 3 轮') && line.includes('上奏用户')))
})

test('a user /sansheng command records 御批 and gates large-tier appointments', () => {
  let state = planPass(activeState(baseEdict({ tier: 'large', rosterCap: 9 })))
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD),
    'USER_APPROVAL_REQUIRED',
  )
  state = foldEvent(state, {
    type: 'command/run',
    time: 1700000000000,
    data: { name: 'sansheng', args: 'approve 计划可以', source: { kind: 'user' } },
  })
  assert.equal(state.approvals.length, 1)
  assert.equal(state.approvals[0].decision, 'approve')
  assert.equal(state.approvals[0].reason, '计划可以')
  assert.equal(state.history.at(-1).op, 'approval')
  const appointmentResult = validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD)
  assert.equal(appointmentResult.member, 'gongbu')

  state = foldEvent(state, {
    type: 'command/run',
    time: 1700000001000,
    data: { name: 'sansheng', args: 'reject 预算不清', source: { kind: 'user' } },
  })
  assert.equal(state.approvals.at(-1).decision, 'reject')
  assertCode(
    () => validateAppointInput(state, { member: 'xingbu', department: '刑部', expected_revision: state.revision }, LEAD),
    'USER_REJECTED_PLAN',
  )
})

test('御批 before the plan gate is denied and does not record approval', () => {
  const state = activeState()
  const denied = foldEvent(state, {
    type: 'command/run',
    time: 1700000000000,
    data: { name: 'sansheng', args: 'approve too early', source: { kind: 'user' } },
  })
  assert.equal(denied.approvals.length, 0)
  assert.equal(denied.history.at(-1).op, 'denied')
  assert.equal(denied.history.at(-1).code, 'USER_APPROVAL_NOT_READY')
})

test('the plan must be revised after a 封驳 before it can pass again', () => {
  let state = planReject(activeState())
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'pass', checked: ['fixed'], expected_revision: state.revision }, REVIEWER),
    'PLAN_NOT_REVISED',
  )
  state = append(state, 'edict', { edict: baseEdict({ revision: 2, rev: state.revision + 1 }) })
  const gate = validateGateInput(state, { kind: 'plan', verdict: 'pass', checked: ['fixed'], expected_revision: state.revision }, REVIEWER)
  assert.equal(gate.verdict, 'pass')
  assert.deepEqual(gate.checked, ['fixed'])
})

test('the result gate requires plan pass, evidence and per-task reviews', () => {
  const pending = activeState()
  assertCode(
    () => validateGateInput(pending, { kind: 'result', verdict: 'pass', checked: ['x'], expected_revision: pending.revision }, SECOND_REVIEWER),
    'PLAN_GATE_NOT_PASSED',
  )
  const planned = planPass(pending)
  assertCode(
    () => validateGateInput(planned, { kind: 'result', verdict: 'pass', checked: ['x'], expected_revision: planned.revision }, SECOND_REVIEWER),
    'NO_EVIDENCE_TO_REVIEW',
  )
  const state = appointment(evidence(planned))
  assertCode(
    () => validateGateInput(state, { kind: 'result', verdict: 'pass', checked: ['x'], expected_revision: state.revision }, SECOND_REVIEWER, TASKS),
    'TASK_REVIEWS_REQUIRED',
  )
  assertCode(
    () => validateGateInput(state, { kind: 'result', verdict: 'pass', checked: ['x'], reviews: [], expected_revision: state.revision }, SECOND_REVIEWER, TASKS),
    'INVALID_FIELD',
  )
  assertCode(
    () => validateGateInput(state, {
      kind: 'result', verdict: 'pass', checked: ['x'],
      reviews: [{ task_id: 'task-1', verdict: 'pass' }],
      expected_revision: state.revision,
    }, REVIEWER, TASKS),
    'REVIEWER_MUST_DIFFER',
  )
})

test('an appointed member or task owner cannot review the delivery', () => {
  const state = appointment(evidence(planPass(activeState())))
  assertCode(
    () => validateGateInput(state, { kind: 'plan', verdict: 'pass', checked: ['x'], expected_revision: state.revision }, WORKER),
    'SELF_REVIEW_NOT_ALLOWED',
  )
  assertCode(
    () => validateGateInput(state, {
      kind: 'result', verdict: 'pass', checked: ['x'],
      reviews: [{ task_id: 'task-1', verdict: 'pass' }],
      expected_revision: state.revision,
    }, WORKER, TASKS),
    'SELF_REVIEW_NOT_ALLOWED',
  )
  assertCode(
    () => validateGateInput(state, {
      kind: 'result', verdict: 'pass', checked: ['x'],
      reviews: [{ task_id: 'task-1', verdict: 'pass' }],
      expected_revision: state.revision,
    }, SECOND_REVIEWER, [{ id: 'task-1', status: 'completed', ownerName: 'yushi' }]),
    'REVIEWER_IS_EXECUTOR',
  )
})

test('a result pass requires evidence submitted after the last rejection', () => {
  const state = readyForResult()
  const rejected = foldEvent(state, toolResult(record('gate', {
    gate: {
      id: 'gate-r1', kind: 'result', verdict: 'reject', reviewer: 'yushi',
      defects: ['missing test'], checked: [], reviews: [], summary: null, rev: state.revision + 1, createdAt: null,
    },
  }, state.revision + 1)))
  assertCode(
    () => validateGateInput(rejected, {
      kind: 'result', verdict: 'pass', checked: ['fixed'],
      reviews: [{ task_id: 'task-1', verdict: 'pass' }],
      expected_revision: rejected.revision,
    }, SECOND_REVIEWER, TASKS),
    'RESULT_NOT_REVISED',
  )
  const revised = evidence(rejected, { command: 'npm test -- --rerun', digest: 'b'.repeat(64) })
  const gate = validateGateInput(revised, {
    kind: 'result', verdict: 'pass', checked: ['fixed'],
    reviews: [{ task_id: 'task-1', verdict: 'pass' }],
    expected_revision: revised.revision,
  }, SECOND_REVIEWER, TASKS)
  assert.equal(gate.verdict, 'pass')
})

/* Evidence */

test('evidence requires a completed task, command, exit code, digest and excerpt', () => {
  const state = activeState()
  const revision = state.revision
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-1', command: '', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok', expected_revision: revision }, TASKS), 'INVALID_FIELD')
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-1', command: 'x', exit_code: '0', digest: 'a'.repeat(64), excerpt: 'ok', expected_revision: revision }, TASKS), 'INVALID_EXIT_CODE')
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-1', command: 'x', exit_code: 0, digest: '', excerpt: 'ok', expected_revision: revision }, TASKS), 'INVALID_FIELD')
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-1', command: 'x', exit_code: 0, digest: 'not-hex', excerpt: 'ok', expected_revision: revision }, TASKS), 'INVALID_DIGEST')
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-1', command: 'x', exit_code: 0, digest: 'a'.repeat(64), expected_revision: revision }, TASKS), 'INVALID_FIELD')
})

test('evidence must reference a completed shared task and cannot repeat itself', () => {
  const state = activeState()
  const revision = state.revision
  const args = { task_id: 'task-1', command: 'npm test', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok', expected_revision: revision }
  assertCode(() => validateEvidenceInput(state, { ...args, task_id: 'nope' }, TASKS), 'INVALID_TASK_ID')
  assertCode(() => validateEvidenceInput(state, { ...args, task_id: 'task-9' }, TASKS), 'TASK_NOT_FOUND')
  assertCode(() => validateEvidenceInput(state, args, [{ id: 'task-1', status: 'in_progress' }]), 'TASK_NOT_COMPLETED')
  const withEvidence = evidence(activeState())
  assertCode(() => validateEvidenceInput(withEvidence, { ...args, expected_revision: withEvidence.revision }, TASKS), 'DUPLICATE_EVIDENCE')
})

/* Intake */

test('intake records the normalized intent and blocks an unclear edict', () => {
  const base = append(createEmptyState(), 'mode', { active: true })
  assertCode(() => validateEdictInput(base, { goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'], expected_revision: base.revision }), 'INTENT_NOT_CAPTURED')
  const unclear = append(base, 'intake', {
    intake: {
      id: 'intake-1', request: 'do the thing', intent: 'do the thing', nonGoals: [], ambiguities: ['which thing?'],
      needsClarification: true, clarificationQuestion: 'Which thing?', by: 'lead', rev: base.revision + 1, createdAt: null,
    },
  })
  assertCode(() => validateEdictInput(unclear, { goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'], expected_revision: unclear.revision }), 'USER_CLARIFICATION_REQUIRED')
  const clear = append(unclear, 'intake', {
    intake: {
      id: 'intake-2', request: 'do the thing', intent: 'do the thing', nonGoals: [], ambiguities: [],
      needsClarification: false, clarificationQuestion: null, by: 'lead', rev: unclear.revision + 1, createdAt: null,
    },
  })
  assert.doesNotThrow(() => validateEdictInput(clear, { goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'], expected_revision: clear.revision }))
})

test('intake requires a question while clarification is needed', () => {
  const state = append(createEmptyState(), 'mode', { active: true })
  assertCode(() => validateIntakeInput(state, { request: 'r', intent: 'i', needs_clarification: true, expected_revision: state.revision }, LEAD), 'CLARIFICATION_QUESTION_REQUIRED')
  const intake = validateIntakeInput(state, { request: ' r ', intent: ' i ', non_goals: ['n'], ambiguities: ['a'], needs_clarification: false, expected_revision: state.revision }, LEAD)
  assert.equal(intake.request, 'r')
  assert.deepEqual(intake.nonGoals, ['n'])
})

/* Sequential case archive */

test('a new case archives the finished case tasks and timeline', () => {
  let state = activeState()
  state = append(state, 'close', {
    closure: {
      id: 'close-1', conclusions: ['done'], deliverables: ['src/a.js'], unknowns: [], next: [],
      closedBy: 'lead', createdAt: null,
    },
    tasks: [
      { id: 'task-1', subject: 'do the work', status: 'completed', ownerName: 'gongbu', writeScopes: ['src/'] },
    ],
  })
  state = append(state, 'mode', { active: true })
  const archived = state.cases.at(-1)
  assert.equal(state.caseId, archived.caseId + 1)
  assert.equal(state.caseTasks.length, 0)
  assert.equal(archived.snapshot.tasks.length, 1)
  assert.equal(archived.snapshot.tasks[0].id, 'task-1')
  assert.ok(archived.snapshot.history.some((entry) => entry.op === 'close'))
  assert.equal(archived.snapshot.history.at(-1).op, 'close')
})

/* Risk, conditional approval and audit */

test('high-risk edicts require explicit assumptions, risks, tools, data scope and budget', () => {
  const empty = createEmptyState()
  const base = {
    goal: 'deploy', acceptance: ['deployed'], tier: 'medium', departments: ['工部'], expected_revision: 0,
  }
  assertCode(() => validateEdictInput(empty, { ...base, risk_level: 'high' }), 'RISK_ANALYSIS_REQUIRED')
  const edict = validateEdictInput(empty, {
    ...base,
    risk_level: 'high',
    assumptions: ['workspace writable'],
    risks: ['deploy may fail'],
    tools: ['bash'],
    data_scope: ['src/'],
    budget: '40 tool calls',
  })
  assert.equal(edict.riskLevel, 'high')
  assert.deepEqual(edict.tools, ['bash'])
})

test('high-risk work needs a real user approval before appointment', () => {
  let state = planPass(activeState(riskEdict()))
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD),
    'USER_APPROVAL_REQUIRED',
  )
  state = foldEvent(state, {
    type: 'command/run',
    time: 1700000000000,
    data: { name: 'sansheng', args: 'approve 允许部署', source: { kind: 'user' } },
  })
  const result = validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD)
  assert.equal(result.role, '工具与基础设施')
})

test('conditional plan approval requires a passing independent audit at close', () => {
  let state = appointment(planPass(activeState(), { conditions: ['rollback plan exists', 'owner on call'] }))
  state = evidence(state)
  state = resultPass(state)
  assertCode(
    () => validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD),
    'GATE_CONDITIONS_UNMET',
  )
  state = audit(state, { scope: 'plan', auditor: 'shenji', conditionsMet: ['rollback plan exists', 'owner on call'] })
  const report = validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD)
  assert.deepEqual(report.conclusions, ['done'])
})

test('audit is independent: not Lead, not the gate reviewer, not a task owner; 刑部 may audit', () => {
  const state = planPass(activeState(), { conditions: ['c1'] })
  const base = { scope: 'plan', verdict: 'pass', checks: ['checked'], conditions_met: ['c1'], expected_revision: state.revision }
  assertCode(() => validateAuditInput(state, base, TASKS, LEAD), 'AUDITOR_MUST_BE_TEAMMATE')
  assertCode(() => validateAuditInput(state, base, TASKS, REVIEWER), 'AUDITOR_MUST_BE_INDEPENDENT')
  assertCode(() => validateAuditInput(state, base, TASKS, WORKER), 'AUDITOR_IS_EXECUTOR')
  const xingbu = { role: 'teammate', name: 'xingbu' }
  const xingbuState = append(planPass(activeState(), { conditions: ['c1'] }), 'appoint', {
    appointment: { id: 'ap-xingbu', member: 'xingbu', department: '刑部', responsibility: null, writeScopes: [], createdAt: null },
  })
  assert.equal(validateAuditInput(xingbuState, { ...base, expected_revision: xingbuState.revision }, TASKS, xingbu).scope, 'plan')
})

test('high-risk close requires a passing result audit after the result gate', () => {
  let state = planPass(activeState(riskEdict()))
  state = foldEvent(state, {
    type: 'command/run', time: 1700000000000,
    data: { name: 'sansheng', args: 'approve 允许部署', source: { kind: 'user' } },
  })
  state = appointment(state)
  state = evidence(state)
  state = resultPass(state)
  assertCode(
    () => validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD),
    'HIGH_RISK_AUDIT_REQUIRED',
  )
  state = audit(state, { scope: 'result', auditor: 'shenji', checks: ['delivery checked'] })
  const report = validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD)
  assert.deepEqual(report.conclusions, ['done'])
})

/* Workstreams */

function wsEdict(overrides = {}) {
  return baseEdict({
    departments: ['工部', '刑部'],
    workstreams: [{
      id: 'impl',
      department: '工部',
      deliverable: 'working change',
      acceptance: ['tests pass'],
      writeScopes: ['src'],
    }],
    ...overrides,
  })
}

test('edict workstreams are normalized and validated', () => {
  const state = createEmptyState()
  const edict = validateEdictInput(state, {
    goal: 'g', acceptance: ['a'], tier: 'medium', roster_cap: 3,
    departments: ['工部'],
    workstreams: [{ id: 'impl', department: '工部', deliverable: 'code', acceptance: ['tests pass'] }],
    expected_revision: 0,
  })
  assert.equal(edict.workstreams[0].id, 'impl')
  assert.deepEqual(edict.workstreams[0].acceptance, ['tests pass'])
  assertCode(() => validateEdictInput(state, {
    goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'],
    workstreams: [{ id: 'impl', department: '工部', deliverable: 'x', acceptance: ['a'] }, { id: 'impl', department: '工部', deliverable: 'y', acceptance: ['b'] }],
    expected_revision: 0,
  }), 'DUPLICATE_WORKSTREAM')
  assertCode(() => validateEdictInput(state, {
    goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'],
    workstreams: [{ id: 'Bad ID', department: '工部', deliverable: 'x', acceptance: ['a'] }],
    expected_revision: 0,
  }), 'INVALID_WORKSTREAM_ID')
  assertCode(() => validateEdictInput(state, {
    goal: 'g', acceptance: ['a'], tier: 'medium', departments: ['工部'],
    workstreams: [{ id: 'docs', department: '礼部', deliverable: 'x', acceptance: ['a'] }],
    expected_revision: 0,
  }), 'WORKSTREAM_DEPARTMENT_NOT_LISTED')
  assertCode(() => validateEdictInput(state, {
    goal: 'g', acceptance: ['a'], tier: 'small', roster_cap: 0, departments: [],
    workstreams: [{ id: 'impl', department: '工部', deliverable: 'x', acceptance: ['a'] }],
    expected_revision: 0,
  }), 'SMALL_TIER_WORKSTREAMS')
})

test('evidence and result reviews must name a workstream when the edict declares them', () => {
  let state = appointment(planPass(activeState(wsEdict())))
  const revision = state.revision
  const base = { task_id: 'task-1', command: 'npm test', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok', expected_revision: revision }
  assertCode(() => validateEvidenceInput(state, base, TASKS), 'WORKSTREAM_EVIDENCE_REQUIRED')
  assertCode(() => validateEvidenceInput(state, { ...base, workstream_id: 'nope' }, TASKS), 'UNKNOWN_WORKSTREAM')
  const valid = validateEvidenceInput(state, { ...base, workstream_id: 'impl' }, TASKS)
  assert.equal(valid.workstreamId, 'impl')

  state = evidence(state, { workstreamId: 'impl' })
  const reviewed = validateGateInput(state, {
    kind: 'result', verdict: 'pass', checked: ['evidence checked'],
    reviews: [{ task_id: 'task-1', workstream_id: 'impl', verdict: 'pass' }],
    expected_revision: state.revision,
  }, SECOND_REVIEWER, TASKS)
  assert.equal(reviewed.reviews[0].workstreamId, 'impl')
  assertCode(() => validateGateInput(state, {
    kind: 'result', verdict: 'pass', checked: ['x'],
    reviews: [{ task_id: 'task-1', verdict: 'pass' }],
    expected_revision: state.revision,
  }, SECOND_REVIEWER, TASKS), 'WORKSTREAM_REVIEW_REQUIRED')
})

test('closing rejects workstreams without evidence', () => {
  let state = appointment(planPass(activeState(wsEdict())))
  state = evidence(state, { workstreamId: 'impl' })
  state = resultPass(state, {
    reviews: [{ taskId: 'task-1', workstreamId: 'impl', verdict: 'pass', defects: [] }],
  })
  const report = validateCloseInput(state, { conclusions: ['done'], deliverables: ['src'], expected_revision: state.revision }, TASKS, LEAD)
  assert.deepEqual(report.conclusions, ['done'])
  const stripped = { ...state, evidence: state.evidence.map((record) => ({ ...record, workstreamId: null })) }
  assertCode(() => validateCloseInput(stripped, { conclusions: ['done'], deliverables: ['src'], expected_revision: stripped.revision }, TASKS, LEAD), 'WORKSTREAM_WITHOUT_EVIDENCE')
})

test('re-drafting the edict invalidates the plan gate', () => {
  let state = planPass(activeState(wsEdict()))
  state = append(state, 'edict', { edict: wsEdict({ revision: 2, rev: state.revision + 1, goal: 'revised' }) })
  assertCode(
    () => validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD),
    'PLAN_GATE_NOT_PASSED',
  )
  state = planPass(state)
  const appointmentResult = validateAppointInput(state, { member: 'gongbu', department: '工部', expected_revision: state.revision }, LEAD)
  assert.equal(appointmentResult.member, 'gongbu')
})

/* Closing */

const REPORT = { conclusions: ['done'], deliverables: ['src/a.js'] }

test('closing is Lead-only, revision-guarded and requires both gates', () => {
  const unplanned = activeState()
  assertCode(() => validateCloseInput(unplanned, { ...REPORT, expected_revision: unplanned.revision }, [], LEAD), 'PLAN_GATE_NOT_PASSED')
  const planned = planPass(activeState())
  assertCode(() => validateCloseInput(planned, { ...REPORT, expected_revision: planned.revision }, [], LEAD), 'RESULT_GATE_NOT_PASSED')
  assertCode(() => validateCloseInput(closedState(), { ...REPORT, expected_revision: closedState().revision + 1 }, [], WORKER), 'STALE_REVISION')
  assertCode(() => validateCloseInput(closedState(), { ...REPORT, expected_revision: closedState().revision }, [], WORKER), 'LEAD_ONLY')
  assertCode(() => validateCloseInput(closedState(), REPORT, TASKS, LEAD), 'MISSING_EXPECTED_REVISION')
})

test('closing rejects unfinished shared tasks', () => {
  const state = closedState()
  assertCode(
    () => validateCloseInput(state, { ...REPORT, expected_revision: state.revision }, [...TASKS, { id: 'task-2', status: 'in_progress' }], LEAD),
    'OPEN_TASKS',
  )
})

test('closing requires evidence for every completed task', () => {
  const state = closedState()
  assertCode(
    () => validateCloseInput(state, { ...REPORT, expected_revision: state.revision }, [...TASKS, { id: 'task-2', status: 'completed' }], LEAD),
    'COMPLETED_TASK_WITHOUT_EVIDENCE',
  )
})

test('a clean close returns the five-part report', () => {
  const state = closedState()
  const report = validateCloseInput(
    state,
    { conclusions: ['tests pass'], deliverables: ['src/a.js'], unknowns: ['none'], next: [], expected_revision: state.revision },
    TASKS,
    LEAD,
  )
  assert.deepEqual(report.conclusions, ['tests pass'])
  assert.deepEqual(report.deliverables, ['src/a.js'])
  assert.deepEqual(report.unknowns, ['none'])
  assert.deepEqual(report.next, [])
})

/* Board summary */

test('summarizeBoard exposes revision, rounds and missing evidence', () => {
  const state = closedState()
  const summary = summarizeBoard(state, [
    { id: 'task-1', status: 'completed' },
    { id: 'task-2', status: 'in_progress' },
  ])
  assert.equal(summary.active, true)
  assert.equal(summary.revision, state.revision)
  assert.equal(summary.planRounds, 1)
  assert.equal(summary.resultRounds, 1)
  assert.deepEqual(summary.completedTasks, ['task-1'])
  assert.deepEqual(summary.taskReviews, [{ taskId: 'task-1', workstreamId: null, verdict: 'pass', defects: [] }])
  assert.equal(summary.closure, null)
})

test('completedTasksWithoutEvidence ignores non-completed tasks', () => {
  const state = evidence(activeState())
  assert.deepEqual(completedTasksWithoutEvidence(state, [
    { id: 'task-1', status: 'completed' },
    { id: 'task-2', status: 'pending' },
  ]), [])
})

test('sansheng state names never use the 三星/xing romanization', () => {
  assert.equal(TIERS.large, 9)
  const source = JSON.stringify({ DEPARTMENT_NAMES })
  assert.ok(source.includes('工部'))
})

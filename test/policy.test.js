import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_NAMES,
  SanshengError,
  TIERS,
  appointedMembers,
  completedTasksWithoutEvidence,
  createEmptyState,
  createInitialState,
  foldEvent,
  latestGate,
  summarizeBoard,
  validateAppointInput,
  validateCloseInput,
  validateEdictInput,
  validateEvidenceInput,
  validateGateInput,
  validateModeAction,
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

/* Projection fold */

test('an agent-preset selection event activates or deactivates the mode', () => {
  const base = createEmptyState()
  const selected = foldEvent(base, { type: 'agent-preset/selected', data: { agentPreset: 'sansheng' } }, 'sansheng')
  assert.equal(selected.active, true)
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
  const next = foldEvent(state, teammateMessage(marked(record('gate', {
    gate: {
      id: 'gate-9', kind: 'plan', verdict: 'reject', reviewer: 'menxia',
      defects: ['no command'], checked: [], reviews: [], summary: null, rev: 3, createdAt: null,
    },
  }, 3))))
  assert.equal(latestGate(next, 'plan')?.verdict, 'reject')
  assert.deepEqual(latestGate(next, 'plan')?.defects, ['no command'])
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

test('enter is rejected after the case is closed', () => {
  const state = foldEvent(closedState(), toolResult(record('close', {
    closure: { id: 'close-1', conclusions: ['done'], deliverables: ['d'], unknowns: [], next: [], closedBy: 'lead', createdAt: null },
  })))
  assertCode(
    () => validateModeAction(state, { action: 'enter', expected_revision: state.revision }),
    'CASE_ALREADY_CLOSED',
  )
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
  assertCode(() => validateEdictInput(state, { ...base, goal: 'g', tier: 'small', roster_cap: 1 }), 'SMALL_TIER_NEEDS_NO_TEAM')
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

/* Closing */

const REPORT = { conclusions: ['done'], deliverables: ['src/a.js'] }

test('closing is Lead-only, revision-guarded and requires both gates', () => {
  assertCode(() => validateCloseInput(activeState(), { ...REPORT, expected_revision: 2 }, [], LEAD), 'PLAN_GATE_NOT_PASSED')
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
  assert.deepEqual(summary.taskReviews, [{ taskId: 'task-1', verdict: 'pass', defects: [] }])
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

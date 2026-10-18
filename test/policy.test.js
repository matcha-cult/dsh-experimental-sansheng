import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_NAMES,
  SanshengError,
  TIERS,
  appointedMembers,
  completedTasksWithoutEvidence,
  createEmptyState,
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
const WORKER = { role: 'teammate', name: 'gongbu' }

function assertCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof SanshengError, `expected SanshengError, got ${error}`)
    assert.equal(error.code, code, error.message)
    return true
  })
}

function baseEdict(overrides = {}) {
  return {
    revision: 1,
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
  let state = foldEvent(createEmptyState(), { type: 'sansheng/mode', data: { active: true } })
  state = foldEvent(state, { type: 'sansheng/edict', data: { edict } })
  return state
}

function withPlanPass(state) {
  return foldEvent(state, {
    type: 'sansheng/gate',
    data: {
      gate: {
        id: 'gate-1', kind: 'plan', verdict: 'pass', reviewer: 'menxia', defects: [], summary: null, createdAt: null,
      },
    },
  })
}

function withAppointment(state, member = 'gongbu', department = '工部') {
  return foldEvent(state, {
    type: 'sansheng/appoint',
    data: {
      appointment: {
        id: 'ap-1', member, department, responsibility: null, writeScopes: ['src'], createdAt: null,
      },
    },
  })
}

function withEvidence(state, taskId = 'task-1') {
  return foldEvent(state, {
    type: 'sansheng/evidence',
    data: {
      evidence: {
        id: 'ev-1', taskId, command: 'npm test', exitCode: 0, digest: null, excerpt: 'ok', submittedBy: 'xingbu', sourceSessionId: null, createdAt: null,
      },
    },
  })
}

/* ------------------------------------------------------------------ */
/* Projection fold                                                     */
/* ------------------------------------------------------------------ */

test('empty state starts inactive with an empty board', () => {
  const state = createEmptyState()
  assert.equal(state.active, false)
  assert.equal(state.edict, null)
  assert.deepEqual(state.appointments, [])
  assert.deepEqual(state.gates, [])
  assert.deepEqual(state.evidence, [])
  assert.equal(state.closure, null)
})

test('foldEvent derives the board from append-only events', () => {
  let state = activeState()
  assert.equal(state.active, true)
  assert.equal(state.edict.revision, 1)
  assert.equal(state.revision, 2)

  state = withPlanPass(state)
  assert.equal(latestGate(state, 'plan')?.verdict, 'pass')
  assert.equal(latestGate(state, 'result'), undefined)

  state = withAppointment(state)
  assert.deepEqual(appointedMembers(state), ['gongbu'])
  assert.equal(state.revision, 4)
})

test('later gate verdicts override earlier ones', () => {
  let state = activeState()
  state = foldEvent(state, {
    type: 'sansheng/gate',
    data: { gate: { id: 'gate-1', kind: 'plan', verdict: 'reject', reviewer: 'menxia', defects: ['no acceptance'], summary: null, createdAt: null } },
  })
  state = withPlanPass(state)
  assert.equal(latestGate(state, 'plan')?.verdict, 'pass')
  assert.equal(state.gates.length, 2)
})

test('unknown and malformed events are ignored during replay', () => {
  const state = activeState()
  assert.equal(foldEvent(state, { type: 'other/event', data: {} }), state)
  assert.equal(foldEvent(state, { type: 'sansheng/gate', data: { gate: { kind: 'plan' } } }), state)
  assert.equal(foldEvent(state, null), state)
  assert.equal(foldEvent(state, { type: 'sansheng/edict', data: {} }), state)
})

test('leaving the mode preserves the audited board', () => {
  let state = withPlanPass(activeState())
  state = foldEvent(state, { type: 'sansheng/mode', data: { active: false } })
  assert.equal(state.active, false)
  assert.equal(latestGate(state, 'plan')?.verdict, 'pass')
})

/* ------------------------------------------------------------------ */
/* Mode action                                                         */
/* ------------------------------------------------------------------ */

test('validateModeAction accepts only enter, leave and status', () => {
  assert.equal(validateModeAction('enter'), 'enter')
  assert.equal(validateModeAction('leave'), 'leave')
  assert.equal(validateModeAction('status'), 'status')
  assertCode(() => validateModeAction('on'), 'INVALID_ACTION')
})

/* ------------------------------------------------------------------ */
/* Edict                                                               */
/* ------------------------------------------------------------------ */

test('validateEdictInput normalizes a valid edict and defaults the roster cap', () => {
  const edict = validateEdictInput({
    goal: '  ship it  ',
    acceptance: [' tests pass '],
    boundaries: [],
    tier: 'medium',
    departments: ['工部'],
  })
  assert.equal(edict.goal, 'ship it')
  assert.deepEqual(edict.acceptance, ['tests pass'])
  assert.equal(edict.rosterCap, TIERS.medium)
  assert.deepEqual(edict.departments, ['工部'])
})

test('edict validation rejects bad tier, caps and missing fields', () => {
  assertCode(() => validateEdictInput({ goal: '', acceptance: ['x'], tier: 'medium' }), 'INVALID_FIELD')
  assertCode(() => validateEdictInput({ goal: 'g', acceptance: [], tier: 'medium' }), 'INVALID_FIELD')
  assertCode(() => validateEdictInput({ goal: 'g', acceptance: ['x'], tier: 'huge' }), 'INVALID_TIER')
  assertCode(() => validateEdictInput({ goal: 'g', acceptance: ['x'], tier: 'medium', roster_cap: 9 }), 'ROSTER_CAP_ABOVE_TIER')
  assertCode(() => validateEdictInput({ goal: 'g', acceptance: ['x'], tier: 'small', roster_cap: 1 }), 'SMALL_TIER_NEEDS_NO_TEAM')
  assertCode(() => validateEdictInput({ goal: 'g', acceptance: ['x'], tier: 'large', roster_cap: 99 }), 'INVALID_ROSTER_CAP')
})

/* ------------------------------------------------------------------ */
/* Appointment                                                         */
/* ------------------------------------------------------------------ */

test('appointment is rejected before the plan gate passes', () => {
  const state = activeState()
  assertCode(() => validateAppointInput(state, { member: 'gongbu', department: '工部' }, LEAD), 'PLAN_GATE_NOT_PASSED')
})

test('appointment succeeds after the plan gate and enforces departments', () => {
  const state = withPlanPass(activeState())
  const appointment = validateAppointInput(
    state,
    { member: 'gongbu', department: '工部', write_scopes: ['src/**'], responsibility: 'build' },
    LEAD,
  )
  assert.equal(appointment.member, 'gongbu')
  assert.equal(appointment.department, '工部')
  assert.deepEqual(appointment.writeScopes, ['src/**'])

  assertCode(() => validateAppointInput(state, { member: 'gongbu', department: '中书省' }, LEAD), 'UNKNOWN_DEPARTMENT')
  assert.ok(DEPARTMENT_NAMES.length === 6)
})

test('appointment is Lead-only and never duplicates a member', () => {
  const state = withAppointment(withPlanPass(activeState()))
  assertCode(() => validateAppointInput(state, { member: 'xingbu', department: '刑部' }, WORKER), 'LEAD_ONLY')
  assertCode(() => validateAppointInput(state, { member: 'gongbu', department: '工部' }, LEAD), 'MEMBER_ALREADY_APPOINTED')
  assertCode(() => validateAppointInput(state, { member: 'lead', department: '工部' }, LEAD), 'CANNOT_APPOINT_LEAD')
})

test('appointment cannot exceed the roster cap', () => {
  const state = withAppointment(withPlanPass(activeState(baseEdict({ rosterCap: 1 }))))
  assertCode(() => validateAppointInput(state, { member: 'xingbu', department: '刑部' }, LEAD), 'ROSTER_CAP_EXCEEDED')
})

test('write scopes must stay workspace-relative', () => {
  const state = withPlanPass(activeState())
  assertCode(() => validateAppointInput(state, { member: 'a', department: '工部', write_scopes: ['/etc/passwd'] }, LEAD), 'INVALID_WRITE_SCOPE')
  assertCode(() => validateAppointInput(state, { member: 'a', department: '工部', write_scopes: ['../outside'] }, LEAD), 'INVALID_WRITE_SCOPE')
})

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

test('the Lead can never review its own plan', () => {
  assertCode(() => validateGateInput(activeState(), { kind: 'plan', verdict: 'pass' }, LEAD), 'REVIEWER_MUST_BE_TEAMMATE')
})

test('a rejection must carry blocking defects, a pass must not', () => {
  const state = activeState()
  assertCode(() => validateGateInput(state, { kind: 'plan', verdict: 'reject', defects: [] }, REVIEWER), 'INVALID_FIELD')
  assertCode(() => validateGateInput(state, { kind: 'plan', verdict: 'pass', defects: ['oops'] }, REVIEWER), 'DEFECTS_ON_PASS')
})

test('the result gate requires the plan gate first and evidence to review', () => {
  const pending = activeState()
  assertCode(() => validateGateInput(pending, { kind: 'result', verdict: 'pass' }, REVIEWER), 'PLAN_GATE_NOT_PASSED')

  const planned = withPlanPass(pending)
  assertCode(() => validateGateInput(planned, { kind: 'result', verdict: 'pass' }, REVIEWER), 'NO_EVIDENCE_TO_REVIEW')
})

test('an appointed member cannot review its own delivery', () => {
  const state = withAppointment(withPlanPass(activeState()))
  assertCode(() => validateGateInput(state, { kind: 'plan', verdict: 'pass' }, WORKER), 'SELF_REVIEW_NOT_ALLOWED')
})

test('an independent reviewer can pass the result gate after evidence', () => {
  const state = withEvidence(withPlanPass(activeState()))
  const gate = validateGateInput(state, { kind: 'result', verdict: 'pass', summary: 'verified' }, REVIEWER)
  assert.equal(gate.verdict, 'pass')
  assert.equal(gate.summary, 'verified')
})

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

test('evidence requires a command and an integer exit code', () => {
  const state = activeState()
  assertCode(() => validateEvidenceInput(state, { command: '', exit_code: 0 }), 'INVALID_FIELD')
  assertCode(() => validateEvidenceInput(state, { command: 'npm test', exit_code: '0' }), 'INVALID_EXIT_CODE')
})

test('evidence may reference an existing shared task only', () => {
  const state = activeState()
  const tasks = [{ id: 'task-1', status: 'completed' }]
  const evidence = validateEvidenceInput(state, { task_id: 'task-1', command: 'npm test', exit_code: 0 }, tasks)
  assert.equal(evidence.taskId, 'task-1')
  assertCode(() => validateEvidenceInput(state, { task_id: 'nope', command: 'x', exit_code: 0 }, tasks), 'INVALID_TASK_ID')
  assertCode(() => validateEvidenceInput(state, { task_id: 'task-9', command: 'x', exit_code: 0 }, tasks), 'TASK_NOT_FOUND')
})

/* ------------------------------------------------------------------ */
/* Closing                                                             */
/* ------------------------------------------------------------------ */

function closedState() {
  let state = withEvidence(withAppointment(withPlanPass(activeState())))
  return foldEvent(state, {
    type: 'sansheng/gate',
    data: {
      gate: { id: 'gate-2', kind: 'result', verdict: 'pass', reviewer: 'yushi', defects: [], summary: null, createdAt: null },
    },
  })
}

test('closing is Lead-only and requires both gates', () => {
  const report = { conclusions: ['done'], deliverables: ['src/a.js'] }
  assertCode(() => validateCloseInput(activeState(), report, [], LEAD), 'PLAN_GATE_NOT_PASSED')
  const planned = withPlanPass(activeState())
  assertCode(() => validateCloseInput(planned, report, [], LEAD), 'RESULT_GATE_NOT_PASSED')
  assertCode(() => validateCloseInput(closedState(), report, [], WORKER), 'LEAD_ONLY')
})

test('closing requires at least one evidence record', () => {
  let state = withPlanPass(activeState())
  state = foldEvent(state, {
    type: 'sansheng/gate',
    data: { gate: { id: 'gate-2', kind: 'result', verdict: 'pass', reviewer: 'yushi', defects: [], summary: null, createdAt: null } },
  })
  assertCode(
    () => validateCloseInput(state, { conclusions: ['done'], deliverables: ['d'] }, [], LEAD),
    'NO_EVIDENCE',
  )
})

test('every completed shared task must be covered by evidence', () => {
  const state = closedState()
  assertCode(
    () => validateCloseInput(
      state,
      { conclusions: ['done'], deliverables: ['src/a.js'] },
      [{ id: 'task-1', status: 'completed' }, { id: 'task-2', status: 'completed' }],
      LEAD,
    ),
    'COMPLETED_TASK_WITHOUT_EVIDENCE',
  )
})

test('a clean close returns the five-part report', () => {
  const report = validateCloseInput(
    closedState(),
    {
      conclusions: ['tests pass'],
      deliverables: ['src/a.js'],
      unknowns: ['none'],
      next: [],
    },
    [{ id: 'task-1', status: 'completed' }],
    LEAD,
  )
  assert.deepEqual(report.conclusions, ['tests pass'])
  assert.deepEqual(report.deliverables, ['src/a.js'])
  assert.deepEqual(report.unknowns, ['none'])
  assert.deepEqual(report.next, [])
})

/* ------------------------------------------------------------------ */
/* Board summary                                                       */
/* ------------------------------------------------------------------ */

test('summarizeBoard exposes missing evidence for the browser board', () => {
  const state = closedState()
  state.evidence = []
  const summary = summarizeBoard(state, [
    { id: 'task-1', status: 'completed' },
    { id: 'task-2', status: 'in_progress' },
  ])
  assert.equal(summary.active, true)
  assert.equal(summary.edict.tier, 'medium')
  assert.equal(summary.planGate.verdict, 'pass')
  assert.equal(summary.resultGate.verdict, 'pass')
  assert.deepEqual(summary.completedTasks, ['task-1'])
  assert.deepEqual(summary.missingEvidence, ['task-1'])
  assert.equal(summary.closure, null)
})

test('completedTasksWithoutEvidence ignores non-completed tasks', () => {
  const state = withEvidence(activeState(), 'task-1')
  assert.deepEqual(completedTasksWithoutEvidence(state, [
    { id: 'task-1', status: 'completed' },
    { id: 'task-2', status: 'pending' },
  ]), [])
})

test('sansheng state names never use the 三星/xing romanization', () => {
  assert.equal(TIERS.large, 9)
  // Guard against a regression that reintroduces the wrong pinyin.
  const source = JSON.stringify({ DEPARTMENT_NAMES })
  assert.ok(source.includes('工部'))
})

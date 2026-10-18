import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

const MUTATING = new Set([
  'sansheng_mode',
  'sansheng_edict',
  'sansheng_appoint',
  'sansheng_gate',
  'sansheng_evidence',
  'sansheng_close',
])

/**
 * Minimal Cordis-like context: enough surface for apply() to register its
 * projection, prompt section, and tools, plus a durable Lead session log that
 * the fake projection folds.
 *
 * The harness also emulates the two runtime behaviours the plugin relies on:
 * - a Lead tool result is committed as `tool/result`;
 * - a teammate record published with `sendMessage` arrives as `user/message`.
 */
function harness({ teammates = [], tasks = [], agentPreset } = {}) {
  const leader = {
    session: {
      header: { id: 'sess-lead', ...(agentPreset === undefined ? {} : { agentPreset }) },
      events: [],
    },
  }
  let projection
  const tools = []
  const sections = []
  const projections = {}
  const membership = new Map()
  membership.set(leader, { role: 'lead', name: 'lead', root: leader })

  const agentTeams = {
    tryMembership(agent) {
      return membership.get(agent)
    },
    listMembers() {
      return [
        { id: 'sess-lead', name: 'lead', role: 'lead' },
        ...teammates.map((name) => ({ id: `sess-${name}`, name, role: 'teammate' })),
      ]
    },
    listTasks() {
      return tasks
    },
    async sendMessage(caller, request) {
      leader.session.events.push({
        type: 'user/message',
        data: {
          source: { kind: 'agent-message', senderName: caller?.session?.header?.id },
          content: request.content,
        },
      })
      return { messageId: 'msg-1' }
    },
  }

  const ctx = {
    get(serviceName) {
      if (serviceName === 'sessions') return { flush: async () => true }
      if (serviceName === 'agentTeams') return agentTeams
      return undefined
    },
    effect(run) {
      run()
      return () => {}
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
      getSectionOrder() {
        return 600
      },
    },
    sessionProjections: {
      register(definition) {
        projections[definition.key] = definition
        if (definition.key === 'sansheng') projection = definition
        return () => {}
      },
      stateOf(target, key) {
        if (target?.events === undefined) return undefined
        const definition = projections[key]
        if (definition === undefined) return undefined
        return target.events.reduce((state, event) => definition.apply(state, event), definition.init(target.header))
      },
    },
  }

  apply(ctx, {})

  function tool(name) {
    const found = tools.find((entry) => entry.name === name)
    assert.ok(found !== undefined, `missing tool ${name}`)
    return found
  }

  function currentRevision() {
    const state = leader.session.events.reduce(
      (current, event) => projection.apply(current, event),
      projection.init(leader.session.header),
    )
    return state.revision
  }

  /**
   * Execute one tool exactly as the Agent loop would expose it, then commit the
   * resulting event the runtime would write: a `tool/result` for a Lead call,
   * a `user/message` for a teammate record published to the Lead.
   *
   * Mutating tools receive the current board revision unless the test supplies
   * one explicitly (used to exercise stale-revision rejection).
   */
  async function dispatch(name, args, agent) {
    let payload = args
    if (MUTATING.has(name) && payload !== null && typeof payload === 'object' && payload.expected_revision === undefined) {
      payload = { ...payload, expected_revision: currentRevision() }
    }
    const result = await tool(name).execute(payload, { agent })
    if (agent === leader && typeof result === 'string' && result.startsWith('{"sansheng"')) {
      leader.session.events.push({
        type: 'tool/result',
        data: {
          message: {
            role: 'tool',
            toolCallId: 'call-test',
            isError: false,
            content: [{ type: 'text', text: result }],
          },
        },
      })
    }
    return result
  }

  function teammate(name) {
    const agent = {
      session: {
        header: { id: `sess-${name}` },
        events: [],
      },
    }
    membership.set(agent, { role: 'teammate', name, root: leader })
    return agent
  }

  return { ctx, leader, teammate, projection, tools, sections, dispatch, tool, currentRevision }
}

function stateOf(h) {
  return h.leader.session.events.reduce(
    (current, event) => h.projection.apply(current, event),
    h.projection.init(h.leader.session.header),
  )
}

async function enterEdict(h, extra = {}) {
  const lead = h.leader
  await h.dispatch('sansheng_mode', { action: 'enter' }, lead)
  await h.dispatch('sansheng_edict', {
    goal: 'g',
    acceptance: ['a'],
    tier: 'medium',
    roster_cap: 5,
    ...extra,
  }, lead)
}

async function planPass(h, reviewer) {
  await h.dispatch('sansheng_gate', {
    kind: 'plan',
    verdict: 'pass',
    checked: ['acceptance covered'],
  }, reviewer)
}

test('apply registers the project board, prompt section, and seven tools', () => {
  const h = harness()
  assert.equal(h.projection.key, 'sansheng')
  assert.equal(h.sections.length, 1)
  assert.equal(h.sections[0].name, 'sansheng:policy')
  assert.deepEqual(
    h.tools.map((entry) => entry.name).sort(),
    [
      'sansheng_appoint',
      'sansheng_board',
      'sansheng_close',
      'sansheng_edict',
      'sansheng_evidence',
      'sansheng_gate',
      'sansheng_mode',
    ],
  )
  for (const entry of h.tools) {
    assert.equal(typeof entry.execute, 'function')
    assert.equal(entry.output.schema.type, 'string')
  }
})

test('mode, edict, gates, appointment, evidence and close flow through the Lead log', async () => {
  const h = harness({
    teammates: ['menxia', 'yushi', 'gongbu'],
    tasks: [{ id: 'task-1', status: 'completed', ownerName: 'gongbu' }],
  })
  const reviewer = h.teammate('menxia')
  const resultReviewer = h.teammate('yushi')
  const worker = h.teammate('gongbu')
  const lead = h.leader

  const before = JSON.parse(await h.dispatch('sansheng_mode', { action: 'status' }, lead))
  assert.equal(before.active, false)
  assert.equal(before.revision, 0)

  await h.dispatch('sansheng_mode', { action: 'enter' }, lead)
  await h.dispatch('sansheng_edict', {
    goal: 'ship the mode',
    acceptance: ['tests pass'],
    tier: 'medium',
    roster_cap: 5,
    departments: ['工部', '刑部'],
  }, lead)
  await assert.rejects(
    h.dispatch('sansheng_appoint', { member: 'gongbu', department: '工部' }, lead),
    /PLAN_GATE_NOT_PASSED/,
  )

  await planPass(h, reviewer)
  await h.dispatch('sansheng_appoint', { member: 'gongbu', department: '工部', write_scopes: ['src'] }, lead)
  await h.dispatch('sansheng_evidence', {
    task_id: 'task-1',
    command: 'npm test',
    exit_code: 0,
    digest: 'a'.repeat(64),
    excerpt: '123 tests passed',
  }, worker)
  await h.dispatch('sansheng_gate', {
    kind: 'result',
    verdict: 'pass',
    checked: ['evidence reviewed'],
    reviews: [{ task_id: 'task-1', verdict: 'pass' }],
  }, resultReviewer)

  const closing = JSON.parse(await h.dispatch('sansheng_close', {
    conclusions: ['mode implemented'],
    deliverables: ['index.js'],
    unknowns: ['none'],
  }, lead))
  assert.equal(closing.op, 'close')
  assert.deepEqual(closing.closure.conclusions, ['mode implemented'])

  const state = stateOf(h)
  assert.equal(state.closure.closedBy, 'lead')
  assert.equal(state.revision, closing.rev)
  assert.equal(state.gates.length, 2)
  assert.ok(h.sections[0].text({ agent: lead }).includes('board revision'))

  const eventTypes = lead.session.events.map((event) => event.type)
  assert.deepEqual(eventTypes, [
    'tool/result', // mode enter
    'tool/result', // edict
    'user/message', // plan gate
    'tool/result', // appointment
    'user/message', // evidence
    'user/message', // result gate
    'tool/result', // close
  ])
})

test('stale expected_revision is rejected instead of forking the board', async () => {
  const h = harness({ teammates: ['menxia'] })
  const lead = h.leader
  await enterEdict(h)
  const revision = h.currentRevision()
  await assert.rejects(
    h.dispatch('sansheng_edict', {
      goal: 'changed',
      acceptance: ['a'],
      tier: 'medium',
      roster_cap: 5,
      expected_revision: revision - 1,
    }, lead),
    /STALE_REVISION/,
  )
  assert.equal(h.currentRevision(), revision)
})

test('leaving an open case requires close or an explicit abandon reason', async () => {
  const h = harness({ teammates: ['menxia'] })
  const lead = h.leader
  await enterEdict(h)
  await assert.rejects(
    h.dispatch('sansheng_mode', { action: 'leave' }, lead),
    /LEAVE_REQUIRES_CLOSE_OR_ABANDON/,
  )
  await h.dispatch('sansheng_mode', { action: 'leave', abandon_reason: 'budget cut' }, lead)
  const board = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(board.active, false)
  assert.equal(board.abandoned.reason, 'budget cut')
})

test('closing with an unfinished shared task is rejected', async () => {
  const h = harness({
    teammates: ['menxia', 'yushi', 'gongbu'],
    tasks: [
      { id: 'task-1', status: 'completed', ownerName: 'gongbu' },
      { id: 'task-2', status: 'in_progress', ownerName: 'gongbu' },
    ],
  })
  const reviewer = h.teammate('menxia')
  const resultReviewer = h.teammate('yushi')
  const worker = h.teammate('gongbu')
  await enterEdict(h)
  await planPass(h, reviewer)
  await h.dispatch('sansheng_appoint', { member: 'gongbu', department: '工部' }, h.leader)
  await h.dispatch('sansheng_evidence', {
    task_id: 'task-1', command: 'npm test', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok',
  }, worker)
  await h.dispatch('sansheng_gate', {
    kind: 'result', verdict: 'pass', checked: ['reviewed'],
    reviews: [{ task_id: 'task-1', verdict: 'pass' }],
  }, resultReviewer)
  await assert.rejects(
    h.dispatch('sansheng_close', { conclusions: ['done'], deliverables: ['d'] }, h.leader),
    /OPEN_TASKS/,
  )
})

test('evidence is rejected for unfinished tasks, weak digests and duplicates', async () => {
  const h = harness({
    teammates: ['menxia', 'gongbu'],
    tasks: [
      { id: 'task-1', status: 'completed', ownerName: 'gongbu' },
      { id: 'task-2', status: 'in_progress', ownerName: 'gongbu' },
    ],
  })
  const reviewer = h.teammate('menxia')
  const worker = h.teammate('gongbu')
  await enterEdict(h)
  await planPass(h, reviewer)
  const base = { task_id: 'task-2', command: 'npm test', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok' }
  await assert.rejects(
    h.dispatch('sansheng_evidence', { ...base, expected_revision: h.currentRevision() }, worker),
    /TASK_NOT_COMPLETED/,
  )
  await assert.rejects(
    h.dispatch('sansheng_evidence', { ...base, task_id: 'task-1', digest: 'nope' }, worker),
    /INVALID_DIGEST/,
  )
  await h.dispatch('sansheng_evidence', { ...base, task_id: 'task-1' }, worker)
  await assert.rejects(
    h.dispatch('sansheng_evidence', { ...base, task_id: 'task-1' }, worker),
    /DUPLICATE_EVIDENCE/,
  )
})

test('a result pass needs per-task reviews from a different reviewer', async () => {
  const h = harness({
    teammates: ['menxia', 'gongbu'],
    tasks: [{ id: 'task-1', status: 'completed', ownerName: 'gongbu' }],
  })
  const reviewer = h.teammate('menxia')
  const worker = h.teammate('gongbu')
  await enterEdict(h)
  await planPass(h, reviewer)
  await h.dispatch('sansheng_evidence', {
    task_id: 'task-1', command: 'npm test', exit_code: 0, digest: 'a'.repeat(64), excerpt: 'ok',
  }, worker)
  await assert.rejects(
    h.dispatch('sansheng_gate', { kind: 'result', verdict: 'pass', checked: ['x'] }, reviewer),
    /REVIEWER_MUST_DIFFER/,
  )
  await assert.rejects(
    h.dispatch('sansheng_gate', { kind: 'result', verdict: 'pass', checked: ['x'] }, h.teammate('yushi')),
    /TASK_REVIEWS_REQUIRED/,
  )
})

test('a 封驳 plan must be revised before the next plan pass', async () => {
  const h = harness({ teammates: ['menxia'] })
  const reviewer = h.teammate('menxia')
  await enterEdict(h)
  await h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'reject', defects: ['add acceptance'] }, reviewer)
  await assert.rejects(
    planPass(h, reviewer),
    /PLAN_NOT_REVISED/,
  )
  await h.dispatch('sansheng_edict', {
    goal: 'g2', acceptance: ['a2'], tier: 'medium', roster_cap: 5,
  }, h.leader)
  await planPass(h, reviewer)
  assert.equal(stateOf(h).gates.at(-1).verdict, 'pass')
})

test('a session composed from the 三省六部 preset starts active', async () => {
  const h = harness({ teammates: ['menxia'], agentPreset: 'sansheng' })
  const lead = h.leader
  assert.equal(h.projection.init(lead.session.header).active, true)

  const before = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(before.active, true)
  assert.equal(before.edict, null)

  await h.dispatch('sansheng_edict', { goal: 'preset flow', acceptance: ['board is active'], tier: 'medium', roster_cap: 5 }, lead)
  const after = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(after.edict.goal, 'preset flow')

  await h.dispatch('sansheng_mode', { action: 'leave', abandon_reason: 'test cleanup' }, lead)
  const left = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(left.active, false)
})

test('a standard session still starts inactive', () => {
  const h = harness({ agentPreset: 'standard' })
  assert.equal(h.projection.init(h.leader.session.header).active, false)
  assert.equal(h.projection.init(undefined).active, false)
})

test('prompt guidance stays silent before the mode is entered', () => {
  const h = harness()
  assert.equal(h.sections[0].text({ agent: h.leader }), '')
})

test('the Lead cannot self-review and an appointed member cannot review', async () => {
  const h = harness({ teammates: ['menxia', 'gongbu'] })
  const reviewer = h.teammate('menxia')
  const worker = h.teammate('gongbu')
  const lead = h.leader
  await enterEdict(h)

  await assert.rejects(
    h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'pass', checked: ['x'] }, lead),
    /REVIEWER_MUST_BE_TEAMMATE/,
  )
  await planPass(h, reviewer)
  await h.dispatch('sansheng_appoint', { member: 'gongbu', department: '工部' }, lead)
  await assert.rejects(
    h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'reject', defects: ['x'] }, worker),
    /SELF_REVIEW_NOT_ALLOWED/,
  )
})

test('teammate records reach the board only through the Lead message log', async () => {
  const h = harness({ teammates: ['menxia'] })
  const reviewer = h.teammate('menxia')
  const lead = h.leader
  await enterEdict(h)
  await h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'reject', defects: ['no command'] }, reviewer)

  const message = lead.session.events.find((event) => event.type === 'user/message')
  assert.ok(message !== undefined)
  assert.ok(message.data.content[0].text.includes('SANS_RECORD_V1'))

  const board = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(board.planGate.verdict, 'reject')
  assert.deepEqual(board.planGate.defects, ['no command'])
})

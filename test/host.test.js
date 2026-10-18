import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

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
        projection = definition
        return () => {}
      },
      stateOf(target, key) {
        if (key !== 'sansheng' || target?.events === undefined) return undefined
        return target.events.reduce((state, event) => projection.apply(state, event), projection.init(target.header))
      },
    },
  }

  apply(ctx, {})

  function tool(name) {
    const found = tools.find((entry) => entry.name === name)
    assert.ok(found !== undefined, `missing tool ${name}`)
    return found
  }

  /**
   * Execute one tool exactly as the Agent loop would expose it, then commit the
   * resulting event the runtime would write: a `tool/result` for a Lead call,
   * a `user/message` for a teammate record published to the Lead.
   */
  async function dispatch(name, args, agent) {
    const result = await tool(name).execute(args, { agent })
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

  return { ctx, leader, teammate, projection, tools, sections, dispatch, tool }
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
  const h = harness({ teammates: ['menxia', 'gongbu'], tasks: [{ id: 'task-1', status: 'completed' }] })
  const reviewer = h.teammate('menxia')
  const lead = h.leader

  const before = JSON.parse(await h.dispatch('sansheng_mode', { action: 'status' }, lead))
  assert.equal(before.active, false)

  await h.dispatch('sansheng_mode', { action: 'enter' }, lead)
  assert.equal(h.leader.session.events.filter((event) => event.type === 'tool/result').length, 1)

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

  await h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'pass', summary: 'decision-complete' }, reviewer)
  await h.dispatch('sansheng_appoint', { member: 'gongbu', department: '工部', write_scopes: ['src'] }, lead)
  await h.dispatch('sansheng_evidence', { task_id: 'task-1', command: 'npm test', exit_code: 0 }, reviewer)
  await h.dispatch('sansheng_gate', { kind: 'result', verdict: 'pass' }, reviewer)

  const closing = JSON.parse(await h.dispatch('sansheng_close', {
    conclusions: ['mode implemented'],
    deliverables: ['index.js'],
    unknowns: ['none'],
  }, lead))
  assert.equal(closing.op, 'close')
  assert.deepEqual(closing.closure.conclusions, ['mode implemented'])
  assert.equal(closing.closure.unknowns[0], 'none')

  const eventTypes = lead.session.events.map((event) => event.type)
  assert.deepEqual(eventTypes, [
    'tool/result', // mode enter
    'tool/result', // edict
    'user/message', // menxia plan gate (reject/pass record)
    'tool/result', // appointment
    'user/message', // menxia evidence
    'user/message', // menxia result gate
    'tool/result', // close
  ])

  const state = lead.session.events.reduce(
    (current, event) => h.projection.apply(current, event),
    h.projection.init(),
  )
  assert.equal(state.active, true)
  assert.equal(state.closure.closedBy, 'lead')
  assert.ok(h.sections[0].text({ agent: lead }).includes('Current board state'))
})

test('a session composed from the 三省六部 preset starts active', async () => {
  const h = harness({ agentPreset: 'sansheng' })
  const lead = h.leader
  assert.equal(h.projection.init(lead.session.header).active, true)

  const before = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(before.active, true)
  assert.equal(before.edict, null)

  // No sansheng_mode enter is needed: the preset header already activated it.
  await h.dispatch('sansheng_edict', { goal: 'preset flow', acceptance: ['board is active'], tier: 'medium', roster_cap: 5 }, lead)
  const after = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(after.edict.goal, 'preset flow')

  // Leaving the mode still wins over the preset-derived default on replay.
  await h.dispatch('sansheng_mode', { action: 'leave' }, lead)
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

  await h.dispatch('sansheng_mode', { action: 'enter' }, lead)
  await h.dispatch('sansheng_edict', {
    goal: 'g',
    acceptance: ['a'],
    tier: 'medium',
    roster_cap: 5,
  }, lead)

  await assert.rejects(
    h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'pass' }, lead),
    /REVIEWER_MUST_BE_TEAMMATE/,
  )
  await h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'pass' }, reviewer)
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

  await h.dispatch('sansheng_mode', { action: 'enter' }, lead)
  await h.dispatch('sansheng_edict', { goal: 'g', acceptance: ['a'], tier: 'medium', roster_cap: 5 }, lead)
  await h.dispatch('sansheng_gate', { kind: 'plan', verdict: 'reject', defects: ['no command'] }, reviewer)

  const message = lead.session.events.find((event) => event.type === 'user/message')
  assert.ok(message !== undefined)
  assert.ok(message.data.content[0].text.includes('SANS_RECORD_V1'))

  const board = JSON.parse(await h.dispatch('sansheng_board', {}, lead))
  assert.equal(board.planGate.verdict, 'reject')
  assert.deepEqual(board.planGate.defects, ['no command'])
})

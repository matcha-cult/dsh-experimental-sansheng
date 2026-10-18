import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

/**
 * Build a minimal Cordis-like context: enough surface for apply() to register
 * its projection, prompt section, and tools, plus a durable session log that
 * the fake projection can fold.
 */
function harness({ teammates = [], tasks = [] } = {}) {
  const leader = {
    session: {
      header: { id: 'sess-lead' },
      events: [],
      append(type, data) {
        this.events.push({ type, data })
      },
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
        return target.events.reduce((state, event) => projection.apply(state, event), projection.init())
      },
    },
  }

  apply(ctx, {})

  /** Create an exact live teammate Agent with Team membership. */
  function teammate(name) {
    const agent = {
      session: {
        header: { id: `sess-${name}` },
        events: [],
        append(type, data) {
          this.events.push({ type, data })
        },
      },
    }
    membership.set(agent, { role: 'teammate', name, root: leader })
    return agent
  }

  return { ctx, leader, teammate, projection, tools, sections }
}

function tool(tools, name) {
  const found = tools.find((entry) => entry.name === name)
  assert.ok(found !== undefined, `missing tool ${name}`)
  return found
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

test('mode, edict, gate, appointment, evidence and close flow records to the Lead log', async () => {
  const h = harness({ teammates: ['menxia', 'gongbu'], tasks: [{ id: 'task-1', status: 'completed' }] })
  const reviewer = h.teammate('menxia')
  const worker = h.teammate('gongbu')
  const lead = h.leader

  const mode = tool(h.tools, 'sansheng_mode')
  const edictTool = tool(h.tools, 'sansheng_edict')
  const appoint = tool(h.tools, 'sansheng_appoint')
  const gate = tool(h.tools, 'sansheng_gate')
  const evidence = tool(h.tools, 'sansheng_evidence')
  const close = tool(h.tools, 'sansheng_close')

  const before = JSON.parse(await mode.execute({ action: 'status' }, { agent: lead }))
  assert.equal(before.active, false)

  await mode.execute({ action: 'enter' }, { agent: lead })
  assert.equal(lead.session.events.filter((event) => event.type === 'sansheng/mode').length, 1)

  await edictTool.execute({
    goal: 'ship the mode',
    acceptance: ['tests pass'],
    tier: 'medium',
    roster_cap: 5,
    departments: ['工部', '刑部'],
  }, { agent: lead })

  await assert.rejects(
    appoint.execute({ member: 'gongbu', department: '工部' }, { agent: lead }),
    /PLAN_GATE_NOT_PASSED/,
  )

  await gate.execute({ kind: 'plan', verdict: 'pass', summary: 'plan is decision-complete' }, { agent: reviewer })
  await appoint.execute({ member: 'gongbu', department: '工部', write_scopes: ['src'] }, { agent: lead })
  await evidence.execute({ task_id: 'task-1', command: 'npm test', exit_code: 0 }, { agent: reviewer })
  await gate.execute({ kind: 'result', verdict: 'pass' }, { agent: reviewer })

  const closing = JSON.parse(await close.execute({
    conclusions: ['mode implemented'],
    deliverables: ['index.js'],
    unknowns: ['none'],
  }, { agent: lead }))
  assert.deepEqual(closing.conclusions, ['mode implemented'])
  assert.equal(closing.evidenceCount, 1)
  assert.equal(closing.unknowns[0], 'none')

  const events = lead.session.events.map((event) => event.type)
  assert.deepEqual(events, [
    'sansheng/mode',
    'sansheng/edict',
    'sansheng/gate',
    'sansheng/appoint',
    'sansheng/evidence',
    'sansheng/gate',
    'sansheng/close',
  ])
  assert.ok(h.sections[0].text({ agent: lead }).includes('Current board state'))
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

  await tool(h.tools, 'sansheng_mode').execute({ action: 'enter' }, { agent: lead })
  await tool(h.tools, 'sansheng_edict').execute({
    goal: 'g',
    acceptance: ['a'],
    tier: 'medium',
    roster_cap: 5,
  }, { agent: lead })

  await assert.rejects(
    tool(h.tools, 'sansheng_gate').execute({ kind: 'plan', verdict: 'pass' }, { agent: lead }),
    /REVIEWER_MUST_BE_TEAMMATE/,
  )
  await tool(h.tools, 'sansheng_gate').execute({ kind: 'plan', verdict: 'pass' }, { agent: reviewer })
  await tool(h.tools, 'sansheng_appoint').execute({ member: 'gongbu', department: '工部' }, { agent: lead })
  await assert.rejects(
    tool(h.tools, 'sansheng_gate').execute({ kind: 'plan', verdict: 'reject', defects: ['x'] }, { agent: worker }),
    /SELF_REVIEW_NOT_ALLOWED/,
  )
})

/**
 * 三省六部 (Sān Shěng Liù Bù) mode — host half.
 *
 * The board lives in the **Lead session's append-only event log** (`sansheng/*`
 * events folded by the `sansheng` session projection). No shared directory,
 * temp board, or writable coordination file is involved: the session log is
 * the only source of truth, and the browser half renders the projection.
 *
 * Hard gates enforced here (not merely advised by a prompt):
 * - only the Lead drafts the edict and appoints 六部;
 * - the plan gate must pass before appointments;
 * - the reviewer must be an independent teammate, never the Lead and never an
 *   appointed 六部 member;
 * - the Lead can only close after both gates pass and every completed shared
 *   task has evidence.
 *
 * Naming note: 省 here is read shěng (Sān Shěng Liù Bù), never xǐng.
 *
 * @module dsh-experimental-sansheng
 */
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  DEFAULT_SECTION,
  SanshengError,
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
} from './src/policy.js'

/** Cordis plugin name. */
export const name = 'sansheng'

/** Host services required before this mode can mount. */
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

/** Deployment schema for this mode. */
export const Config = z.object({
  section: z.string().default(DEFAULT_SECTION),
  maxExcerptChars: z.number().default(2000),
})

/** One canonical compact output schema shared by every tool in this package. */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/**
 * Build the projection state schema. Kept permissive in nesting shape but
 * exact for the fields the browser reads.
 * @returns {object} zod schema
 */
function stateSchema() {
  const edict = zod.object({
    revision: zod.number(),
    goal: zod.string(),
    acceptance: zod.array(zod.string()),
    boundaries: zod.array(zod.string()),
    tier: zod.string(),
    rosterCap: zod.number(),
    departments: zod.array(zod.string()),
    createdAt: zod.number().nullable(),
  })
  const appointment = zod.object({
    id: zod.string(),
    member: zod.string(),
    department: zod.string(),
    responsibility: zod.string().nullable(),
    writeScopes: zod.array(zod.string()),
    createdAt: zod.number().nullable(),
  })
  const gate = zod.object({
    id: zod.string(),
    kind: zod.string(),
    verdict: zod.string(),
    reviewer: zod.string(),
    defects: zod.array(zod.string()),
    summary: zod.string().nullable(),
    createdAt: zod.number().nullable(),
  })
  const evidence = zod.object({
    id: zod.string(),
    taskId: zod.string().nullable(),
    command: zod.string(),
    exitCode: zod.number(),
    digest: zod.string().nullable(),
    excerpt: zod.string().nullable(),
    submittedBy: zod.string(),
    sourceSessionId: zod.string().nullable(),
    createdAt: zod.number().nullable(),
  })
  const closure = zod.object({
    id: zod.string(),
    conclusions: zod.array(zod.string()),
    deliverables: zod.array(zod.string()),
    unknowns: zod.array(zod.string()),
    next: zod.array(zod.string()),
    closedBy: zod.string(),
    createdAt: zod.number().nullable(),
  })
  return zod.object({
    active: zod.boolean(),
    edict: edict.nullable(),
    appointments: zod.array(appointment),
    gates: zod.array(gate),
    evidence: zod.array(evidence),
    closure: closure.nullable(),
    revision: zod.number(),
  })
}

/**
 * Validate a caller Agent and return it.
 * @param {{agent?: object}} exec Tool execution carriers.
 * @param {string} toolName Calling tool name for diagnostics.
 * @returns {object} The calling Agent.
 */
function requireAgent(exec, toolName) {
  const agent = exec?.agent
  if (agent?.session === undefined || agent.session === null) {
    throw new Error(`${toolName} requires a calling agent with a session`)
  }
  return agent
}

/**
 * Mount the 三省六部 mode.
 * @param {object} ctx Cordis context of the mounted plugin row.
 * @param {{section?: string, maxExcerptChars?: number}} [config] Deployment config.
 */
export function apply(ctx, config = {}) {
  const settings = {
    section: typeof config.section === 'string' && config.section.trim() !== '' ? config.section : DEFAULT_SECTION,
    maxExcerptChars: Number.isInteger(config.maxExcerptChars) && config.maxExcerptChars > 0
      ? config.maxExcerptChars
      : 2000,
  }

  /**
   * Optional service lookup that survives a missing or guarded service.
   * @param {string} serviceName Cordis service name.
   * @returns {object|undefined} The service, when available.
   */
  function service(serviceName) {
    try {
      return typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Resolve the caller's Team role and the Lead session that owns the board.
   * A root agent without a Team service is treated as the Lead of its own log.
   * @param {object} agent Calling Agent.
   * @returns {{role: 'lead'|'teammate', name: string, leadSession: object}} Membership facts.
   */
  function memberOf(agent) {
    const teams = service('agentTeams')
    let membership
    if (teams !== undefined && typeof teams.tryMembership === 'function') {
      try {
        membership = teams.tryMembership(agent)
      } catch {
        membership = undefined
      }
    }
    if (membership !== undefined && membership !== null) {
      return {
        role: membership.role,
        name: membership.name,
        leadSession: membership.root.session,
      }
    }
    return { role: 'lead', name: 'lead', leadSession: agent.session }
  }

  /**
   * Read the latest board state from the Lead session projection.
   * @param {object} agent Calling Agent.
   * @returns {object} Board state (empty when not yet projected).
   */
  function boardOf(agent) {
    const { leadSession } = memberOf(agent)
    try {
      const state = ctx.sessionProjections.stateOf(leadSession, 'sansheng')
      return state ?? createEmptyState()
    } catch {
      return createEmptyState()
    }
  }

  /**
   * Read the current Team task views, tolerating a missing Team runtime.
   * @param {object} agent Calling Agent.
   * @returns {Array<object>} Task views.
   */
  function tasksOf(agent) {
    const teams = service('agentTeams')
    if (teams === undefined || typeof teams.listTasks !== 'function') return []
    try {
      return teams.listTasks(agent)
    } catch {
      return []
    }
  }

  /**
   * Append one board event to the Lead session log and flush it.
   * @param {object} agent Calling Agent.
   * @param {string} type `sansheng/*` event type.
   * @param {object} data Event payload.
   * @returns {Promise<void>} Resolves after the durable flush attempt.
   */
  async function record(agent, type, data) {
    const { leadSession } = memberOf(agent)
    leadSession.append(type, data)
    const sessions = service('sessions')
    if (sessions !== undefined && typeof sessions.flush === 'function') {
      await sessions.flush(leadSession)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Session projection: the browser board reads this                  */
  /* ---------------------------------------------------------------- */

  const schema = stateSchema()
  ctx.effect(() => ctx.sessionProjections.register({
    key: 'sansheng',
    stateVersion: 1,
    stateSchema: schema,
    init: () => createEmptyState(),
    apply: (state, event) => foldEvent(state, event),
    wire: {
      viewSchema: schema,
      view: (state) => state,
    },
  }), 'sansheng: board projection')

  /* ---------------------------------------------------------------- */
  /* Prompt section: only contributes while the mode is active         */
  /* ---------------------------------------------------------------- */

  const sectionOrder = (() => {
    try {
      return ctx.systemPrompt.getSectionOrder('TEAM_POLICY') + 1
    } catch {
      return 601
    }
  })()

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'sansheng:policy',
    order: sectionOrder,
    text: (context) => {
      const agent = context?.agent
      if (agent === undefined || agent === null || agent.session === undefined) return ''
      const state = boardOf(agent)
      if (state.active !== true) return ''
      return renderPolicy(settings.section, state)
    },
  }), 'sansheng: policy section')

  /* ---------------------------------------------------------------- */
  /* Tools                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Register one tool and tie its lifetime to this plugin row.
   * @param {object} tool Tool definition.
   * @returns {void}
   */
  function registerTool(tool) {
    ctx.effect(() => ctx.tools.register(tool), `sansheng: tool ${tool.name}`)
  }

  registerTool({
    name: 'sansheng_mode',
    description: 'Enter, leave, or inspect the 三省六部 (Sān Shěng Liù Bù) mode. The mode is recorded in the Lead session event log; there is no shared board file. Only the Lead may enter or leave; any member may inspect.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'leave', 'status'],
          description: 'enter: start the mode for this Team. leave: stop enforcing it. status: return the compact board summary.',
        },
      },
      required: ['action'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_mode')
      const action = validateModeAction(args?.action)
      if (action === 'status') {
        return JSON.stringify(summarizeBoard(boardOf(agent), tasksOf(agent)))
      }
      const caller = memberOf(agent)
      if (caller.role !== 'lead') {
        throw new SanshengError('LEAD_ONLY', 'only the Lead (政事堂) may enter or leave 三省六部 mode')
      }
      const active = action === 'enter'
      const state = boardOf(agent)
      if (state.active === active) return JSON.stringify({ active, changed: false })
      await record(agent, 'sansheng/mode', { active })
      return JSON.stringify({ active, changed: true })
    },
  })

  registerTool({
    name: 'sansheng_edict',
    description: 'Draft or revise the 制敕 (edict): goal, acceptance criteria, boundaries, task tier, roster cap, and the 六部 departments this job needs. Lead-only. Requires the mode to be active. The skill requires the edict before any appointment.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        goal: { type: 'string', description: 'One-sentence deliverable goal.' },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Acceptance criteria: verifiable statements the delivery must satisfy.',
        },
        boundaries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things that must not change: files, APIs, permissions, destructive actions.',
        },
        tier: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'small: one agent, no team (roster cap 0). medium: at most 5 teammates. large: at most 9 teammates.',
        },
        roster_cap: {
          type: 'integer',
          description: 'Teammates allowed for this job (excluding the Lead). Defaults to the tier cap; must not exceed it.',
        },
        departments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Executing ministries this job needs, e.g. 工部, 刑部, 礼部.',
        },
      },
      required: ['goal', 'acceptance', 'tier'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_edict')
      const caller = memberOf(agent)
      if (caller.role !== 'lead') throw new SanshengError('LEAD_ONLY', 'only the Lead (政事堂) drafts the edict')
      const state = boardOf(agent)
      if (state.active !== true) {
        throw new SanshengError('MODE_NOT_ACTIVE', 'enter 三省六部 mode first with sansheng_mode {action: "enter"}')
      }
      const normalized = validateEdictInput(args)
      const revision = (state.edict === null ? 0 : state.edict.revision) + 1
      const edict = { revision, ...normalized, createdAt: Date.now() }
      await record(agent, 'sansheng/edict', { edict })
      return JSON.stringify({
        revision,
        tier: edict.tier,
        rosterCap: edict.rosterCap,
        departments: edict.departments,
      })
    },
  })

  registerTool({
    name: 'sansheng_appoint',
    description: 'Appoint one teammate to one 六部 department with advisory write scopes. Lead-only. Rejected until the 门下省 plan gate has passed, when the roster cap would be exceeded, or when the member is already appointed (一人多部 is a fake roster).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        member: { type: 'string', description: 'Teammate target name, as returned by spawn_teammate.' },
        department: {
          type: 'string',
          enum: ['吏部', '户部', '礼部', '兵部', '刑部', '工部'],
          description: 'Executing ministry.',
        },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workspace-relative path prefixes this department may write. Advisory, not a lock.',
        },
        responsibility: { type: 'string', description: 'One-line responsibility for the roster.' },
      },
      required: ['member', 'department'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_appoint')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const normalized = validateAppointInput(state, args, caller)
      const teams = service('agentTeams')
      if (teams !== undefined && typeof teams.listMembers === 'function') {
        let known = []
        try {
          known = teams.listMembers(agent)
            .filter((member) => member.role === 'teammate')
            .map((member) => member.name)
        } catch {
          known = []
        }
        if (!known.includes(normalized.member)) {
          throw new SanshengError(
            'UNKNOWN_MEMBER',
            `${normalized.member} is not a teammate of this Team; spawn it first, then appoint it`,
          )
        }
      }
      const appointment = {
        id: `ap-${state.appointments.length + 1}`,
        member: normalized.member,
        department: normalized.department,
        responsibility: normalized.responsibility,
        writeScopes: normalized.writeScopes,
        createdAt: Date.now(),
      }
      await record(agent, 'sansheng/appoint', { appointment })
      return JSON.stringify({
        id: appointment.id,
        member: appointment.member,
        department: appointment.department,
        writeScopes: appointment.writeScopes,
      })
    },
  })

  registerTool({
    name: 'sansheng_gate',
    description: 'Record one 门下省 review verdict on the plan (`kind: "plan"`) or on the delivery (`kind: "result"`). Must be called by an independent teammate — never the Lead and never a member appointed to a 六部. A rejection must carry blocking defects; the Lead must reopen the affected task and resubmit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['plan', 'result'], description: 'Which gate is under review.' },
        verdict: { type: 'string', enum: ['pass', 'reject'], description: 'pass: proceed. reject: 封驳 with defects.' },
        defects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Blocking defects; required when verdict is reject and forbidden when it is pass.',
        },
        summary: { type: 'string', description: 'One-line review statement for the board.' },
      },
      required: ['kind', 'verdict'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_gate')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const normalized = validateGateInput(state, args, caller)
      const gate = {
        id: `gate-${state.gates.length + 1}`,
        kind: normalized.kind,
        verdict: normalized.verdict,
        reviewer: caller.name,
        defects: normalized.defects,
        summary: normalized.summary,
        createdAt: Date.now(),
      }
      await record(agent, 'sansheng/gate', { gate })
      return JSON.stringify({
        id: gate.id,
        kind: gate.kind,
        verdict: gate.verdict,
        reviewer: gate.reviewer,
        defects: gate.defects,
      })
    },
  })

  registerTool({
    name: 'sansheng_evidence',
    description: 'Record reproducible evidence from 刑部: the exact command, its exit code, an output digest, a bounded excerpt, and the shared task it covers. The full output stays in the executor\'s own session log; this record only references it. Do not paste large outputs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string', description: 'Shared task id this evidence covers, e.g. task-3.' },
        command: { type: 'string', description: 'Exact command (or check description) that produces the evidence.' },
        exit_code: { type: 'integer', description: 'Process exit code of the command.' },
        digest: { type: 'string', description: 'Optional SHA-256 (or similar) digest of the captured output.' },
        excerpt: { type: 'string', description: 'Bounded excerpt of the output; the full text remains in the executor session log.' },
        source_session_id: { type: 'string', description: 'Session that holds the full output, when it is not the caller\'s own session.' },
      },
      required: ['command', 'exit_code'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_evidence')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const tasks = tasksOf(agent)
      const normalized = validateEvidenceInput(state, args, tasks)
      const excerpt = normalized.excerpt === null
        ? null
        : normalized.excerpt.slice(0, settings.maxExcerptChars)
      const evidence = {
        id: `ev-${state.evidence.length + 1}`,
        taskId: normalized.taskId,
        command: normalized.command,
        exitCode: normalized.exitCode,
        digest: normalized.digest,
        excerpt,
        submittedBy: caller.name,
        sourceSessionId: normalized.sourceSessionId ?? sessionIdOf(agent),
        createdAt: Date.now(),
      }
      await record(agent, 'sansheng/evidence', { evidence })
      return JSON.stringify({
        id: evidence.id,
        taskId: evidence.taskId,
        submittedBy: evidence.submittedBy,
        exitCode: evidence.exitCode,
      })
    },
  })

  registerTool({
    name: 'sansheng_close',
    description: 'Close the case (结案) with the five-part report: conclusions, deliverables, evidence, residual unknowns, and next steps. Lead-only. Rejected until both gates passed and every completed shared task has evidence. This is the hard completion gate: do not claim the job is done before it returns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        conclusions: {
          type: 'array',
          items: { type: 'string' },
          description: 'What was delivered and verified.',
        },
        deliverables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths or artifacts that constitute the delivery.',
        },
        unknowns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Residual unknowns; use an explicit "none" item when there are none.',
        },
        next: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested next steps; may be empty.',
        },
      },
      required: ['conclusions', 'deliverables'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_close')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const tasks = tasksOf(agent)
      const normalized = validateCloseInput(state, args, tasks, caller)
      const closure = {
        id: 'close-1',
        conclusions: normalized.conclusions,
        deliverables: normalized.deliverables,
        unknowns: normalized.unknowns,
        next: normalized.next,
        closedBy: caller.name,
        createdAt: Date.now(),
      }
      await record(agent, 'sansheng/close', { closure })
      return JSON.stringify({
        closureId: closure.id,
        conclusions: closure.conclusions,
        deliverables: closure.deliverables,
        unknowns: closure.unknowns,
        next: closure.next,
        evidenceCount: state.evidence.length,
      })
    },
  })

  registerTool({
    name: 'sansheng_board',
    description: 'Read the compact 三省六部 board: edict, latest plan/result gate verdicts, appointments, evidence count, completed tasks missing evidence, and closure state. Any member may read it.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: textOutput,
    async execute(_args, exec) {
      const agent = requireAgent(exec, 'sansheng_board')
      return JSON.stringify(summarizeBoard(boardOf(agent), tasksOf(agent)))
    },
  })
}

/**
 * Render the deployment-owned guidance plus the current board snapshot.
 * @param {string} section Deployment guidance.
 * @param {object} state Board state.
 * @returns {string} Prompt section text.
 */
function renderPolicy(section, state) {
  const plan = latestGate(state, 'plan')
  const result = latestGate(state, 'result')
  const lines = [
    section.trim(),
    '',
    'Current board state (folded from the Lead session event log):',
    `- edict: ${state.edict === null
      ? 'not drafted yet'
      : `revision ${state.edict.revision}, tier ${state.edict.tier}, roster_cap ${state.edict.rosterCap}`}`,
    `- plan gate: ${plan === undefined ? 'pending' : `${plan.verdict} by ${plan.reviewer}`}`,
    `- appointments: ${state.appointments.length}`,
    `- evidence records: ${state.evidence.length}`,
    `- result gate: ${result === undefined ? 'pending' : `${result.verdict} by ${result.reviewer}`}`,
    `- closure: ${state.closure === null ? 'open' : `closed by ${state.closure.closedBy}`}`,
  ]
  return lines.join('\n')
}

/**
 * Best-effort durable Session identity for evidence references.
 * @param {object} agent Calling Agent.
 * @returns {string|null} Session id, when the header exposes one.
 */
function sessionIdOf(agent) {
  try {
    return agent?.session?.header?.id ?? agent?.session?.id ?? null
  } catch {
    return null
  }
}

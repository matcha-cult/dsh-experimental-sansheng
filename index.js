/**
 * 三省六部 (Sān Shěng Liù Bù) mode — host half.
 *
 * The board lives in the **Lead session's append-only event log**, folded by
 * the `sansheng` session projection from two replay-safe event families only:
 * `tool/result` for Lead-side records, and `user/message` for teammate records
 * that tools auto-publish to the Lead as marked Team messages. No shared
 * directory, temp board, or writable coordination file is involved, and no
 * custom session event type is ever appended — an unknown non-ignorable type
 * would make the harness refuse to reconstruct the session after restart.
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
  createInitialState,
  foldEvent,
  latestGate,
  serializeMessageRecord,
  serializeRecord,
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
  presetId: z.string().default('sansheng'),
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
    rev: zod.number().nullable(),
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
    checked: zod.array(zod.string()),
    reviews: zod.array(zod.object({
      taskId: zod.string(),
      verdict: zod.string(),
      defects: zod.array(zod.string()),
    })),
    rev: zod.number().nullable(),
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
    rev: zod.number().nullable(),
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
    abandoned: zod.object({ reason: zod.string(), at: zod.number().nullable() }).nullable(),
    history: zod.array(zod.any()),
    updatedAt: zod.number().nullable(),
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
    presetId: typeof config.presetId === 'string' ? config.presetId : 'sansheng',
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
   * In-process reservations bridge the gap between a tool's revision check and
   * the runtime committing its `tool/result` event. Without them two agents can
   * read the same board revision, both act, and both records would claim the
   * same next revision.
   */
  const pendingRevisions = new Map()

  /**
   * @param {object} agent Calling Agent.
   * @returns {string} Lead session key that owns the board.
   */
  function leadKey(agent) {
    const { leadSession } = memberOf(agent)
    return leadSession?.header?.id ?? leadSession?.id ?? 'lead'
  }

  /**
   * Effective board revision, including records already reserved but not yet
   * committed to the session log.
   * @param {object} agent Calling Agent.
   * @returns {number} Revision callers must echo in expected_revision.
   */
  function effectiveRevision(agent) {
    const state = boardOf(agent)
    return Math.max(state.revision ?? 0, pendingRevisions.get(leadKey(agent)) ?? 0)
  }

  /**
   * Board state with the effective revision applied (for validators).
   * @param {object} agent Calling Agent.
   * @returns {object} Board view.
   */
  function boardView(agent) {
    const state = boardOf(agent)
    return { ...state, revision: effectiveRevision(agent) }
  }

  /**
   * Reserve the next board revision for one committed record.
   * @param {object} agent Calling Agent.
   * @returns {number} Reserved revision.
   */
  function reserveRevision(agent) {
    const key = leadKey(agent)
    const state = boardOf(agent)
    const revision = Math.max(state.revision ?? 0, pendingRevisions.get(key) ?? 0) + 1
    pendingRevisions.set(key, revision)
    return revision
  }

  /**
   * Give back a reservation when publishing a record failed.
   * @param {object} agent Calling Agent.
   * @param {number} revision Reserved revision that failed.
   * @returns {void}
   */
  function releaseRevision(agent, revision) {
    const key = leadKey(agent)
    if (pendingRevisions.get(key) !== revision) return
    pendingRevisions.set(key, Math.max(boardOf(agent).revision ?? 0, revision - 1))
  }

  /**
   * Publish one teammate-side record into the Lead session log.
   *
   * A plugin installed into a profile cannot append an ignorable plugin record
   * to the host's session log: the only writer for that is a host-owned module
   * copy it cannot import. So teammate records travel as a normal Team message.
   * DSH records such delivery as a `user/message` with a Team source — a known,
   * replay-safe event type — and the Lead board projection folds the marked
   * envelope out of it. Lead-side records need no extra action: their own tool
   * result (`tool/result`) already carries the envelope.
   *
   * @param {object} agent Calling teammate Agent.
   * @param {string} text Marked record text.
   * @param {AbortSignal|undefined} signal Caller cancellation.
   * @returns {Promise<void>} Resolves after the Lead inbox accepts the message.
   */
  async function publishToLead(agent, text, signal) {
    const teams = service('agentTeams')
    if (teams === undefined || typeof teams.sendMessage !== 'function') {
      throw new Error('三省六部 needs the Agent Teams runtime to publish teammate records')
    }
    await teams.sendMessage(agent, {
      target: 'lead',
      content: [{ type: 'text', text }],
      signal,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Session projection: the browser board reads this                  */
  /* ---------------------------------------------------------------- */

  const schema = stateSchema()
  ctx.effect(() => ctx.sessionProjections.register({
    key: 'sansheng',
    stateVersion: 1,
    stateSchema: schema,
    init: (header) => createInitialState(header, settings.presetId),
    apply: (state, event) => foldEvent(state, event, settings.presetId),
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
    description: 'Enter, leave, or inspect the 三省六部 (Sān Shěng Liù Bù) mode. The mode is recorded in the Lead session event log; there is no shared board file. Only the Lead may enter or leave; any member may inspect. Enter/leave require expected_revision; leaving an open case also requires abandon_reason.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'leave', 'status'],
          description: 'enter: start the mode for this Team. leave: stop enforcing it. status: return the compact board summary.',
        },
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board; required for enter and leave.',
        },
        abandon_reason: {
          type: 'string',
          description: 'Required to leave an open case without closing it; recorded on the board as an abandoned case.',
        },
      },
      required: ['action'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_mode')
      const caller = memberOf(agent)
      if (args?.action === 'status') {
        return JSON.stringify(summarizeBoard(boardView(agent), tasksOf(agent)))
      }
      if (caller.role !== 'lead') {
        throw new SanshengError('LEAD_ONLY', 'only the Lead (政事堂) may enter or leave 三省六部 mode')
      }
      const state = boardOf(agent)
      const normalized = validateModeAction(boardView(agent), args)
      const active = normalized.action === 'enter'
      const abandoning = normalized.abandonReason !== null && state.abandoned === null
      if (state.active === active && !abandoning) {
        return JSON.stringify({ active, changed: false, revision: effectiveRevision(agent) })
      }
      const revision = reserveRevision(agent)
      const payload = { rev: revision, by: caller.name, active, changed: true }
      if (normalized.abandonReason !== null) {
        payload.abandoned = normalized.abandonReason
        payload.abandonedAt = Date.now()
      }
      return serializeRecord('mode', payload)
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
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board.',
        },
      },
      required: ['goal', 'acceptance', 'tier', 'expected_revision'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_edict')
      const caller = memberOf(agent)
      if (caller.role !== 'lead') throw new SanshengError('LEAD_ONLY', 'only the Lead (政事堂) drafts the edict')
      const state = boardOf(agent)
      const normalized = validateEdictInput(boardView(agent), args)
      const revision = reserveRevision(agent)
      const contentRevision = (state.edict === null ? 0 : state.edict.revision) + 1
      const edict = { revision: contentRevision, rev: revision, ...normalized, createdAt: Date.now() }
      return serializeRecord('edict', { rev: revision, by: caller.name, edict })
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
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board.',
        },
      },
      required: ['member', 'department', 'expected_revision'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_appoint')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const normalized = validateAppointInput(boardView(agent), args, caller)
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
      const revision = reserveRevision(agent)
      const appointment = {
        id: `ap-${state.appointments.length + 1}`,
        member: normalized.member,
        department: normalized.department,
        responsibility: normalized.responsibility,
        writeScopes: normalized.writeScopes,
        createdAt: Date.now(),
      }
      return serializeRecord('appoint', { rev: revision, by: caller.name, appointment })
    },
  })

  registerTool({
    name: 'sansheng_gate',
    description: 'Record one 门下省 review verdict on the plan (`kind: "plan"`) or on the delivery (`kind: "result"`). Must be called by an independent teammate — never the Lead, never a member appointed to a 六部, never a shared-task owner; plan and result need different reviewers. A pass must cite checked items; a passing result gate needs one reviews entry per completed task. A rejection must carry blocking defects and forces a revised plan or fresh evidence.',
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
        checked: {
          type: 'array',
          items: { type: 'string' },
          description: 'What the reviewer actually checked (acceptance items, evidence records). Required for a passing verdict.',
        },
        reviews: {
          type: 'array',
          description: 'Per-task result review (required for a passing result gate): one object per completed shared task.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              task_id: { type: 'string', description: 'Completed shared task id, e.g. task-3.' },
              verdict: { type: 'string', enum: ['pass'], description: 'Per-task verdict; a passing result gate may only contain pass.' },
            },
            required: ['task_id', 'verdict'],
          },
        },
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board.',
        },
      },
      required: ['kind', 'verdict', 'expected_revision'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_gate')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const normalized = validateGateInput(boardView(agent), args, caller, tasksOf(agent))
      const revision = reserveRevision(agent)
      const gate = {
        id: `gate-${state.gates.length + 1}`,
        kind: normalized.kind,
        verdict: normalized.verdict,
        reviewer: caller.name,
        defects: normalized.defects,
        checked: normalized.checked,
        reviews: normalized.reviews,
        summary: normalized.summary,
        rev: revision,
        createdAt: Date.now(),
      }
      // A teammate verdict must reach the Lead session log to become durable
      // board state; its own tool result is recorded in the child session only.
      if (caller.role === 'teammate') {
        try {
          await publishToLead(agent, serializeMessageRecord('gate', { rev: revision, by: caller.name, gate }), exec.signal)
        } catch (error) {
          releaseRevision(agent, revision)
          throw error
        }
      }
      return serializeRecord('gate', { rev: revision, by: caller.name, gate })
    },
  })

  registerTool({
    name: 'sansheng_evidence',
    description: 'Record reproducible evidence from 刑部 for a completed shared task: task_id, exact command, exit code, hexadecimal output digest, and a bounded excerpt. Duplicate evidence is rejected. The full output stays in the executor\'s own session log; do not paste large outputs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string', description: 'Completed shared task id this evidence covers, e.g. task-3.' },
        command: { type: 'string', description: 'Exact command (or check description) that produces the evidence.' },
        exit_code: { type: 'integer', description: 'Process exit code of the command.' },
        digest: { type: 'string', description: 'Hexadecimal digest of the captured output (16-128 characters).' },
        excerpt: { type: 'string', description: 'Bounded excerpt of the output; the full text remains in the executor session log.' },
        source_session_id: { type: 'string', description: 'Session that holds the full output, when it is not the caller\'s own session.' },
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board.',
        },
      },
      required: ['task_id', 'command', 'exit_code', 'digest', 'excerpt', 'expected_revision'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_evidence')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const tasks = tasksOf(agent)
      const normalized = validateEvidenceInput(boardView(agent), args, tasks)
      const revision = reserveRevision(agent)
      const excerpt = normalized.excerpt.slice(0, settings.maxExcerptChars)
      const evidence = {
        id: `ev-${state.evidence.length + 1}`,
        taskId: normalized.taskId,
        command: normalized.command,
        exitCode: normalized.exitCode,
        digest: normalized.digest,
        excerpt,
        submittedBy: caller.name,
        sourceSessionId: normalized.sourceSessionId ?? sessionIdOf(agent),
        rev: revision,
        createdAt: Date.now(),
      }
      // Same durable path as a teammate verdict: publish it into the Lead log.
      if (caller.role === 'teammate') {
        try {
          await publishToLead(agent, serializeMessageRecord('evidence', { rev: revision, by: caller.name, evidence }), exec.signal)
        } catch (error) {
          releaseRevision(agent, revision)
          throw error
        }
      }
      return serializeRecord('evidence', { rev: revision, by: caller.name, evidence })
    },
  })

  registerTool({
    name: 'sansheng_close',
    description: 'Close the case (结案) with the five-part report: conclusions, deliverables, evidence, residual unknowns, and next steps. Lead-only. Rejected until both gates passed, every shared task is completed/deleted, and every completed task has evidence. This is the hard completion gate: do not claim the job is done before it returns.',
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
        expected_revision: {
          type: 'integer',
          description: 'Board revision read from sansheng_board.',
        },
      },
      required: ['conclusions', 'deliverables', 'expected_revision'],
    },
    output: textOutput,
    async execute(args, exec) {
      const agent = requireAgent(exec, 'sansheng_close')
      const caller = memberOf(agent)
      const state = boardOf(agent)
      const tasks = tasksOf(agent)
      const normalized = validateCloseInput(boardView(agent), args, tasks, caller)
      const revision = reserveRevision(agent)
      const closure = {
        id: 'close-1',
        conclusions: normalized.conclusions,
        deliverables: normalized.deliverables,
        unknowns: normalized.unknowns,
        next: normalized.next,
        closedBy: caller.name,
        createdAt: Date.now(),
      }
      return serializeRecord('close', { rev: revision, by: caller.name, closure, evidenceCount: state.evidence.length })
    },
  })

  registerTool({
    name: 'sansheng_board',
    description: 'Read the compact 三省六部 board: revision (pass it as expected_revision to mutating calls), edict, gate verdicts and rounds, appointments, evidence, per-task reviews, missing evidence, abandoned/closure state. Any member may read it.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: textOutput,
    async execute(_args, exec) {
      const agent = requireAgent(exec, 'sansheng_board')
      return JSON.stringify(summarizeBoard(boardView(agent), tasksOf(agent)))
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
    `- board revision: ${state.revision} (pass this as expected_revision on mutating calls)`,
    `- edict: ${state.edict === null
      ? 'not drafted yet'
      : `revision ${state.edict.revision}, tier ${state.edict.tier}, roster_cap ${state.edict.rosterCap}`}`,
    `- plan gate: ${plan === undefined ? 'pending' : `${plan.verdict} by ${plan.reviewer}`}`,
    `- appointments: ${state.appointments.length}`,
    `- evidence records: ${state.evidence.length}`,
    `- result gate: ${result === undefined ? 'pending' : `${result.verdict} by ${result.reviewer}`}`,
    `- closure: ${state.closure === null ? 'open' : `closed by ${state.closure.closedBy}`}`,
    `- abandoned: ${state.abandoned === null ? 'no' : `yes (${state.abandoned.reason})`}`,
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

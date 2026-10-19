# 三省六部目标态与当前实现

This document is deliberately blunt: the plugin enforces a governance **process**; it cannot, by itself, turn every teammate into a capability-isolated executor.

## Target model

```
用户 → 中书省（接旨/规划/拟诏） → 门下省（硬审/封驳）
     → 尚书省（派发/协调/汇总） → 六部（专业执行）
     → 刑部/独立审计（取证/审计） → 人类（最终授权）
```

The invariant is not the names: it is the separation of **drafting, veto, execution and audit**, with a unified execution gateway and approval tokens that cannot be bypassed.

## Current implementation (0.5.x)

| Capability | Status | Notes |
|---|---|---|
| 中书省 structured edict | ✅ | goal, acceptance, boundaries, tier, roster, departments, workstreams, assumptions, risks, tools, data_scope, risk_level, budget |
| 门下省 hard plan/result gates | ✅ | independent teammate; pass needs `checked`; reject needs `defects`; different reviewer for result; reviewer cannot own a task |
| Conditional approval | ✅ | gate `conditions`; close needs a newer passing independent audit confirming every condition |
| Risk-based human approval | ✅ | `risk_level=high/irreversible` or large tier needs real `/sansheng approve` after the plan gate |
| Independent audit | ✅ | `sansheng_audit`; 刑部 may audit from inside ministries; other appointed ministries may not; auditor cannot own a task or be the gate reviewer |
| Six-ministry role cards | ⚠️ | appointment records carry role/duty and the board/prompt show boundaries; this is **not** a host sandbox |
| Full case history | ✅ | Lead session projection; no reasoning; 240-entry / 120k-character bound |
| Unified execution gateway / approval token | ❌ | host tools are dispatched by DSH, not by this plugin; a teammate can still call bash/fs directly |
| Per-agent tool allowlist / capability isolation | ❌ | needs host support; `write_scopes` remains advisory |
| Pre-execution snapshot / rollback | ❌ | needs host or workspace support |
| Budget/token enforcement | ❌ | `budget` is recorded as a plan constraint; it is not metered by this plugin |
| Cross-member audit aggregation | ❌ | detailed history is the Lead session's view; member internals stay in member sessions |

## Why the ❌ rows stay ❌

A plugin can reject its own tools, but it does not sit between an Agent and the host tool registry. Therefore:

- a teammate can bypass `sansheng_*` and call `bash`/`edit` directly;
- a token written to the session log is a claim, not a checked capability;
- `write_scopes` cannot prevent a write outside the scope;
- rollback needs a snapshot source the plugin does not own.

Making these real requires a host-level **tool gateway** or per-agent permission layer: every high-risk call must go through it, and it must validate an approval token minted by the gate/human approval. Until then, do not describe the current build as "六部权限隔离" or "所有工具调用都带批准令牌".

## Feasible next steps

1. **Host gateway prototype**: a dedicated `sansheng_execute` path + approval token validation; useful only if all high-risk tools are routed through it or the host enforces visibility.
2. **Per-agent allowlists**: integrate with DSH tool visibility/sandbox so a 工部 teammate does not see credential tools, a 礼部 teammate cannot write code, etc.
3. **Snapshot/rollback** and **metered budget** at the host/workspace layer.
4. **Cross-session audit projection** merged into the case board, instead of only the Lead log.

The current refactor stops at the plugin-enforceable boundary and records the rest as explicit residual unknowns rather than pretending they are solved.


## Derived 12-phase state machine

`casePhase()` derives: `idle → intake → plan_review → plan_rejected → awaiting_human → dispatching → executing → result_rejected → auditing → ready_to_close → closed | abandoned`. It is a read-only view over the event fold, not a second store. After three rejections on one gate, the board escalates instead of looping.

## External reference implementations (not dependencies)

These public projects independently converge on the same separation and were used as design cross-checks:

- `Caoran1314/sansheng-liubu` — explicit 12-state machine, `PendingConfirm` for high risk, delegation-depth/越权 matrix, append-only `audit.jsonl`.
- `SupportSpark/dsh-sansheng-liubu` — `court_review` hard plan review, evidence gate before review, `write_scopes`, rejection cap with human escalation.
- `cft0808/edict` / `expoli/edict` — mandatory institutional review, `SOUL.md` role definitions, subagent call boundaries, kanban/audit.
- `jasonhnd/life_OS`, `vannyben7/edict-agent`, `Geruyang/GAS-Agent-Skills` — skill-level separation-of-powers patterns.
- OpenCode plugins such as `sjzsdu/OpencodePlugins`, `opencode-plugin-emperor`, `opencode-imperial`, `oh-my-tang-dynasty` — review/dispatch/audit workflow variants.

They are credited as references only; this package does not vendor their code.


## Sequential cases

The board is single-case by design but a session may contain a sequence of
cases. `sansheng_mode enter` after a closed or abandoned case archives a compact
summary in `cases[]`, resets case-scoped fields, and increments `caseId`; the
append-only session log remains the complete audit. Parallel cases are out of
scope.

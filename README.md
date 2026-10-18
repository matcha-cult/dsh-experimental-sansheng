# 三省六部 · Sān Shěng Liù Bù

> **Pronunciation**: Sān **Shěng** Liù Bù. Here 省 means a government department and is read **shěng**, not the *xǐng* of 反省.
> Also known in English as *Three Departments and Six Ministries*.

A **三省六部 mode** for DeepSeek Harness: run the full loop — draft the edict, pass independent review gates, dispatch the six ministries, collect evidence, review the delivery, close the case — inside one session, with a dedicated shared board.

**No shared directory. No temp board.** Every coordination record (edict, gates, appointments, evidence, closure) is an append-only event in the **Lead session's event log**, folded into a `sansheng` session projection. The workspace never holds a second source of truth that another process could rewrite or delete.

---

## What it fixes

Three recurring multi-agent failures:

1. **Self-approval** — the agent that wrote the code also "verifies" it.
2. **Work before review** — the plan is never independently challenged.
3. **Silent loss of progress** — the board lives in a temp directory that gets cleaned, overwritten, or raced.

This plugin turns them into a state machine with **hard gates enforced by tools**:

- the plan must pass an independent 门下省 (teammate) review before any 六部 appointment;
- the reviewer can be neither the Lead nor an appointed ministry member;
- closing fails unless both gates passed and every completed task has evidence;
- state is rebuilt from the session log after resume, fork, or compaction.

## Relationship to the skill

The `three-departments-six-ministries` skill is the **procedure document**. This plugin is the **execution and audit layer**:

| | Skill | This plugin |
|---|---|---|
| Procedure guidance | ✅ | references the skill, does not duplicate it |
| Tool-level hard gates | ❌ (trust-based) | ✅ (refuses) |
| Dedicated board | ❌ | ✅ (Web conversation header) |
| Durable state | ❌ (optional files) | ✅ (session event log) |

## Install

```sh
dsh plugin --profile web add dsh-experimental-sansheng
```

Or enable it from the Web/Desktop **Plugins** page. This is a standard bundle: one switch mounts the host tools, the session projection, and the browser board together.

For local development, install from the directory:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-experimental-sansheng
```

Optional deployment text override:

```yaml
- id: sansheng
  name: dsh-experimental-sansheng
  config:
    section: |-
      (your deployment guidance)
    maxExcerptChars: 2000
```

## Flow

```text
1. 政事堂 (Lead)       sansheng_edict
2. 门下省 (teammate)   sansheng_gate { kind: "plan", verdict }
3. 尚书省 (Lead)       spawn_teammate → sansheng_appoint → team_task_create
4. 六部                team_task_* / file work
5. 刑部                sansheng_evidence
6. 门下省              sansheng_gate { kind: "result", verdict }
7. 政事堂              sansheng_close → report to the user
```

Any member can read `sansheng_board`; the Lead can also use `sansheng_mode {action:"status"}`.

## Tools

| Tool | Caller | Purpose |
|---|---|---|
| `sansheng_mode` | Lead (status: any member) | enter / leave / inspect the mode |
| `sansheng_edict` | Lead | goal, acceptance, boundaries, tier, roster cap, departments |
| `sansheng_appoint` | Lead | appoint one teammate to one 部 |
| `sansheng_gate` | independent teammate | plan/result verdict; rejection needs defects |
| `sansheng_evidence` | any member | command, exit code, digest, bounded excerpt, task id |
| `sansheng_close` | Lead | five-part closing report |
| `sansheng_board` | any member | compact board state |

## Hard gates

Tool-enforced, not prompt-enforced:

| Condition | Code |
|---|---|
| non-Lead drafts/appoints/closes | `LEAD_ONLY` |
| appointment before the plan gate | `PLAN_GATE_NOT_PASSED` |
| appointed member reviews its own delivery | `SELF_REVIEW_NOT_ALLOWED` |
| Lead reviews its own plan | `REVIEWER_MUST_BE_TEAMMATE` |
| result gate before plan gate | `PLAN_GATE_NOT_PASSED` |
| rejection without defects | `INVALID_FIELD` |
| pass carrying blocking defects | `DEFECTS_ON_PASS` |
| result gate without evidence | `NO_EVIDENCE_TO_REVIEW` |
| roster cap exceeded | `ROSTER_CAP_EXCEEDED` |
| one member holding several 部 | `MEMBER_ALREADY_APPOINTED` |
| closing with uncovered completed tasks | `COMPLETED_TASK_WITHOUT_EVIDENCE` |
| absolute or `..` write scope | `INVALID_WRITE_SCOPE` |

> Honest scope: **whether a Team task may be marked complete belongs to `team_task_update`, which this plugin cannot intercept.** What it does intercept is what decides the delivery verdict: appointment, gate verdicts, and closing. Completed tasks without evidence are surfaced in the board's red zone.

## The board

A **三省六部** action appears in the conversation header only while the mode is active. The read-only panel shows the edict, both gates with reviewer and defects, appointments and write scopes, evidence coverage, residual unknowns, closure, and a red zone (no edict, unreviewed plan, rejected plan, gate passed but nothing dispatched, tasks missing evidence).

It reads two session projections — `sansheng` and `agentTeam` — and stores nothing itself, so it cannot drift from the log.

## State and persistence

Six append-only events, all written to the **Lead session**:

`sansheng/mode`, `sansheng/edict`, `sansheng/appoint`, `sansheng/gate`, `sansheng/evidence`, `sansheng/close`.

They never enter model history and are unaffected by compaction. Resume and fork rebuild the board by folding the log. **No `.team/`, no `/tmp` board, no coordination file.**

## Relationship to Agent Teams

The plugin depends on DSH Agent Teams (`@deepseek-ai/dsh-experimental-agent-team-profile`). Roster, messaging, tasks, and waiting stay native; 三省六部 only adds the governance layer. The large tier needs `maxMembers ≥ 9` (the shipped bundle defaults to 8):

```yaml
- id: agent-team
  config:
    maxMembers: 12
```

## Known limitations

- **The entry point is a tool, not a preset** yet: call `sansheng_mode`. A preset card for new sessions is planned.
- Client plugins load per profile: refresh an already-open page after enabling/disabling.
- Single process, shared checkout: write scopes are advisory; the Lead still reviews the final diff.
- Reviewer granularity currently uses "reviewer is not an appointed ministry member" as the proxy for "author ≠ reviewer"; per-task authorship tracking is future work.
- Experimental: tool names and event schemas may change within a minor version.

## Development and publishing

```sh
npm install        # only needed for the host smoke tests
npm run verify     # node --check + node --test
npm pack --dry-run # inspect the published payload
```

Publish (requires npm login and ownership of the name):

```sh
npm login
npm version patch
npm publish --access public
```

## License

MIT

# Changelog

All notable changes to `dsh-experimental-sansheng` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [0.0.6] — 2026-10-20

### Changed

- Header shortcut copy: 军机处 → **三省六部·军机处**.
- Right-sidebar tab label: **军机处看板**; panel title: **三省六部·军机处**.
- Typography hierarchy follows the Web UI size: base/title/tabs 14px
  (`var(--dsh-content-font-size)`), card/paragraph/body content 12px
  (`calc(... - 2px)`), preserving the user's configured size.

## [0.0.5] — 2026-10-20

### Added

- A 军机处 shortcut in the session header utilities (the green-box area beside
  the background-task control); clicking it opens the current session's board
  in the right sidebar via `ctx.sidebarRight.openTab("sansheng")`.
- The board panel now takes its font size from the Web UI setting:
  `font-size: var(--dsh-content-font-size, 14px)` on the panel and
  `font-size: inherit !important` for descendants, so all panel text follows
  the user's configured UI size (14px by default).

### Changed

- The right-sidebar guide card remains as a second entry.

## [0.0.4] — 2026-10-20

### Changed

- 军机处 is now a **right-sidebar guide card + tab**, contributed by the
  session-scoped `sidebar.right.tab.guide.entry` and opened as a
  `sidebar.right.pane.tab`. It sits beside 工作区文件 / 新建终端 and shows the
  current session's board; no header button, global sidebar entry or floating
  overlay.
- Tabs inside the right panel: 总览/任务/审议/证据/时间线/历史.

## [0.0.3] — 2026-10-20

### Changed

- Board entry is now **session-scoped**: a 军机处 button appears in the header of
  the session whose board is active and opens a full **main page** for that
  session. Removed the global sidebar icon and the floating overlay entirely.
- The page has a 返回会话 button and keeps the six tabs.
- No automatic opening; the board only opens from the active session's header.

## [0.0.2] — 2026-10-20

### Changed

- The 三省六部 board is now a **sidebar panel** (`sidebar.panellist` +
  `main` page), labeled 军机处, instead of a floating overlay triggered from
  the conversation header. It lists sessions that have a board, lets the user
  switch between them, and keeps the six tabs (总览/任务/审议/证据/时间线/详细历史).
- The conversation-header floating trigger and its auto-open behavior are
  removed; the sidebar is the only board entry.

## [0.0.1] — 2026-10-19

Fresh version baseline after clearing remote tags.

### Added

- **Four-level triage** (`sansheng_triage`): trivial / small / medium / large
  from the three questions (independent review → plan gate → reviewer
  supervision); a user-requested tier wins. Trivial skips the mode
  (`sansheng_mode {action:"skip"}` for an active preset); small is Lead + one
  independent verifier, no plan gate and no ministry appointments.
- Small-tier light path: result gate by the single verifier, evidence/close
  unchanged; plan gate/ministry appointments are explicitly not required.
- Sequential cases (from the previous untagged 0.6.0 work): re-entering after
  close/abandon starts the next case, archives `cases[]`, resets case-scoped
  state and increments `caseId`; board shows 案卷 #N and 宗卷历史.
- 0.5.0 governance work included in this baseline: structured risk fields,
  conditional gates, independent audit, role cards, 12-phase state machine,
  rejection escalation.

## [0.6.0] — 2026-10-19

### Added

- **Sequential cases in one session**: after `sansheng_close` or an abandoned
  leave, `sansheng_mode {action:"enter"}` starts the next case instead of
  rejecting with `CASE_ALREADY_CLOSED`. The previous case is archived as a
  compact summary in `cases[]`, all case-scoped fields are reset, `caseId`
  increments, and the session log keeps the full audit.
- Board shows the current `案卷 #N`, plus a read-only 宗卷历史 list of archived
  cases (goal, tier, closed/abandoned, reason).
- Sequential only: at most one active case; parallel/multi-case was deliberately
  not added.

### Changed

- Mode enter after a closed/abandoned case is a new-case action; entering an
  open active case remains a no-op.

## [0.5.0] — 2026-10-19

### Added

- Structured edict risk fields: assumptions, risks, tools, data_scope,
  risk_level, budget. High/irreversible edicts require all of them.
- Risk-based real-user approval: large tier or high/irreversible risk requires
  `/sansheng approve` after the plan gate before appointment.
- Conditional gates: a passing plan/result gate may carry `conditions`; close
  requires a newer passing independent audit confirming every condition.
- `sansheng_audit`: independent teammate audit for conditions and high-risk
  deliveries. An appointed 刑部 may audit; other appointed ministries may not;
  the auditor cannot own a task or be the gate reviewer.
- Six-ministry role cards on appointments and the board; the runtime guidance
  states their responsibility boundaries.
- Derived 12-phase case state machine (`idle` … `closed`/`abandoned`) exposed
  as `phase` in `sansheng_board`; three rejections on one gate escalate to the
  user instead of looping.
- `docs/architecture.md`: explicit target-vs-current table, the host-level
  gateway/token/per-agent-isolation gaps, and external reference implementations.

### Changed

- High-risk close requires a passing result audit after the result gate.
- Board shows risk level, assumptions, risks, tools, data scope, budget,
  appointment roles, gate conditions and audit records.
- README flowcharts/prose document the risk/conditional/audit path and the
  current limitations. No tag accompanies this release.

## [0.4.4] — 2026-10-19

### Changed

- Aligned role labels with the historical 三省制: the Lead wears the
  **中书省** (receive the intent, plan, draft) and **尚书省** (dispatch,
  coordinate, summarize) hats; **门下省** stays an independent reviewer.
  政事堂 is documented as the Lead's coordinating seat, not a fourth department.
  Updated the runtime guidance, preset description/persona, board section
  headers (制敕 · 中书省 / 派发 · 尚书省 / 结案 · 尚书省汇总) and README prose.
  No gate or tool-contract change.

## [0.4.3] — 2026-10-19

### Removed

- The board's 成员 tab and the task-card 负责人轨迹 button. They duplicated the
  official Agent Team roster and the sidebar session list; case-level detail now
  lives in 详细历史. Member-internal trajectories remain available from the
  native Agent Team panel or the member session in the sidebar.

## [0.4.2] — 2026-10-19

### Fixed

- Restored the original board tab CSS. The 0.4.0 wrap guard was inserted inside
  the `.dss-tabs` declaration, splitting it so `display:flex`, `gap` and padding
  were lost; tabs collapsed against each other. The rule is valid again.

## [0.4.1] — 2026-10-19

### Fixed

- Opening a subagent/team-member session no longer auto-opens the board. The
  auto-open guard now waits until the header action's Session snapshot identity
  matches the visible Session and that Session is a root (Lead) view, so the
  brief parent-snapshot frame during navigation cannot trigger it.

## [0.4.0] — 2026-10-19

### Added

- **Detailed case history** (`sanshengHistory` projection + 详细历史 tab): folds
  the Lead session's user/assistant text, tool calls, tool results and teammate
  inbox deliveries into a bounded chronological log. The assistant's reasoning
  is deliberately excluded. Entries are filterable (全部/消息/工具/团队/治理/错误)
  and expand to show the tool arguments or result excerpt. No custom session
  event is appended, so restart/fork/compaction rebuild the same history; the
  newest 240 entries / 120k characters are retained.

## [0.3.1] — 2026-10-18

### Added

- **Member trajectory navigation**: the board gains a 成员 tab and a 负责人轨迹
  button on task cards. Both open the member's native DSH session
  (`uiWorkspace.openSession` with the continuable child target), where the full
  Chat / Trajectory is available. Trajectories are not copied into the board:
  no duplicated reasoning, no extra log surface, and archived sessions remain
  reachable from the sidebar.

## [0.3.0] — 2026-10-18

### Added

- **Workstream acceptance model**: `sansheng_edict` accepts optional
  `workstreams: [{id, department, deliverable, acceptance, write_scopes}]`.
  Evidence names `workstream_id`; a passing result gate must review every
  workstream, and close rejects a workstream without evidence.
- **Plan-gate freshness**: re-drafting the edict invalidates the previous plan
  pass; appointments, result review and close require a plan gate newer than
  the current edict revision.
- **Compatibility matrix + doctor**: `compatibility.json`, shipped
  `scripts/doctor.mjs` (`npm run doctor -- --host-version 0.2.1-rc.2`), and a
  `prepack` verification hook. `docs/verification.md` records the tested host
  and real-machine scenarios.

### Changed

- Board overview shows a 工作流 section with per-workstream acceptance,
  evidence count and review badge.

## [0.2.2] — 2026-10-18

### Added

- **Human 御批 (user approval)**: the host registers `/sansheng approve|reject|status`.
  `/sansheng approve [备注]` records a real user decision in the Lead session
  log (folded from the `command/run` event, not a model claim). Large-tier
  appointments now require a user approval newer than the latest plan gate;
  a user rejection blocks dispatch until the plan is revised and re-reviewed.
- **Stall escalation ladder** in board alerts: 30 min → read the board and
  inspect stalled members; 60 min → interrupt/reassign or report to the user;
  120 min → the user must decide, no unilateral relaxation of acceptance.
- Board approval timeline entries (`御批`), an overview approval chip, and a
  red-zone warning while a large plan waits for 御批.

## [0.2.1] — 2026-10-18

### Added

- **Full board drawer**: the conversation-header action now opens a tabbed
  三省六部 board — 总览 / 任务 / 审议 / 证据 / 时间线 — instead of a small
  popover. It auto-opens when the mode becomes active.
- **Task kanban**: shared tasks are grouped by status with owner, evidence and
  per-task review badges (已取证 / 缺证据 / 已复审).
- **Gate detail**: each gate shows its round, reviewer, checked items, defects
  and per-task reviews; the overview keeps the compact gate summary.
- **Evidence list**: task, command, exit code, digest prefix and excerpt.
- **Audit timeline**: the board keeps a bounded history (200 entries) of mode,
  edict, appointment, gate, evidence and close records, plus rejected tool
  calls (`denied`) folded from error tool results. The header dot turns red on
  a rejection or a board stalled for 30+ minutes.
- **Board alerts** are part of `sansheng_board` output: unfinished tasks,
  missing evidence, incomplete task reviews and stale boards.

## [0.2.0] — 2026-10-18

### Breaking

- Every mutating tool now requires `expected_revision` (read it from
  `sansheng_board`); stale writes fail with `STALE_REVISION` instead of
  forking the board or letting a late verdict win. Records carry their
  reserved revision and replay ignores stale duplicates.
- `sansheng_mode leave` on an open case now requires `abandon_reason`; leaving
  is recorded on the board as an abandonment.
- `sansheng_close` now rejects unfinished shared tasks (`OPEN_TASKS`), not just
  completed tasks without evidence.
- A passing gate must cite `checked` items; a passing result gate must carry
  one `reviews` entry per completed shared task, reviewed by a teammate who is
  neither the plan reviewer nor any task owner.
- A 封驳 plan must be re-drafted before it can pass again; a 封驳 result needs
  new evidence after the rejection.
- `sansheng_evidence` requires `task_id` on a completed shared task plus a
  hexadecimal `digest` and an `excerpt`; duplicate evidence is rejected.

### Added

- Board summary exposes `revision`, `abandoned`, `planRounds`, `resultRounds`
  and `taskReviews`; the panel shows the revision and an abandonment warning.

## [0.1.2] — 2026-10-18

### Added

- **三省六部 agent preset** (new companion package
  `dsh-experimental-sansheng-profile`): the new-task page offers a 三省六部 card
  next to Standard mode. The preset reuses the host's Standard child-plugin list
  with a 政事堂 persona, and the mode activates automatically from the session's
  durable `agent-preset/selected` event or `agentPreset` header, so the first
  turn is already governed. Installing the companion alone also mounts the core
  row (it depends on `dsh-experimental-sansheng`).
- The live header board appears immediately for preset sessions; `sansheng_mode
  leave` still overrides the preset-derived default and survives replay.
- The preset lives in its own bundle because a package declaring `dsh.client`
  cannot also carry a second loader row (client-modules rejects two active
  sources for one package).

## [0.1.1] — 2026-10-18

### Fixed

- **Restart/resume safety**: the board no longer appends custom `sansheng/*`
  session events. DSH refuses to reconstruct a session that contains an unknown
  non-ignorable event type, which made every board-bearing session unreadable
  after a process restart. Board state now derives only from `tool/result`
  events (Lead tools) and `user/message` events (teammate records published to
  the Lead as Team messages), both known replay-safe types.
- Teammate gate and evidence records are now auto-published to the Lead as a
  marked Team message (`SANS_RECORD_V1`), so the Lead projection sees them
  without an extra model round-trip.

## [0.1.0] — 2026-10-18

### Added

- 三省六部 (Sān Shěng Liù Bù) mode: `sansheng_mode` enters/leaves the mode and
  records it in the Lead session event log.
- Edict drafting with tier (`small` / `medium` / `large`), roster cap, acceptance
  criteria, boundaries, and target departments.
- Two independent review gates (`plan` and `result`) with hard enforcement:
  the Lead can never self-review, and appointed ministry members cannot review
  their own delivery.
- 六部 appointment with one-member-one-department enforcement and advisory
  workspace-relative write scopes.
- Evidence records referencing the executor session plus a bounded excerpt — the
  full output stays in the session log, not in a shared file.
- Closing report with hard gates: both verdicts passed, every completed shared
  task covered by evidence, roster within cap.
- `sansheng` session projection folded from `sansheng/*` events and a Web
  conversation-header board (`client.js`) rendering the projection together with
  the native `agentTeam` projection.
- Pure policy module (`src/policy.js`) with 34 tests (policy fold/validators + host registration and record-channel smoke tests).
- `.github/workflows/ci.yml` running `npm run verify` on push and pull request.

### Notes

- The board never uses a shared directory or temp file; the session event log is
  the only source of truth.
- Naming uses the correct romanization `sansheng` (省 = shěng), never `sanxing`.

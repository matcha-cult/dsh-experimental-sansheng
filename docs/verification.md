# Verification record

Host under test: **dsh 0.2.1-rc.2**. Package: `dsh-experimental-sansheng` + `dsh-experimental-sansheng-profile`.

## Automated

- `npm run verify` — 55 policy + host tests pass (revision CAS, gates, reviewer/evidence rules, workstreams, approvals, stall ladder).
- `npm run doctor -- --host-version 0.2.1-rc.2` — package, version, companion dependency and host matrix pass.
- `npm pack --dry-run` on both packages (compile includes `prepack`: verify).

## Real-machine scenarios (copied web profile, real model + real Team tools)

1. Preset card: the new-task page lists 三省六部; selecting it activates the mode without `sansheng_mode enter`; the header board opens automatically.
2. Full delivery: edict → independent plan gate → appointment → shared task → evidence (sha256) → per-task result review → close. Board reached rev 7, closed, task shown as 已取证 / 已复审.
3. Revision CAS: an intentionally stale `expected_revision` is rejected; the timeline records `拒绝 STALE_REVISION`.
4. Human 御批: large-tier plan; user runs `/sansheng approve 计划可以` in the Lead session; approval appears at rev 4 with `by user`; appointment then succeeds at rev 5. Command discovery and `command/run`/`command/done` persistence verified.
5. Detailed history: the 详细历史 tab listed user text, assistant replies, `sansheng_board` / `sansheng_edict` / `spawn_teammate` / `wait_agent` calls and their results plus 团队来信; synthetic runtime/time/system-reminder messages were excluded and no reasoning appeared. Filters (全部/消息/工具/团队/治理/错误) and per-entry expansion worked without console errors.
6. Restart durability: after a dsh process restart the session is readable and the board is rebuilt from the session log (no shared file).

## Evidence

Local screenshots from the runs above are kept outside the package:
`board-flow-overview.png`, `board-flow-tasks.png`, `board-flow-timeline.png`, `board-approval-overview.png`, `board-approval-timeline.png`.

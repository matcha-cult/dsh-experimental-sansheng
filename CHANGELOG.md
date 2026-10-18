# Changelog

All notable changes to `dsh-experimental-sansheng` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

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

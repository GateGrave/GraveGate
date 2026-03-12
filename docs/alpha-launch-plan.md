# Alpha Launch Execution Plan (Closed Alpha)

## Goal
Complete the gate in one pass and begin controlled tester sessions with a clear scope and risk posture.

## 1) Pre-gate validation (must pass before release candidate)
- Run: `npm run alpha:gate`
- If it fails, triage the first failure and rerun after fixes.

## 2) Optional hardening pass (before external invite)
- Verify strict env is set for test-server usage (`DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`).
- Validate `ADMIN_PLAYER_IDS` is set before handing control to moderators.
- Run one internal dry-run rotation to confirm restart/reseed behavior and stuck-state recovery.

## 3) Limited external invite window
- Invite 3-6 testers max for the first wave.
- Limit tester surface to commands in supported closed-alpha slice.
- Track failures by severity:
  - P0: crash/stuck session, invalid persistence writes
  - P1: action blocked incorrectly (wrong ownership, duplicate action, wrong turn)
  - P2: cosmetic/feedback UX

## 4) Exit criteria for true testing phase
- All commands in the alpha gate stay green for 3 consecutive runs.
- No open P0/P1 before expanding the tester pool.
- Postmortem notes captured for each P2 with a clear owner and severity.

## 5) Scope reminder
- Full spell engine, full raid/world-event loops, and live-ops dashboards are still explicitly out of alpha claims.

## 6) Alpha Issue Intake (required)
- Use: `docs/alpha-issue-triage-template.md`
- Require one report per issue with P0/P1/P2 severity and one reproducible command path.
- Escalate P0/P1 immediately and block wider tester rollout until resolved and re-gated.

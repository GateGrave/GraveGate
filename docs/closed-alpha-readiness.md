# Closed Alpha Readiness

This document defines the real closed-alpha surface for GateGrave and the minimum readiness checks before external testers are invited.

## Supported Closed-Alpha Slice

Included in alpha claims:

- Canonical command path:
  `Discord -> gateway -> controller -> router -> runtime -> subsystem -> persistence -> response`
- Character bootstrap and profile basics:
  - `/start` character creation with button-driven race/gestalt selection and 5e point-buy
  - `/profile` saved character summary output
  - `/inventory` saved inventory summary output
- Session/dungeon loop (single run slice):
  - dungeon enter
  - movement through connected rooms
  - encounter trigger and combat handoff
  - return from combat to session
  - reward hook consumption and persistence-compatible grant path
  - session leave/completion behavior
- Combat supported slice:
  - initiative + turn ownership enforcement
  - move/attack/item-use actions
  - ended-combat rejection and snapshot persistence
- Render integration:
  - combat state to PNG render path
  - layer ordering and out-of-bounds safety checks
- Hardening protections in supported flows:
  - malformed payload rejection on key mutation handlers
  - duplicate reward/trigger protections
  - ownership/authorization checks for session/combat/admin paths
  - stale/ended entity mutation rejection
- Multiplayer foundation (limited):
  - shared party session participation
  - actor ownership checks in shared combat
- Admin support (limited, development-facing):
  - inspect flows
  - controlled mutation actions (grant item/xp, reset session, spawn monster)
  - admin authorization guard

## Explicitly Not Alpha-Ready

Keep out of alpha claims:

- Full D&D 5e feature parity
- Full subclass progression mechanics
- Full spell engine (only scaffold/limited metadata paths are ready)
- Advanced reaction/opportunity combat systems beyond currently guarded behavior
- Full raid/world-event live gameplay loops (foundational scaffolds only)
- Full live-ops/admin dashboard (command-level toolkit only)
- Production anti-abuse platform (current safeguards are practical alpha hardening only)

## Smoke and Regression Matrix

Primary internal smoke harness:

- `npm run alpha:smoke:internal`
- strict variant: `npm run alpha:smoke:internal:strict`
- checklist reference: `docs/internal-alpha-smoke-checklist.md`

### Fast Smoke (`test:alpha:smoke`)

Run these in sequence:

1. Content load and schema/cross-reference checks
2. Character rules hook coverage
3. Runtime command path integration
4. Dungeon loop stabilization harness
5. Combat action request hardening coverage
6. Combat render integration coverage
7. Multiplayer runtime foundation coverage

### Full Alpha Regression (`test:alpha`)

1. Preflight checks (`alpha:preflight`)
2. Fast smoke matrix (`test:alpha:smoke`)
3. Broader regression suite:
   - `test:stage14`
   - `test:harness`

### Strict Alpha Gate (`alpha:gate`)

Run this command for a release-candidate hard stop:

- `npm run alpha:gate`

It enforces:
- strict preflight env checks
- smoke matrix
- alpha regression coverage

## Deployment/Test-Server Prerequisites

Minimum:

- Node.js `>=18`
- `npm install` completed
- content data files present and loadable
- runtime/gateway entrypoint files present

For strict Discord test-server readiness:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`

Recommended:

- `ADMIN_PLAYER_IDS` configured for controlled admin operations during alpha

## Diagnostics and Triage Notes

- Gateway logs include:
  - mapped incoming request event
  - runtime command result summary (`request_event_id`, response type, success flag)
  - runtime boundary errors
- Runtime gateway responses include `request_event_id` to help correlate request/response chains.
- Use admin inspection commands first for stuck-state triage before manual data mutation.

## Alpha Blocker Policy

A release candidate is blocked if any of the following fail:

- `npm run alpha:preflight`
- `npm run test:alpha:smoke`
- `npm run test:stage14`

Non-blocking for closed alpha (document but do not claim as ready):

- scaffold-only or intentionally unsupported systems listed above.



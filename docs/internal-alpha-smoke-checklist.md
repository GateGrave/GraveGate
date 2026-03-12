# Internal Alpha Smoke Checklist

Use this checklist before internal closed-alpha sessions.

## Supported Internal Slice (Current)

- Character assembly and `/start` bootstrap.
- Session/dungeon entry + exploration progression.
- Encounter trigger handoff into combat.
- Combat supported action slice: move / attack / item-use.
- Combat render refresh integration.
- Reward/progression grant path and session continuation/exit.
- Optional narrow multiplayer party/session/combat ownership checks.

## Explicitly Not in Internal Alpha Claim

- Full 5e mechanics parity.
- Full subclass progression mechanics.
- Full spellcasting engine.
- Full raid/world-event interactive loops.
- Full production live-ops toolchain.

## Canonical Internal Smoke Command

- Default:
  - `npm run alpha:smoke:internal`
- Strict (requires Discord env vars):
  - `npm run alpha:smoke:internal:strict`

Optional:

- Skip multiplayer step:
  - `node scripts/internal-alpha-smoke.js --skip-multiplayer`

## What the Internal Smoke Verifies

1. Startup/config/content preflight (`alpha-preflight`).
2. Character profile assembly smoke.
3. End-to-end content slice harness flow.
4. Dungeon loop stabilization flow.
5. Combat action hardening flow.
6. Combat render integration flow.
7. Multiplayer foundation flow (unless explicitly skipped).

## Internal Blockers

Do not proceed with internal alpha playtest if any smoke step fails.

Most common blockers:

- Missing runtime config in strict preflight.
- Broken content load/cross-reference.
- Dungeon/combat handoff regression.
- Reward/progression grant regression.
- Ownership/authorization regression in multiplayer paths.


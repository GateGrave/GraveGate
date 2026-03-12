# GateGrave Test Command Groups (Stage 13/14)

Use these root scripts for local checks and CI runs:

- `npm run test:gateway`
  - Runs gateway command registration and translation tests in `apps/gateway`.
- `npm run test:persistence`
  - Runs adapter and persistence bridge tests across database, character, inventory, session, and combat.
- `npm run test:runtime`
  - Runs runtime + controller event bus/orchestrator/integration tests.
- `npm run test:harness`
  - Runs harness-focused tests (`*harness*`) across the repo.
- `npm run test:hardening`
  - Runs focused hardening tests for sell validation, ownership, character-inventory link validation, and inventory mutation helpers.
- `npm run test:stage13`
  - Runs Stage 13 confidence set: gateway + foundation + harness.
- `npm run test:stage14`
  - Runs Stage 14 confidence set: gateway + runtime + persistence + first playable loop harness + hardening.
- `npm run test:all`
  - Runs `test:stage13` and `test:stage14` for full active command/runtime confidence.
- `npm run alpha:preflight`
  - Runs closed-alpha readiness checks (node/version/content/runtime entrypoints). Use `npm run alpha:preflight:strict` to also require Discord env vars.
- `npm run alpha:smoke:internal`
  - Runs the canonical internal alpha smoke harness (preflight + character assembly + content loop + dungeon/combat/render + optional multiplayer).
- `npm run alpha:smoke:internal:strict`
  - Same internal smoke harness but with strict Discord config preflight.
- `npm run test:alpha:tooling`
  - Verifies the alpha preflight and internal smoke scripts directly, including clear strict-env failure behavior.
- `npm run test:alpha:smoke`
  - Runs the closed-alpha smoke matrix (content + character + runtime + dungeon + combat + render + multiplayer).
- `npm run test:alpha:regression`
  - Runs broader closed-alpha regression (`test:stage14` + `test:harness`).
- `npm run test:alpha`
  - Runs preflight + smoke matrix + regression in one command.

Recommended use after each Stage 14 chunk:

1. `npm run test:stage14`
2. `npm run test:all` before merging or handoff
3. `npm run test:alpha` before inviting new closed-alpha testers
4. `npm run alpha:smoke:internal` before each internal alpha playtest session

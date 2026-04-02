# Character Slice Scope Lock

Date: 2026-04-02
Branch: `codex/spell-import-slice-2`

This note freezes the current branch around the character/player-state slice only.

Scope line for the next work window:
- `/start`
- `/profile`
- `/inventory`
- equip / unequip
- active-character switching
- Character Hub / roster flow

Explicitly out of scope:
- maps
- dungeon entry or session flow
- exploration movement
- combat
- rewards
- economy / trade / crafting
- broad refactors outside the touched character loop

## Changed Area Classification

In-scope character/player-state gameplay authority:
- `apps/world-system/src/character/flow/bootstrapPlayerStart.js`
- `apps/world-system/src/character/flow/processEquipmentRequest.js`
- `apps/world-system/src/account/processPlayerActiveCharacterRequest.js`
- `apps/world-system/src/account/resolveActiveCharacter.js`

Incidental canonical routing/runtime support required for this slice:
- `packages/shared-types/event-types.js`
- `apps/controller/src/event-router.js`
- `apps/controller/src/validator.js`
- `apps/controller/src/handlers/world.js`
- `apps/runtime/src/domainCommandDispatchHandlers.js`

Gateway presentation / navigation / cached-view support for this slice:
- `apps/gateway/src/index.js`

Verification for this slice:
- `apps/gateway/src/testing/gatewayRuntimeIntegration.test.js`
- `apps/runtime/src/testing/readCommandRuntime.test.js`
- `apps/controller/src/testing/eventRouterReadRouting.test.js`
- `apps/world-system/src/account/testing/accountSlotActiveCharacter.test.js`
- `apps/world-system/src/account/testing/activeCharacterPlayerState.test.js`
- `apps/world-system/src/character/testing/bootstrapPlayerStart.test.js`
- `apps/world-system/src/character/testing/processEquipmentRequestConsistency.test.js`

Docs / repo support:
- `docs/IMPLEMENTATION_STATUS.md`
- `package.json`
- `package-lock.json`

## Hot Files Touched

`apps/gateway/src/index.js`
- touched to support player-facing `/start`, profile, inventory, and Character Hub navigation, cached canonical snapshot reuse, and stale-view recovery

`apps/runtime/src/domainCommandDispatchHandlers.js`
- touched to keep the canonical world/account/inventory mutation and read responses aligned around the active character and snapshot-backed handoff behavior

Canonical content/data files that feed multiple systems
- not touched in this slice

`apps/combat-system/src/flow/processCombatActionRequest.js`
- not touched in this slice

`apps/dungeon-exploration/src/flow/interactWithObject.js`
- not touched in this slice

## Out-Of-Scope Drift Check

Observed repo-wide support changes:
- `package.json`
- `package-lock.json`

Reason:
- added `@jimp/file-ops` so the required `npm run gate:main` path can complete on this branch

Assessment:
- this is repo-support work, not gameplay-scope drift
- no map/combat/dungeon/economy feature work was added as part of the character slice

## Current Truth

What this branch now guarantees for the supported slice:
- `/start` requires and persists background selection
- each created character gets its own inventory
- the newest created character becomes active immediately
- `/profile`, `/inventory`, and equipment mutations resolve through the same active-character/account path
- players can switch active character from profile, inventory, and Character Hub
- Character Hub works as the multi-character management surface
- consumed `/start` controls fail cleanly after creation
- start/profile/inventory/hub handoff can reuse canonical snapshots instead of depending on immediate rescue reads

## Current Worktree Inventory

Tracked modified files:
- `apps/controller/src/event-router.js`
- `apps/controller/src/handlers/world.js`
- `apps/controller/src/testing/eventRouterReadRouting.test.js`
- `apps/controller/src/validator.js`
- `apps/gateway/src/index.js`
- `apps/gateway/src/testing/gatewayRuntimeIntegration.test.js`
- `apps/runtime/src/domainCommandDispatchHandlers.js`
- `apps/runtime/src/testing/readCommandRuntime.test.js`
- `apps/world-system/src/account/testing/accountSlotActiveCharacter.test.js`
- `apps/world-system/src/character/flow/bootstrapPlayerStart.js`
- `apps/world-system/src/character/flow/processEquipmentRequest.js`
- `apps/world-system/src/character/testing/processEquipmentRequestConsistency.test.js`
- `docs/IMPLEMENTATION_STATUS.md`
- `package.json`
- `package-lock.json`
- `packages/shared-types/event-types.js`

Untracked files in this checkpoint:
- `apps/world-system/src/account/processPlayerActiveCharacterRequest.js`
- `apps/world-system/src/account/resolveActiveCharacter.js`
- `apps/world-system/src/account/testing/activeCharacterPlayerState.test.js`
- `apps/world-system/src/character/testing/bootstrapPlayerStart.test.js`
- `docs/CHARACTER_SLICE_HANDOFF.md`
- `docs/CHARACTER_SLICE_SCOPE_LOCK.md`
- `docs/CHARACTER_SLICE_SMOKE_REPORT.md`

Tracked diff size at this checkpoint:
- 16 tracked files changed
- approximately `10,700` insertions
- approximately `3,092` deletions

## Current Green Checks

Green on the current worktree:
- `node apps/gateway/src/testing/gatewayRuntimeIntegration.test.js`
- `node apps/runtime/src/testing/readCommandRuntime.test.js`
- `node apps/controller/src/testing/eventRouterReadRouting.test.js`
- `node apps/world-system/src/character/testing/bootstrapPlayerStart.test.js`
- `node apps/world-system/src/account/testing/activeCharacterPlayerState.test.js`
- `node apps/world-system/src/character/testing/processEquipmentRequestConsistency.test.js`
- `npm run gate:main`

Latest observed totals:
- `gatewayRuntimeIntegration.test.js`: `81/81`
- `readCommandRuntime.test.js`: `81/81`
- `eventRouterReadRouting.test.js`: `32/32`
- `bootstrapPlayerStart.test.js`: `4/4`
- `activeCharacterPlayerState.test.js`: `5/5`
- `processEquipmentRequestConsistency.test.js`: `19/19`

## Lock

Until this branch is handed off, do not widen into:
- combat
- maps
- dungeon loop work
- economy / trade / crafting
- speculative cleanup outside the character/player-state loop

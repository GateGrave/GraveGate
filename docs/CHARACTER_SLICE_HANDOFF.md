# Character Slice Handoff

Date: 2026-04-02
Branch: `codex/spell-import-slice-2`

## PR Title

Lock down the alpha character/player-state slice

## Branch Summary

What changed:
- finished the canonical character/player-state cleanup around `/start`, `/profile`, `/inventory`, equipment actions, active-character switching, and Character Hub
- made background selection part of the truthful `/start` flow
- made each created character get its own inventory and become active immediately
- aligned profile, inventory, and equipment mutations around the same active-character/account path
- added Character Hub as the multi-character management surface
- made start/profile/inventory/hub handoff snapshot-backed so the gateway can stay aligned without immediate rescue reads in the supported slice
- hardened stale cache, stale active-character, and consumed `/start` control recovery
- brought the full required gate back to green on this branch

Why:
- to make the alpha character bootstrap slice stable, truthful, and reviewable without widening into combat, maps, dungeon flow, or economy work

Branch size at handoff:
- 16 tracked files modified
- 7 untracked files added
- tracked diff is approximately `10,700` insertions and `3,092` deletions

## PR Template Fill

## Summary

- What changed:
  - locked down the canonical character/player-state slice around `/start`, profile, inventory, equipment, active-character switching, and Character Hub
  - added truthful background selection, per-character inventory binding, immediate active-character assignment, hub-based multi-character management, and snapshot-backed handoff between character views
  - tightened stale-control, stale-cache, and empty-state behavior so the player loop stays coherent without admin intervention
  - restored the full required gate to green on the branch
- Why:
  - to make the alpha character bootstrap slice stable and truthful before moving back to broader gameplay work

## Required Checks

- [x] I read `docs/CONSTITUTION.md`
- [x] I followed `docs/CONSTITUTION.md`
- [x] I ran `npm run gate:main`
- [x] I did not commit generated map renders, local backups, or scratch artifacts

## Hot File Check

If this PR touches any of the following, say so explicitly and explain why:

- `apps/gateway/src/index.js`
- `apps/runtime/src/domainCommandDispatchHandlers.js`
- `apps/combat-system/src/flow/processCombatActionRequest.js`
- `apps/dungeon-exploration/src/flow/interactWithObject.js`
- canonical content/data files that feed multiple systems

Hot files touched:
- `apps/gateway/src/index.js`
  - touched to support player-facing `/start`, profile, inventory, and Character Hub navigation plus snapshot-backed cached-view recovery
- `apps/runtime/src/domainCommandDispatchHandlers.js`
  - touched to keep canonical start / switch / equipment / magical-item responses aligned around the same active-character and snapshot contract

## Source Of Truth Check

- [x] This change does not move gameplay logic into the gateway
- [x] This change does not create a second mutation path around canonical runtime/subsystem flow
- [x] This change does not treat rendered maps or raw image pixels as live gameplay authority
- [ ] Generated data was regenerated from authored source instead of hand-edited

## Testing

- Commands run:
  - `node apps/gateway/src/testing/gatewayRuntimeIntegration.test.js`
  - `node apps/runtime/src/testing/readCommandRuntime.test.js`
  - `node apps/controller/src/testing/eventRouterReadRouting.test.js`
  - `node apps/world-system/src/character/testing/bootstrapPlayerStart.test.js`
  - `node apps/world-system/src/account/testing/activeCharacterPlayerState.test.js`
  - `node apps/world-system/src/character/testing/processEquipmentRequestConsistency.test.js`
  - `npm run gate:main`
- Results:
  - `gatewayRuntimeIntegration.test.js`: `81/81` passed
  - `readCommandRuntime.test.js`: `81/81` passed
  - `eventRouterReadRouting.test.js`: `32/32` passed
  - `bootstrapPlayerStart.test.js`: `4/4` passed
  - `activeCharacterPlayerState.test.js`: `5/5` passed
  - `processEquipmentRequestConsistency.test.js`: `19/19` passed
  - `npm run gate:main` passed

## File Inventory

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

Untracked files added:
- `apps/world-system/src/account/processPlayerActiveCharacterRequest.js`
- `apps/world-system/src/account/resolveActiveCharacter.js`
- `apps/world-system/src/account/testing/activeCharacterPlayerState.test.js`
- `apps/world-system/src/character/testing/bootstrapPlayerStart.test.js`
- `docs/CHARACTER_SLICE_HANDOFF.md`
- `docs/CHARACTER_SLICE_SCOPE_LOCK.md`
- `docs/CHARACTER_SLICE_SMOKE_REPORT.md`

## Review

Comment `@codex review` on this PR if you want Codex review on the GitHub side.

## Manual Smoke Summary

See [docs/CHARACTER_SLICE_SMOKE_REPORT.md](/C:/Users/jonbr/OneDrive/Desktop/GateGrave%20Bot/GateGrave-bot-System/docs/CHARACTER_SLICE_SMOKE_REPORT.md).

Short version:
- first-character create -> profile -> inventory works
- second-character create routes through Character Hub
- profile / inventory / equipment stay aligned to the active character
- stale controls and empty states fail safely

## What This Slice Now Guarantees

- a player can create a character through `/start`
- the created character becomes the active character immediately
- `/profile` resolves the correct active or owned-fallback character
- `/inventory` resolves the correct linked inventory for that character
- equip / unequip mutate the correct active character inventory
- players can manage multi-character accounts through Character Hub without admin-only tooling

## Remaining Risk

- this is a local branch handoff checkpoint, not a production deployment signoff
- a future live Discord smoke pass is still worthwhile, but the local required gate is green and the character/player-state slice is stable enough to hand off

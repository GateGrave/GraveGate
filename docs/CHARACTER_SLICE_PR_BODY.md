# Character Slice PR Body

Use this as the PR body for the whole branch state.

## Summary

- What changed:
  - locked down the canonical character/player-state slice around `/start`, `/profile`, `/inventory`, equipment actions, active-character switching, and Character Hub
  - made background selection part of the truthful `/start` flow
  - made each created character get its own inventory and become active immediately
  - aligned profile, inventory, and equipment mutations around the same active-character/account path
  - added Character Hub as the multi-character management surface
  - made start/profile/inventory/hub handoff snapshot-backed so the gateway can stay aligned without immediate rescue reads in the supported slice
  - hardened stale cache, stale active-character, stale `/start` control, and empty-state recovery
  - normalized player-facing guidance across `/start`, profile, inventory, and Character Hub
  - restored the full required gate to green on the branch
- Why:
  - to make the alpha character bootstrap slice stable, truthful, and reviewable before returning to broader gameplay work

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
  - touched to support player-facing `/start`, profile, inventory, and Character Hub navigation, cached canonical snapshot reuse, stale-view recovery, and consistent character-slice readback
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

## Manual Smoke Summary

- first-character create -> profile -> inventory works
- second-character create routes through Character Hub
- profile / inventory / equipment stay aligned to the active character
- stale controls and empty states fail safely

Notes:
- this smoke report was run through the local gateway/runtime harness, not a live Discord production pass
- full details are in [docs/CHARACTER_SLICE_SMOKE_REPORT.md](/C:/Users/jonbr/OneDrive/Desktop/GateGrave%20Bot/GateGrave-bot-System/docs/CHARACTER_SLICE_SMOKE_REPORT.md)

## What This Slice Now Guarantees

- a player can create a character through `/start`
- the created character becomes the active character immediately
- `/profile` resolves the correct active or owned-fallback character
- `/inventory` resolves the correct linked inventory for that character
- equip / unequip mutate the correct active character inventory
- players can manage multi-character accounts through Character Hub without admin-only tooling

## Reviewer Notes

- This is a broad character/player-state branch, not a tiny patch.
- The review should focus on whether the slice stays truthful and canonical:
  - `/start`
  - active-character resolution
  - profile / inventory consistency
  - equipment mutation consistency
  - Character Hub / roster navigation
- Supporting notes:
  - [docs/CHARACTER_SLICE_SCOPE_LOCK.md](/C:/Users/jonbr/OneDrive/Desktop/GateGrave%20Bot/GateGrave-bot-System/docs/CHARACTER_SLICE_SCOPE_LOCK.md)
  - [docs/CHARACTER_SLICE_HANDOFF.md](/C:/Users/jonbr/OneDrive/Desktop/GateGrave%20Bot/GateGrave-bot-System/docs/CHARACTER_SLICE_HANDOFF.md)
  - [docs/CHARACTER_SLICE_SMOKE_REPORT.md](/C:/Users/jonbr/OneDrive/Desktop/GateGrave%20Bot/GateGrave-bot-System/docs/CHARACTER_SLICE_SMOKE_REPORT.md)

## Review

Comment `@codex review` on this PR if you want Codex review on the GitHub side.

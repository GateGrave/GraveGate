# Character Slice Smoke Report

Date: 2026-04-02
Branch: `codex/spell-import-slice-2`

Method:
- local gateway/runtime interaction harness
- slice regression suites
- full `npm run gate:main`

This was a manual-style local smoke pass through the supported character/player-state flow. It was not a live Discord production smoke pass.

## Scenario 1: Fresh Account Create Flow

Steps checked:
- `/start` wizard requires the expected selections
- background is part of the required create path
- point-buy completion is enforced before create
- newly created character becomes active
- `/profile` resolves to the created character
- `/inventory` resolves to that same character's inventory

Outcome:
- passed in local harness

Notes:
- start completion now returns canonical profile plus inventory snapshots
- first-character handoff stays simple with direct `Open Profile` and `Open Inventory`

## Scenario 2: Multi-Character Account Flow

Steps checked:
- create a second character
- `/start` completion routes into Character Hub for multi-character accounts
- roster and slot status show up in player-facing readback
- switch active character from hub
- open profile and inventory from hub
- verify both match the switched character

Outcome:
- passed in local harness

Notes:
- Character Hub now acts as the main roster-management surface for multi-character accounts

## Scenario 3: Equipment Flow

Steps checked:
- open inventory for the active character
- equip an item
- verify inventory state updates on the same active character
- go back to profile and reopen inventory
- verify active character and updated inventory stay aligned
- unequip and verify the same loop again

Outcome:
- passed in local harness

Notes:
- equip/unequip now return canonical inventory snapshot data
- profile-linked inventory snapshots stay aligned after inventory mutation

## Scenario 4: Failure And Empty States

Steps checked:
- stale `/start` button after successful creation
- `/profile` for a player with no characters
- `/inventory` for a player with no characters
- invalid or stale active-character switch path through fixtures / harness

Outcome:
- passed in local harness

Notes:
- consumed `/start` controls now fail cleanly with a rerun instruction
- empty profile / inventory states now reply safely and explain what to do next

## Mismatches Found During Lockdown

Resolved code mismatches:
- stale `/start` controls could still rebuild wizard state after creation instead of failing cleanly
- `start:complete:*` buttons could fall back into the generic start handler instead of routing through the profile/hub handoff flow
- unknown `profile:view:*` interactions were not always failing through the proper profile path

Current unresolved slice mismatches:
- none observed in the local character/player-state harness

## Conclusion

Current local result:
- the first-character flow works end to end
- the second-character flow routes through Character Hub
- active-character switching stays aligned across profile, inventory, and equipment
- stale or consumed controls fail cleanly
- empty states are understandable without admin intervention

Remaining honesty note:
- this report proves the local supported slice through the repo's gateway/runtime harness and full gate
- it does not replace a future live Discord smoke pass

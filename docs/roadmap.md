# GateGrave Roadmap

Last updated: 2026-03-12

This is the working roadmap for the actual repo state.

Rules for this file:
- `[x]` means implemented and verified enough to build on
- `[~]` means partially implemented or scaffolded
- `[ ]` means not implemented in a player-ready way
- Keep this file aligned to canonical paths only
- Do not mark scaffold-only systems as done

## Current Position

Current supported slice:
- Character creation
- Profile and inventory readback
- Dungeon session entry and movement
- Combat handoff and return
- Core combat actions
- Reward grant and persistence
- Session leave and cleanup

Current immediate build direction:
1. Deepen combat rules
2. Improve player-facing combat/session UX
3. Add richer dungeon interactions
4. Expand itemization and economy depth
5. Expand MMO/social/world systems into real gameplay

## Core Architecture

- [x] Event-driven command/runtime/subsystem flow
- [x] Gateway contains no gameplay logic
- [x] World, session, and combat state separation
- [x] Persistence bridges for character, inventory, session, and combat
- [x] Canonical router/runtime dispatch path
- [x] Combat render remains presentation-only
- [~] Snapshot/reload coverage is strong, but not yet universal across every advanced scaffold

## Character and Progression

- [x] `/start` character creation
- [x] Button-driven race and gestalt track selection
- [x] 5e point-buy start flow
- [x] `/profile` summary
- [~] Styled character sheet embed
- [x] Background content loading
- [x] Gestalt start foundation
- [~] Gestalt progression long-term rules
- [~] Level-up progression depth
- [ ] Feats system
- [ ] Full char sheet screen/output
- [ ] Skills system as full gameplay-facing layer
- [ ] Flavor-rich progression text layer

## Inventory and Items

- [x] Canonical inventory persistence and mutation helpers
- [x] `/inventory` summary
- [x] Reward-to-inventory grant path
- [x] Currency on inventory in supported slice
- [x] Equipment/equip/unequip flow
- [x] Magical item data and support foundations
- [x] Attuned item gameplay loop
- [ ] Growth item gameplay loop
- [x] Unidentified item discovery/identify loop
- [~] Inventory screen with richer button UX
  - Magical tab now exposes button-driven identify/attune/unattune actions
  - Equipment tab now exposes button-driven equip/unequip actions

## Combat Foundation

- [x] Isolated combat instances
- [x] Initiative and turn order
- [x] Move action
- [x] Attack action
- [x] Item use in combat
- [x] Actor ownership enforcement
- [x] Ended combat rejection
- [x] Combat snapshot persistence
- [x] Combat PNG render path
- [x] Conditions framework
- [x] Reactions
- [x] Opportunity attacks
- [x] Saving throw helpers
- [x] Typed damage support for spell path
- [x] Initial spell pipeline
- [x] Core action and movement resource consumption
- [x] Spellcasting starter slice
- [~] Concentration support foundations
- [x] AI monster control foundation
- [ ] Full D&D spell engine
- [~] Utility spell gameplay integration
  - Dungeon interaction path now supports `light`, `thaumaturgy`, `knock`, `detect_magic`, and `identify`
- [ ] Advanced combat AI behavior profiles
- [ ] Full action economy enforcement across all action types
- [ ] Broad 5e combat rules parity

## Combat Map and Output

- [x] Authoritative tile-grid combat state
- [x] Tile-to-pixel combat render consistency
- [x] Stable render layer ordering
- [x] Turn-to-turn render regeneration
- [x] Out-of-bounds render safety
- [x] Removed/defeated actors stop rendering
- [x] Player-facing combat output readability
- [x] Canonical `/combat` battle-state read path
- [ ] Cleaner combat screen UX in Discord
- [ ] Better spell/action result summaries

## Dungeon and Exploration

- [x] Session creation and entry
- [x] Session persistence
- [x] Room movement and progression
- [x] Trigger consumption
- [x] Dungeon-to-combat handoff
- [x] Combat-to-session return
- [x] Reward continuity in dungeon loop
- [x] Session leave/cleanup
- [x] Canonical room object interaction command/path
- [~] Multiple supported dungeons/content packs
- [x] Trap gameplay loop
- [x] Locked chest gameplay loop
- [x] Locked door gameplay loop
- [x] Utility-spell dungeon interactions
- [ ] Rich visual dungeon map layer
- [~] More non-combat room interactions
  - Shrines can now grant blessings, reveal rooms, and clear movement locks
  - Lore objects can now record discoveries and reveal rooms
  - Objects can now require spell hooks, skill proficiency, or tool proficiency on the canonical `/interact` path
  - Objects can now use rolled skill, tool, and ability checks with hidden-path / arcane-seal style effects
  - Hidden doors and linked trapped chests now work as concrete content patterns
  - Room readback now exposes visible objects and exits through the canonical runtime/session path
  - Common room movement and object interactions now have button-driven gateway controls on top of the same runtime events

## Loot and Rewards

- [x] Canonical reward path
- [x] Duplicate reward protection
- [x] XP reward support in supported slice
- [x] Gold/currency reward support in supported slice
- [x] Persistence-compatible reward mutation
- [x] Loot roll support
- [~] Broader loot/content variety
- [ ] Rich looting UX

## Economy, Crafting, and Trade

- [x] Direct trade foundation
- [x] Currency trade foundation
- [x] Rankings-backed world-state persistence compatibility
- [~] Economy system foundation
- [x] Crafting gameplay loop
- [x] Shopkeeping gameplay loop
- [x] Direct player trade gameplay loop
- [~] Full player-facing trade UX
  - Button-driven proposal wizard for common item-for-gold trades is in
  - Shop, craft, and trade viewers now cross-link with buttons instead of forcing command re-entry
  - Trade ledger/detail summaries now resolve item names instead of only raw item ids
  - Richer barter/multi-item proposal flow is still pending
- [~] Broader economy balancing
  - Shop and craft embeds now surface richer readback from current content/runtime metadata

## Multiplayer, Guilds, and Social Systems

- [x] Party foundation
- [x] Shared session participation
- [x] Shared combat participation
- [x] Actor ownership enforcement in multiplayer combat
- [x] Guild foundation
- [x] Guild membership tracking foundation
- [~] Guild progression depth
- [~] Guild ranking foundations
- [ ] Polished party UX
- [ ] Guild gameplay loop depth
- [ ] Guild ranking systems as player-facing feature

## Raids and World Systems

- [x] Rankings foundation
- [x] Hunter contract foundation
- [x] Raid/world-event scaffolds
- [x] Admin/world control support for world events
- [~] World event foundations
- [~] Raid foundations
- [ ] Raid boss gameplay loop
- [ ] Real world-event gameplay loop
- [ ] Raid participation UX
- [ ] Leaderboards beyond current ranking foundations
- [ ] Achievements
- [ ] Titles

## Admin, Debug, and Support

- [x] Canonical `/admin` path
- [x] Admin authorization guard
- [x] Inspection helpers
- [x] Session reset helper
- [x] Combat monster spawn helper
- [x] Content refresh helper
- [~] Debug sandbox mode for DMs
- [ ] Better DM/debug command ergonomics
- [ ] Rich support dashboards

## UI and Player Experience

- [x] Button-first `/start` flow
- [x] Reduced typed input for character creation
- [~] Cleaner player-facing response formatting
- [~] Command surface is improving, but still needs consolidation
  - Normal magical item flow no longer depends on typing `/identify`, `/attune`, or `/unattune`
  - Normal equipment flow no longer depends on typing `/equip` or `/unequip`
- [~] Streamlined button-first UI across core gameplay
- [~] Dungeon room UI/readback
  - Enter/move/interact now surface room, exits, and visible objects
  - Common exits and object actions now have button-driven controls
  - Object buttons are now state-aware (`Unlock`, `Open`, `Disarm`, `Read`, `Activate`)
  - Common objects can now expose multiple valid action buttons in the same room view
- [~] Cleaner combat screen UX
  - Attack, cast, move, and combat-item responses now render with combat embeds
  - Turn ownership and AI aftermath are now easier to read at a glance
  - Combat state now surfaces the active combatant's resources and conditions directly in the status view
  - Attack and spell results now read as outcomes instead of only raw booleans/flags
  - Runtime combat responses now include round and participant HP snapshots for gateway presentation
  - Combat replies now include a dedicated battle-state embed alongside the action result
  - `/combat` now provides a canonical refreshable combat status view
  - Combat state now renders a compact participant roster with HP, conditions, and action resources
- [ ] Remove redundant commands and overlaps
- [~] Intuitive char sheet screen
- [~] Intuitive inventory screen
- [ ] Strong flavor text layer across systems
- [ ] Isekai identity/presentation layer

## Priority Queue

### Now

- [~] Build 5e-style dungeon interaction hooks further
  - Spell hooks now include `knock`, `detect_magic`, and `identify`
  - Skill and tool proficiency gates are in
  - Rolled dungeon checks are in
  - Hidden doors and trapped-object patterns are in
  - Broader content coverage is still pending
- [ ] Build cleaner combat screen UX
- [~] Deepen trade UX beyond the current wizard/detail flow

### Next

- [ ] Reduce redundant commands across core play
- [ ] Broaden economy progression beyond starter balancing
- [~] Add richer shop/craft button UX beyond browse/buy/make

### Later

- [ ] Guild/player-facing guild ranking systems
- [ ] Real raid boss loop
- [ ] Real world event loop
- [ ] Achievements and titles
- [ ] Broader flavor text/content pass

## Completed Recently

- [x] Closed-alpha playable slice defined
- [x] Reward/inventory/progression sanity pass
- [x] Dungeon loop stabilization
- [x] Combat render/output stabilization
- [x] Multiplayer foundation layer
- [x] Persistent world systems foundation
- [x] Admin/support tooling foundation
- [x] Security/hardening pass
- [x] Conditions, reactions, and opportunity attacks
- [x] Initial combat spell pipeline, saving throws, and typed damage support
- [x] Stronger supported combat spell starter slice
- [x] AI monster control foundation
- [x] Utility spell hooks on canonical dungeon interaction path
- [x] Core action and movement resource consumption
- [x] Player-facing combat output readability
- [x] Locked chest dungeon interaction slice
- [x] Trap gameplay loop
- [x] Magical / identify / attunement item loop
- [x] Added button-driven magical item actions to the inventory viewer
- [x] Reduced command friction for identify/attune/unattune during normal play
- [x] Player-usable crafting and NPC shop loops
- [x] Styled profile and button-driven inventory viewer
- [x] Player-usable direct trade loop with button actions
- [x] Trade proposal wizard for common item-for-gold trades
- [x] Shrine and lore exploration-side consequences on the canonical interact path
- [x] Expanded starter crafting and shop content depth
- [x] Richer button-driven shop and craft browsing flow
- [x] Added `knock`, `detect_magic`, and skill-gated dungeon interactions on the canonical `/interact` path
- [x] Added tool-gated and `identify`-driven magical object interactions on the canonical `/interact` path
- [x] Added rolled dungeon checks for skills, tools, hidden paths, and arcane wards on the canonical `/interact` path
- [x] Added hidden-door movement gating and linked trapped-object content patterns on the canonical dungeon path
- [x] Added room snapshots to canonical dungeon enter/move/interact responses
- [x] Added button-driven dungeon exit/object controls on top of the canonical session move/interact path
- [x] Added state-aware dungeon object action buttons on top of the canonical session interact path
- [x] Added clearer combat action embeds for attack/cast/move/use presentation
- [x] Added combat round and participant HP summaries to canonical combat runtime responses
- [x] Added dedicated combat-state embeds alongside action-result embeds in gateway combat replies
- [x] Added canonical `/combat` read path with refreshable battle-state view
- [x] Added multi-action dungeon object buttons for common room objects
- [x] Tightened combat state readout into a per-participant roster summary

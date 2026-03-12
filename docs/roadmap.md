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
- [~] Magical item data and support foundations
- [ ] Attuned item gameplay loop
- [ ] Growth item gameplay loop
- [ ] Unidentified item discovery/identify loop
- [ ] Inventory screen with richer button UX

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
- [ ] Locked door gameplay loop
- [x] Utility-spell dungeon interactions
- [ ] Rich visual dungeon map layer
- [ ] More non-combat room interactions

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
- [~] Crafting foundation
- [~] Shopkeeping foundations
- [ ] Full player-facing trade UX
- [ ] Crafting gameplay loop
- [ ] Shopkeeping gameplay loop
- [ ] Broader economy balancing

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
- [ ] Streamlined button-first UI across core gameplay
- [ ] Remove redundant commands and overlaps
- [ ] Intuitive char sheet screen
- [ ] Intuitive inventory screen
- [ ] Strong flavor text layer across systems
- [ ] Isekai identity/presentation layer

## Priority Queue

### Now

- [ ] Build magical item loop: magical, unidentified, attuned

### Next

- [ ] Build char sheet and inventory screen upgrades
- [ ] Expand crafting/shopkeeping into a player-usable loop
- [ ] Improve trade UX

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

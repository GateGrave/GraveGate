# GateGrave Implementation Status

Last updated: 2026-03-13

This is the working roadmap for the actual repo state.

Rules for this file:
- `[x]` means implemented and verified enough to build on
- `[~]` means partially implemented or scaffolded
- `[ ]` means not implemented in a player-ready way
- Keep this file aligned to canonical paths only
- Do not mark scaffold-only systems as done
- Repo-wide operating rules live in `docs/CONSTITUTION.md`

## Current Position

Current supported slice:
- Character creation
- Profile and inventory readback
- Dungeon session entry and movement
- Dungeon map attachments with party/object/enemy/encounter marker support
- Combat handoff and return
- Core combat actions
- Combat map attachments with movement, attack, and supported-spell preview support
- Reward grant and persistence
- Session leave and cleanup

Current immediate build direction:
1. Improve player-facing combat and dungeon map UX
2. Deepen combat rules through central hooks only
3. Expand dungeon interaction depth and content consistency
4. Improve progression, item, and economy UX to match backend capability
5. Expand MMO/social/world systems only after the core loop is stable

## Current Working Focus

Main-branch focus right now:
- Combat and dungeon map usability
- Combat depth through canonical combat rules
- Dungeon session UX and content readability
- Keeping shared `main` stable and integration-safe

Current goals in progress:
1. Keep combat moving toward a strong supported 5e slice without creating one-off rule paths
2. Reuse central hooks instead of adding ad hoc logic:
   - conditions
   - saving throws
   - typed damage
   - concentration
   - action economy
3. Keep map rendering, selection, and preview logic in `apps/map-system` while leaving authoritative mutation outside it
4. Keep magic items on canonical world -> character -> combat paths
5. Keep button-first UX where it removes real player friction

Most recent completed chunk:
- Map-system and combat-depth work were integrated onto `main`
  - combat and dungeon map flows now exist on the shared branch
  - clean control-map and mask workflow is now the intended authoring path
  - opportunity-attack range regression caused by the new attack range guard was fixed on `main`

Next recommended resume point:
1. Improve combat-map and dungeon-map live UX
2. Add better map authoring/debug validation for masks, markers, and edge walls
3. Continue combat completion through central combat hooks
4. Keep dungeon interaction depth growing from content/session metadata instead of gateway logic

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
- [~] Feats system
  - Canonical `/feat` list/take path is in
  - Profile now surfaces feat summaries and feat-slot availability
  - Passive-safe feats currently applied live: `alert`, `tough`, `mobile`
  - `alert` now feeds combat initiative through the canonical character -> combat participant adapter
  - `mobile` now grants target-specific opportunity-attack protection after melee attacks on the canonical combat path
  - `resilient` now applies the chosen ability increase and saving throw proficiency through the canonical character/progression path
  - Spellcasting prerequisite validation is in for `war_caster`
  - `war_caster` now applies advantage on concentration saves through the canonical combat concentration path
  - `war_caster` now has backend support to replace an opportunity attack with a valid single-target spell on the canonical OA path; player-facing choice UI is still pending
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
- [x] Passive magical item effect pipeline
  - Equipped magical items now resolve passive-safe derived effects through the canonical character/inventory path
  - Attunement-sensitive bonuses now require both equip + attune state
  - Derived item effects now feed profile readback and combat participant conversion
  - Current passive-safe magical item slice now covers AC, saves, attack bonus, speed, resistances, spell attack bonus, and spell save DC bonus
  - Passive magical item warding now supports flat damage reduction hooks, including typed reduction filters
  - Equipped magical items can now contribute melee-reactive damage effects through the canonical combat attack path
  - Equipped magical weapons can now contribute typed on-hit bonus damage through the canonical combat attack path
- [x] Active consumable item effect pipeline
  - World item use now applies healing and temporary hit points through the canonical character/inventory path
  - Combat item use now grants temporary hit points through the canonical combat item-use path
  - Supported magical consumables can now also apply combat conditions through the same combat item-use path
  - Charged magical item activations now work on the canonical world/combat item-use paths without consuming the equipment entry
  - Charged magical items can now apply ongoing combat boons such as `heroism` through the canonical combat item-use path
  - Combat/world item use now supports canonical cleansing of supported conditions and status flags
  - Supported magical cleansing items can now remove `poisoned` and apply temporary poison protection through the same combat item-use path
  - Charged magical items can now apply canonical save-bonus combat conditions through the same item-use path
- [ ] Growth item gameplay loop
- [x] Unidentified item discovery/identify loop
- [~] Inventory screen with richer button UX
  - Magical tab now exposes button-driven identify/attune/unattune/use actions
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
- [x] Typed damage support for spell and standard attack paths
- [x] Standard attack damage now respects magical defensive hooks
  - passive resistances, vulnerabilities, immunities, and flat warding from magical items now affect ordinary weapon attacks
  - temporary damage protections from active combat conditions now affect the same typed-damage pipeline
- [x] Standard attack range/reach validation
  - ordinary attacks now fail cleanly when the target is outside resolved weapon/default range
  - current canonical slice uses equipped weapon metadata where available and otherwise falls back to 5-foot melee reach
- [x] Initial spell pipeline
- [x] Multi-target spell support on canonical combat path
  - `up_to_three_allies` and `up_to_three_enemies` support is now live for the current non-damaging support/control slice
  - `bless`, `bane`, `heroism`, and `aid` style multi-target effects can now resolve across up to three targets through the canonical cast flow
  - `magic_missile` split-target behavior is now live on the canonical combat path using per-projectile force damage
- [x] Core action and movement resource consumption
- [x] Spellcasting starter slice
- [x] Concentration support foundations
- [x] Bless/Bane style combat support
  - `bless` and `bane` now apply reusable attack/save d4 modifiers on the canonical combat path
  - Concentration saves now also respect those modifiers
- [x] Support and control spell slice expansion
  - `false_life` now applies temporary hit points through the canonical vitality spell path
  - `armor_of_agathys` now applies temporary hit points and retaliatory cold damage through the canonical vitality + attack paths
  - `barkskin` now applies a minimum AC defense buff through the canonical defense spell path
  - `healing_word` now works as a bonus-action healing spell on the canonical combat path and adds spellcasting modifier from content-backed healing metadata
  - `hold_person` now applies a control condition cleanly without breaking AI turn progression
  - `lesser_restoration` now removes supported conditions through the canonical spell path
  - `entangle` now applies `restrained` through the canonical save-and-condition spell path
  - `heroism` now applies an ongoing start-of-turn temporary hit point boon through the canonical concentration + condition path
  - `protection_from_poison` now removes `poisoned` and applies temporary poison resistance through the canonical spell + condition path
  - `resistance` now applies a concentration-backed saving throw bonus condition through the canonical support spell path
  - `shield` now has canonical reaction-mode backend support and applies a temporary dynamic AC defense condition on the combat path
  - `blade_ward` now applies temporary weapon damage resistance through the canonical condition + typed damage path
  - `sanctuary` now applies canonical hostile-targeting protection against attacks and harmful spells
  - `blindness/deafness` now applies `blinded` through the canonical save-and-condition spell path
- [x] Persistent advantage control condition support
  - `faerie_fire` style advantage state is now supported as a concentration-linked condition on the canonical spell path
  - Advantage persists until the condition ends instead of being consumed like `guiding_bolt`
- [x] Central condition enforcement is deeper
  - `restrained` now blocks movement on the canonical move path
  - `poisoned` now imposes disadvantage on attack rolls on the canonical attack path
  - `restrained` now grants attack advantage against the target and imposes disadvantage on Dexterity saves
  - `paralyzed` now blocks actions, movement, and reactions and forces Strength/Dexterity save failure
  - `grappled` movement lock support is in place for future non-map hooks
  - active combat conditions can now contribute dynamic save bonuses/penalties and temporary AC bonuses through central combat rule hooks
  - active combat conditions can now contribute targeting protection gates and temporary typed defensive hooks like weapon-damage resistance
  - spell attack rolls now respect the same attack advantage/disadvantage hooks as ordinary attacks
  - `prone` now affects ordinary attack rolls in the supported slice: adjacent melee attacks gain advantage and ranged attacks suffer disadvantage against prone targets
  - repeating end-of-turn condition saves now exist on the canonical turn lifecycle, which supports spells like `blindness/deafness`
- [x] AI monster control foundation
- [ ] Full D&D spell engine
- [~] Utility spell gameplay integration
  - Dungeon interaction path now supports `light`, `thaumaturgy`, `knock`, `detect_magic`, and `identify`
- [~] SRD spell content coverage for future map/template work
  - area-template spell content now includes representative SRD shapes for cone, cube, line, sphere, aura, and cylinder-style effects
  - current scaffold entries now include `burning_hands`, `thunderwave`, `fog_cloud`, `shatter`, `fireball`, `lightning_bolt`, and `spirit_guardians`
  - this content is intended to support later map-side targeting/template work without making map state authoritative
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
- [~] Cleaner combat screen UX in Discord
  - live map attachments, preview flows, and PNG output exist
  - selected-state readability and richer summary polish are still pending
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
- [~] Rich visual dungeon map layer
  - dungeon map attachments, party token, typed markers, and mask-driven markers are in
  - live readability, larger export tuning, and richer authoring/debug support are still pending
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
- [x] Added canonical combat concentration tracking and break handling for supported spell and damage flows
- [x] Added starter feat framework with canonical `/feat` list/take flow and profile readback
- [x] Added feat-slot progression visibility and feat-derived combat adapter state for passive-safe feats
- [x] Added passive magical-item bonuses to effective profile/combat state
- [x] Added `bless`/`bane` style support-spell handling to the supported combat slice
- [x] Added caster-focus magical items and passive spellcasting bonuses
- [x] Added `faerie_fire` style persistent advantage support to the supported combat slice
- [x] Routed normal weapon attacks through the typed-damage pipeline so resistances and vulnerabilities now matter outside the spell path
- [x] Added temporary hit point handling to the supported damage and item-use slices
- [x] Added canonical world-item healing/temp-HP resolution with inventory parity coverage

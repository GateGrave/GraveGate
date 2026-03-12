# Map System

An isolated map module for GateGrave that keeps map state separate from dungeon and combat logic.

## Goals

- Store canonical map definitions and live map instances
- Track token positions with coordinate-based movement
- Compute legal movement and attack or spell ranges
- Render map state into an image-friendly artifact without coupling to Discord or gameplay systems
- Provide an asset library foundation for reusable tiles, props, and token art

## Current First-Pass Scope

- Canonical map-state schema validation
- Square-grid coordinate helpers
- Reachable-tile calculation
- Physical-range, spell-range, and spell-area overlay calculation
- SVG renderer that can layer overlays and tokens on top of a base map image
- Asset-library manifest builder for future procedural generation

## Integration Boundary

The map system is intentionally being built as a map interaction engine, not as the authoritative gameplay mutation engine.

That means:

- it should decide what is selectable, targetable, reachable, and previewable on the map
- it should build render outputs and Discord interaction payloads
- it should not become the final owner of combat resolution, spell resolution, persistence, or turn progression

The explicit handoff contract lives in:

- `apps/map-system/src/contracts/map-integration.contract.js`

## Current Rules

- `1 tile = 5 feet`
- Default movement speed uses `30 feet`
- Diagonal movement is supported
- Diagonal movement does not allow corner-cutting through blocked terrain
- Physical attack overlays only highlight valid targets
- Spell range overlays are separate from spell area overlays
- Terrain can be authored with `terrain_zones` so you do not need to hand-enter every blocked tile
- Only one actor may occupy a tile; overlapping token positions are treated as invalid map state
- The movement engine currently supports two diagonal modes:
  - `5e`: each diagonal tile costs 5 feet
  - `alternating`: every second diagonal step costs 10 feet

Known terrain types such as `river`, `wall`, and `pit` now default to impassable movement unless explicitly overridden.

The diagonal rule is configurable in code so we can match your final combat rules exactly without rewriting the renderer or map state.

## Terrain Zones

Use `terrain_zones` for coarse obstacle authoring such as tree clusters, walls, or brush patches.

Supported zone shapes right now:

- `rectangle`
- `circle`

Zones expand into impassable and line-of-sight blocking terrain at runtime, which is much faster than entering every coordinate manually.

## Terrain Intelligence

The map system now has a central terrain catalog at:

- `apps/map-system/data/terrain/terrain-catalog.json`
- `apps/map-system/data/terrain/terrain-mask-palettes.json`

The terrain stamping presets live at:

- `apps/map-system/data/terrain/terrain-stamp-presets.json`

That means you can author zones and future procedural assets semantically instead of repeating low-level flags on every map. For example, terrain types such as:

- `river`
- `wall`
- `pit`
- `boulder`
- `mountain`
- `tree`

will automatically inherit movement and sight rules from the catalog unless you explicitly override them.

This also feeds into the asset library so tile assets can infer terrain behavior from names and file paths, which is the foundation for future procedural generation without hand-programming every obstacle.

## MS Paint Terrain Mask Workflow

This is now the recommended workflow for reliable combat-map terrain.

The idea is:

1. Make or export the combat map image you want to show players.
2. Make a second image of the exact same pixel size in MS Paint.
3. Paint whole tiles in flat solid colors to mark terrain.
4. Run the terrain-mask CLI once to convert that mask into authored terrain data.
5. Render and play from the generated profile instead of trying to infer terrain from the art.

Important authoring rules:

- keep the mask at the exact same pixel dimensions as the map
- paint whole tiles, not just outlines
- use flat colors only
- do not use gradients, shadows, or soft brushes
- if the map has visible grid lines, the mask can too, but the tile centers should stay solid

Recommended mask file location:

- `apps/map-system/assets/masks/`

Add the mask to your base map JSON like this:

```json
{
  "asset": {
    "base_image_path": "apps/map-system/assets/base-maps/my-map.png",
    "terrain_mask_path": "apps/map-system/assets/masks/my-map.mask.png",
    "terrain_mask_palette_id": "mspaint_basic"
  }
}
```

Current `mspaint_basic` palette:

- `#FFFFFF` = open ground
- `#000000` = wall
- `#FF0000` = impassable terrain
- `#0000FF` = water / impassable
- `#00FF00` = difficult terrain
- `#FFFF00` = tree / blocks sight
- `#FF00FF` = pit / impassable
- `#00FFFF` = cliff / blocks sight

Process the mask into a profile:

```powershell
node scripts/map-system-cli.js apply-terrain-mask --map=apps/map-system/data/maps/my-map.base-map.json --profile=apps/map-system/data/profiles/my-map.combat-profile.json
```

Inspect what the mask generated without editing files:

```powershell
node scripts/map-system-cli.js inspect-terrain-mask --map=apps/map-system/data/maps/my-map.base-map.json --profile=apps/map-system/data/profiles/my-map.combat-profile.json
```

The terrain-mask CLI preserves manual profile terrain entries and replaces only terrain entries that were previously generated from the mask.

When rendering previews, you can layer multiple profiles by passing a comma-separated `--profile=` list. This is useful when you want to combine authored terrain with a separate preview/token profile.

Example:

```powershell
node apps/map-system/src/cli/render-map.js --map=apps/map-system/data/maps/map-12x10.base-map.json --profile=apps/map-system/data/profiles/map-12x10.combat-profile.json,apps/map-system/data/profiles/map-12x10.movement-preview.json --output=apps/map-system/output/map-12x10.movement-preview.svg
```

## Terrain Stamping Workflow

Use the terrain stamping CLI to add semantic obstacle zones to a combat profile without hand-editing JSON:

```powershell
node apps/map-system/src/cli/stamp-terrain.js --list-presets=true
node apps/map-system/src/cli/stamp-terrain.js --profile=apps/map-system/data/profiles/forest-road.combat-profile.json --preset=tree_cluster --x=8 --y=13 --radius=1 --zone-id=west-mid-tree-cluster
```

This workflow is intended to be the default way you author things like:

- rivers
- walls
- pits
- cliffs
- boulders
- mountains
- tree clusters

## First Real Combat Profile

The first authored combat profile for the forest road map now lives at:

- `apps/map-system/data/profiles/forest-road.combat-profile.json`

That file is meant to be the starting point for real combat-map authoring. The older annotated demo profile can still exist for renderer demos, but this combat profile is the cleaner authored path going forward.

## Why SVG First

This repository does not currently include a Node PNG rendering dependency. The first isolated module therefore renders SVG snapshots that reference a base PNG file path. That keeps the map logic stable and handoff-safe. A later raster adapter can convert the SVG to PNG for Discord delivery without changing map rules.

## Suggested Asset Placement

- Base maps: `apps/map-system/assets/base-maps/`
- Tile pieces for procedural generation: `apps/map-system/assets/tiles/`
- Token art: `apps/map-system/assets/tokens/`
- Reusable overlay art: `apps/map-system/assets/overlays/`

## Demo Map

The included demo definition assumes your forest-road map is:

- `width = 22`
- `height = 28`
- `tile_size = 70`
- `pixel_width = 1540`
- `pixel_height = 1960`

Place your PNG at:

- `apps/map-system/assets/base-maps/forest-road-22x28.png`

## Render Demo

```powershell
node apps/map-system/src/cli/render-map.js --map=apps/map-system/data/maps/forest-road.base-map.json --profile=apps/map-system/data/profiles/forest-road.obstacles-and-demo.json --output=apps/map-system/output/forest-road.demo.svg
```

## Authoring Pattern

- `data/maps/*.base-map.json` stores the reusable base map definition
- `data/profiles/*.json` stores obstacle annotations, tokens, and scenario overlays

That split lets you reuse one map image for many combats without duplicating the whole map file every time.

## Player Tokens

Player tokens now support:

- default player styling
- optional token image assets
- border colors
- badge text for party slot, status, or numbering
- gold default portrait rims for player image tokens

Suggested player token asset location:

- `apps/map-system/assets/tokens/players/`

The token catalog for player choice lives at:

- `apps/map-system/data/tokens/player-token-catalog.json`

Enemy tokens now have the same render path, plus starter enemy art and a parallel enemy catalog at:

- `apps/map-system/assets/tokens/enemies/`
- `apps/map-system/data/tokens/enemy-token-catalog.json`

## Token Cleanup

The map system can now clean token portraits automatically by sampling the corner background color and removing it.

Example:

```powershell
node apps/map-system/src/cli/process-token.js --input=apps/map-system/assets/tokens/players/male-tiefling-03.png --output=apps/map-system/assets/tokens/players/processed/male-tiefling-03.cleaned.png
```

Batch process all player tokens and sync the catalog:

```powershell
node apps/map-system/src/cli/process-player-token-batch.js
```

Batch process all enemy tokens and sync the enemy catalog:

```powershell
node apps/map-system/src/cli/process-enemy-token-batch.js
```

## Interaction Foundation

The module now includes:

- a command parser for inputs like `move 12,5`, `attack goblin-1`, and `cast firebolt at 14,7`
- Discord button custom-id builders and parsers
- message payload builders designed for edit-in-place map updates instead of channel spam

The intention is:

1. A player clicks `Move` or types `move 12,5`
2. The runtime validates the action
3. The map is re-rendered
4. The same Discord message is edited with the new image and updated buttons

## Token Selection

The map system now includes a token-selection flow foundation:

- list available player token choices from the catalog
- build Discord button payloads for token choice messages
- apply a selected `token_choice_id` to a player token

This lets us support a future interaction flow like:

1. Player clicks `Token`
2. Bot edits the message to show token choices
3. Player clicks a token option
4. Bot applies the selected token and rerenders the map in the same message

## Spell Targeting Foundation

The map system now includes spell-targeting categories and validators for:

- `self`
- `single target`
- `single or split target`
- `cone`
- `cube`
- `sphere`
- `line`
- `utility`

It also derives target affinity rules for common cases such as:

- self-only spells
- enemy-targeted attack spells
- ally-targeted healing spells

This is the map-side targeting foundation, not the full spell-resolution engine. It gives us a clean way to show legal spell targets and area-of-effect previews on the map.

The current preview layer now generates real tile footprints for:

- `self`
- `cone`
- `cube`
- `sphere`
- `line`

Targeted area spells can also accept an explicit target coordinate so a typed command such as `cast shatter at 12,5` can preview the actual affected tiles on the map.

## Spell Interaction Mode

The map system now also includes a spell interaction flow foundation:

- list the actor's known spells
- choose a spell
- build a preview state with valid targets and area metadata
- validate confirmation-ready spell selections
- build Discord payloads for spell selection and spell preview modes

The spell preview flow now supports target selection before handoff:

- token-target spells can expose valid target buttons
- area spells can accept a target tile by coordinate
- preview state tracks the selected token or tile
- the confirmed `cast_spell` contract now carries the exact confirmed area footprint tiles
- direct `cast ... at ...` inputs now route through the same validation path as interactive target selection
- split-target spells can accumulate repeated target selections up to their required count before confirm

Large Discord button sets are now paged inside the map system for:

- token selection
- spell lists
- attack target lists
- spell target lists

## Unified Interaction Controller

The map system now includes a unified map-side interaction controller for:

- `Move`
- `Attack`
- `Spell`
- `Token`
- `Back`
- confirm-ready interaction states

This controller is intentionally limited to map-side selection, preview, and normalized intent output. It does not authoritatively mutate combat state.

Attack interaction now follows the same preview-first pattern as spells:

- `Attack` enters target preview mode
- valid attack targets can be selected by button or typed command
- `Confirm Attack` emits the normalized handoff contract
- the map system still does not resolve damage or mutate authoritative combat state
- selected attack and spell targets now get explicit on-map selection markers
- preview responses now include `preview_map` data so a later integration layer can rerender the exact preview state

Typed move commands now route through the same legal movement rules as the movement overlay, so text input cannot bypass blocked terrain, occupied tiles, or diagonal corner-cutting.

The shared movement-speed reader now supports both player and enemy actors. It can read common speed fields such as:

- `movement_speed_feet`
- `speed.walk_feet`
- `movement.remaining_feet`
- `remaining_movement_feet`
- movement modifiers on `movement.modifier_feet` / `movement_modifier_feet`

## Weapon Profiles

Attack previews now support shared weapon profiles for melee, reach, and ranged attacks.

The built-in weapon catalog lives at:

- `apps/map-system/data/attacks/weapon-profiles.json`

This is where default rules such as:

- melee reach (`5 ft` vs `10 ft`)
- ranged normal range
- ranged long range

are defined for map-side targeting and preview.

## Message-State Rendering

Discord message payload builders now render clearer state text so the same edited message can show:

- whose turn it is
- which mode is active
- which weapon or spell is being previewed
- which target is currently selected

## Normalized Action Contracts

The map system now emits explicit handoff-ready action contracts for later integration:

- `move_to_coordinate`
- `attack_target_token`
- `attack_target_coordinate`
- `cast_spell`
- `select_token`

These contracts are defined in:

- `apps/map-system/src/contracts/map-action.contract.js`

They are meant to be consumed by later runtime/controller integration layers and turned into canonical events without requiring the map system to mutate authoritative game state directly.

## Run Tests

```powershell
node apps/map-system/src/testing/mapSystem.test.js
```

Or use the shared root dispatcher:

```powershell
node scripts/map-system-cli.js test
```

## Movement Speed Preview

To render a comparison snapshot showing one actor at `30 feet` of movement and one actor at `15 feet`:

```powershell
node apps/map-system/src/cli/render-movement-speed-preview.js --map=apps/map-system/data/maps/forest-road.base-map.json --output=apps/map-system/output/forest-road.movement-speed-preview.svg
```

The root package also exposes matching convenience scripts:

- `npm run map:test`
- `npm run map:apply-terrain-mask`
- `npm run map:inspect-terrain-mask`
- `npm run map:render`
- `npm run map:movement-preview`
- `npm run map:process-player-tokens`
- `npm run map:process-enemy-tokens`
- `npm run map:stamp-terrain`

# GateGrave Map Roadmap

Date: 2026-03-18

Purpose:
- This roadmap is for the map lane of the project.
- It is primarily for Euripides and whichever Codex session is currently helping with map work.
- Future Codex sessions should treat earlier map notes as historical context, not as proof they are the same continuing agent/session.

Scope:
- `apps/map-system`
- combat-map rendering and interaction support
- dungeon-map rendering and interaction support
- map authoring workflow, masks, markers, assets, and debug tooling

## Map Team Principles

- One shared `apps/map-system`
- Separate combat and dungeon inputs, profiles, and outputs
- Combat and dungeon are separate instance types
- The map system owns rendering, selection, preview, and map-side contracts
- The map system does not own authoritative combat/session mutation

## Current State

### Combat maps
- Tile-grid rendering is working
- Movement, attack targeting, and supported-spell previews are working
- Edge walls, cover, terrain masks, PNG output, and event adapters are in
- Live gateway dry-run flow exists
- Button-driven preview/confirm flow is in for move, attack, and supported spells
- Battle-window + map flow is working, but action-result presentation is still inconsistent across some combat actions
- Authored validation/control profiles now exist for the clean 12x10 combat map

### Dungeon maps
- Dungeon map attachments are working
- Party is represented as one group token
- Dungeon marker masks support:
  - enemy markers
  - party marker
  - traps
  - exits
- Dungeon map move preview/back contracts are in
- Dungeon move dispatch is adapted into canonical session events
- Dungeon room summaries now include player-facing:
  - routes
  - interactables
  - threats
  - encounter/readability support text
- Dungeon debug toggles now exist for:
  - markers
  - walls
  - terrain
  - coords
- Exit overlays and route summaries now stay aligned when exit position comes from compiled/map-side data
- Authored validation/control profiles now exist for the clean 12x10 dungeon map

## Immediate Map-Team Priorities

### 1. Dungeon-map polish
- Tune dungeon render scale for Discord readability
- Keep exit, object, encounter, and breadcrumb/path cues easy to parse on larger maps
- Continue polishing room-summary wording without moving gameplay authority into gateway

### 2. Map authoring/debug workflow
- Keep the new debug overlays trustworthy and easy to use:
  - mask interpretation
  - edge walls
  - terrain blockers
  - dungeon markers
- Expand the new validation/control profiles so a new map can be checked before content use

### 3. Combat-map UX polish
- Improve selected target markers
- Improve active mode clarity
- Improve confirm/cancel/back experience
- Improve spell/action result readability around the map
- Keep the battle-window/text-summary split coherent across all supported combat action types

### 4. Dungeon-map authoring validation
- Add or refine control maps for:
  - exits
  - markers
  - edge walls
  - terrain semantics
- Make regressions easier to catch before prettier maps are debugged

## Near-Term Build Order

1. Dungeon render/readability polish
2. Map validation/debug workflow polish
3. Combat-map selected-state and summary polish
4. Dungeon marker polish and authored validation maps
5. Additional authored test maps using the clean-mask workflow

## Rules For New Maps

- Use clean mathematically aligned maps for authoritative testing
- Use masks as source of gameplay truth
- Use flat colors only in masks
- Use combat/dungeon separated folders
- Validate on control maps first before debugging prettier maps

## Definition Of Success For This Map Lane

The map lane is in a good state when:
- a new combat map can be authored and validated quickly
- a new dungeon map can be authored and validated quickly
- Discord renders are readable without guesswork
- movement and targeting previews feel dependable
- content teams can place terrain, markers, and tokens without hand-programming every tile

# GateGrave Map Roadmap

Date: 2026-03-13

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

## Immediate Map-Team Priorities

### 1. Dungeon-map readability
- Tune dungeon render scale for Discord readability
- Make sure markers remain easy to parse on larger maps
- Improve room summary text that accompanies dungeon renders

### 2. Map authoring/debug workflow
- Add more explicit debug overlays for:
  - mask interpretation
  - edge walls
  - terrain blockers
  - dungeon markers
- Make it easy to validate a new map before using it in content

### 3. Combat-map UX polish
- Improve selected target markers
- Improve active mode clarity
- Improve confirm/cancel/back experience
- Improve spell/action result readability around the map

### 4. Dungeon-map UX polish
- Improve exit and object marker readability
- Improve encounter-trigger readability
- Improve breadcrumb/path visibility where useful

## Near-Term Build Order

1. Dungeon render/readability tuning
2. Map validation/debug overlays
3. Combat-map selected-state and summary polish
4. Dungeon marker polish and authoring validation
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

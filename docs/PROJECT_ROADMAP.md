# GateGrave Project Roadmap

Date: 2026-03-13

Purpose:
- This is the high-level strategic roadmap for the whole project.
- It complements `docs/IMPLEMENTATION_STATUS.md`, which is the current implementation tracker.

## Honest Current State

GateGrave is no longer a prototype scaffold. It now has a real closed-alpha backbone:
- event-driven backend flow
- world/session/combat state separation
- profile, inventory, dungeon, combat, shop, craft, and trade slices
- meaningful test coverage on core flows
- map-system foundations for combat and dungeon rendering

What it is not yet:
- a polished closed-alpha player experience
- full 5e combat/spell parity
- a content-complete MMO/social/world game

## Project Priorities

### 1. Stability and hygiene
- Keep `main` healthy and reviewable.
- Resolve merge artifacts quickly.
- Keep canonical docs current.
- Maintain lightweight Git discipline:
  - branch from `main`
  - PR into `main`
  - use `@codex review` in PRs

### 2. Core player loop
- Finish the usable gameplay loop first:
  - character creation
  - dungeon progression
  - combat
  - rewards
  - inventory follow-through
- Improve player-facing readability across all of those steps.

### 3. Combat depth
- Continue expanding combat through central hooks only:
  - conditions
  - saves
  - typed damage
  - concentration
  - reactions
  - action economy
- Expand the supported spell slice without creating side paths.
- Improve reaction UX and combat readback.

### 4. Dungeon depth
- Expand content-driven room interactions.
- Improve encounter handoff, return, and progression reliability.
- Standardize room/object metadata conventions so authors can build content safely.

### 5. Map usability
- Make combat and dungeon maps genuinely usable in Discord.
- Improve rendering clarity, message flow, selection flow, and authoring/debug workflow.
- Keep maps presentation/preview/selection only, not a second gameplay authority.

### 6. Character, progression, and items
- Finish the richer character sheet/readback layer.
- Continue feat and progression depth where central hooks exist.
- Keep magical item support canonical and author-friendly.

### 7. Economy and social/world systems
- Improve shop/craft/trade UX and consistency.
- Expand guild, raid, ranking, and world-event systems only after the core loop feels solid.

## Recommended Build Order From Here

1. Repo hygiene and documentation truthfulness
2. Combat-map and dungeon-map UX polish
3. Combat rules completion through central systems
4. Dungeon interaction and content depth
5. Player-facing UX polish for profile/inventory/combat/dungeon
6. Progression and item depth
7. Economy and broader MMO/social systems

## Definition Of Success For The Next Stage

The next meaningful milestone is not "more systems exist."

It is:
- the current supported slice feels coherent to a tester
- map flows work cleanly in Discord
- combat and dungeon interactions are readable and dependable
- content authors can add rooms, masks, markers, and encounters without fighting the engine

# GateGrave Bot System

A Discord-based RPG engine for a roleplay server inspired by D&D 5e with gestalt leveling.

## Architecture Rules

- Event-driven and modular
- All gameplay actions are JSON events
- Systems never call each other directly
- All communication goes through the event queue
- Database is the source of truth
- State is divided into World State, Session State, and Combat State
- Gateway contains no gameplay logic
- Combat instances must always be isolated

## Core Services

- Discord Gateway
- Event Queue
- Event Router
- World System
- Session System
- Combat System
- Map System

## Development Phases

- Phase 1: Gateway, Event Queue, Event Router, Database schema
- Phase 2: Character and Inventory systems
- Phase 3: Combat engine
- Phase 4: Dungeon session system
- Phase 5: Economy system

## Current Canonical Docs

- Documentation index:
  - `docs/README.md`
- Repo-wide constitution:
  - `docs/CONSTITUTION.md`
- Working implementation tracker:
  - `docs/IMPLEMENTATION_STATUS.md`
- Project-wide strategic roadmap:
  - `docs/PROJECT_ROADMAP.md`
- Map roadmap:
  - `docs/MAP_ROADMAP.md`
- Map authoring specification:
  - `docs/MAP_AUTHORING.md`
- Closed-alpha slice:
  - `docs/closed-alpha-readiness.md`
- Internal smoke checklist:
  - `docs/internal-alpha-smoke-checklist.md`

## Historical Notes

Dated status and handoff files in `docs/history/` should be treated as historical snapshots unless they explicitly say they are the current canonical source of truth.

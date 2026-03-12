\# GateGrave Bot System



A Discord-based RPG engine for a roleplay server inspired by D\&D 5e with gestalt leveling.



\## Architecture Rules

\- Event-driven and modular

\- All gameplay actions are JSON events

\- Systems never call each other directly

\- All communication goes through the event queue

\- Database is the source of truth

\- State is divided into World State, Session State, and Combat State

\- Gateway contains no gameplay logic

\- Combat instances must always be isolated



\## Core Services

\- Discord Gateway

\- Event Queue

\- Event Router

\- World System

\- Session System

\- Combat System



\## Development Phases

\- Phase 1: Gateway, Event Queue, Event Router, Database schema

\- Phase 2: Character and Inventory systems

\- Phase 3: Combat Engine

\- Phase 4: Dungeon Session system

\- Phase 5: Economy system

\## Closed Alpha

\- Supported closed-alpha slice: `docs/closed-alpha-readiness.md`

\- Internal smoke checklist: `docs/internal-alpha-smoke-checklist.md`

\- Fast internal smoke: `npm run alpha:smoke:internal`

\- Full closed-alpha gate: `npm run alpha:gate`


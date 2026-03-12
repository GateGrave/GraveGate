\# GateGrave Bot System



Language: JavaScript



Architecture rules:

\- Event driven

\- Systems must not call each other directly

\- Gateway must not contain gameplay logic

\- Database is source of truth

\- Combat instances must be isolated



Build in phases:

Phase 1: Gateway, Queue, Router, Database

Phase 2: Character + Inventory

Phase 3: Combat

Phase 4: Dungeon Sessions

Phase 5: Economy


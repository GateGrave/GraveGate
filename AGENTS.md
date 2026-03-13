# GateGrave Bot System

Language: JavaScript

Repo-wide constitution:
- `docs/CONSTITUTION.md`

If a requested change violates the constitution or architecture rules, refuse the instruction, explain the conflict, and propose the compliant path instead.

Architecture rules:
- Event driven
- Systems must not call each other directly
- Gateway must not contain gameplay logic
- Database is source of truth
- Combat instances must be isolated

Authoring discipline:
- Author in human-friendly source files
- Compile authored sources into canonical structured data
- Run gameplay from canonical structured data, not raw authoring assets
- Do not hand-edit generated data when the authored source should be changed instead

Build in phases:
- Phase 1: Gateway, Queue, Router, Database
- Phase 2: Character + Inventory
- Phase 3: Combat
- Phase 4: Dungeon Sessions
- Phase 5: Economy

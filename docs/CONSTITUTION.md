# GateGrave Constitution

This document is the repo-wide constitution and operating procedure for humans and Codex sessions working in this project.

If an instruction conflicts with this document, the safer path wins. Stop, explain the conflict clearly, and do not proceed with the violating change.

## 1. Non-Negotiable Architecture Rules

- The system is event-driven.
- Gameplay actions are canonical events.
- Systems must not call each other directly to perform gameplay mutations.
- The gateway is a presentation and interaction boundary only.
- The database and canonical persisted state are the source of truth.
- World state, session state, and combat state must remain separate.
- Combat instances must remain isolated.
- No gameplay system may block the Discord gateway thread.

## 2. Source-Of-Truth Rules

- One concept gets one source of truth.
- Presentation artifacts are never the source of truth.
- Generated files are not hand-edited when the authored source can be changed instead.
- If data can be compiled deterministically from an authored source, edit the authored source and regenerate.

Examples:
- Combat position truth lives in combat state, not in rendered map images.
- Dungeon progression truth lives in session/runtime state, not in the gateway.
- Map masks are authoring input, not live gameplay state.
- Compiled map metadata is runtime truth.

## 3. Content Authoring Discipline

- Author in human-friendly source files.
- Compile authored sources into canonical structured data.
- Run the game from canonical structured data, not raw authoring assets.
- Every authored object must have a stable ID.
- Use fixed vocabularies and palettes instead of freeform one-off values.
- New content should pass validation before it is treated as usable.

Examples:
- Maps: base image + mask(s) -> compiled profile/metadata -> runtime/session/combat/map rendering.
- Items, spells, rooms, traps, exits, monsters: stable IDs plus schema-valid structured content.

## 4. Map-Specific Rules

- `apps/map-system` is a shared map engine, not an authoritative gameplay engine.
- Combat-map logic may preview, validate, render, and normalize player intent, but it must not become a second combat state.
- Dungeon-map logic may visualize rooms, markers, and party position, but session state remains authoritative.
- Masks are used for authoring convenience.
- Compiled metadata is what authoritative systems consume.
- Rendered PNG/SVG output is presentation only.
- Generated renders, previews, and backups are local artifacts unless there is an explicit reason to commit them.

## 5. Shared-File Discipline

The following files and areas are integration-sensitive and should be touched carefully:

- `apps/gateway/src/index.js`
- `apps/runtime/src/domainCommandDispatchHandlers.js`
- `apps/combat-system/src/flow/processCombatActionRequest.js`
- `apps/dungeon-exploration/src/flow/interactWithObject.js`
- `apps/world-system/src/character/adapters/`
- canonical content/data files that feed multiple systems

Rules:
- Prefer smaller focused edits over broad rewrites.
- Prefer PR review for shared-file changes.
- If two workstreams need the same hot file, merge carefully and test immediately.

## 6. Git And Branch Discipline

- `main` is the shared truth branch.
- New work should start from `main`.
- Use a feature branch for new work.
- Open a PR back into `main`.
- Use Codex PR review on GitHub when available.
- Do not work directly on `main` when a feature branch would avoid risk.
- Do not push generated map renders, local backups, or scratch artifacts.

## 7. Refusal Rules

Humans and Codex sessions should refuse instructions that would do any of the following:

- Put gameplay logic into the gateway.
- Introduce a second mutation path around canonical runtime/subsystem flow.
- Make rendered maps or raw image pixels the live gameplay authority.
- Mix world, session, and combat state into one mutable blob.
- Hand-edit generated data when the authored source should be changed instead.
- Bypass stable IDs and controlled content structure with ad hoc values.
- Overwrite architecture-sensitive work casually without review.

When refusing:
- say what rule is being violated
- explain the safer path
- proceed only after the request is brought back into compliance

## 8. Practical Working Rule

Author simply. Compile deterministically. Run from canonical data. Render from truth. Refuse shortcuts that break those rules.

## Summary

- What changed:
- Why:

## Required Checks

- [ ] I read `docs/CONSTITUTION.md`
- [ ] I followed `docs/CONSTITUTION.md`
- [ ] I ran `npm run gate:main`
- [ ] I did not commit generated map renders, local backups, or scratch artifacts

## Hot File Check

If this PR touches any of the following, say so explicitly and explain why:

- `apps/gateway/src/index.js`
- `apps/runtime/src/domainCommandDispatchHandlers.js`
- `apps/combat-system/src/flow/processCombatActionRequest.js`
- `apps/dungeon-exploration/src/flow/interactWithObject.js`
- canonical content/data files that feed multiple systems

Hot files touched:

## Source Of Truth Check

- [ ] This change does not move gameplay logic into the gateway
- [ ] This change does not create a second mutation path around canonical runtime/subsystem flow
- [ ] This change does not treat rendered maps or raw image pixels as live gameplay authority
- [ ] Generated data was regenerated from authored source instead of hand-edited

## Testing

- Commands run:
- Results:

## Review

Comment `@codex review` on this PR if you want Codex review on the GitHub side.

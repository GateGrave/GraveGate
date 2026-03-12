"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const {
  LIFE_STATES,
  applyDownedState,
  resolveDeathSave
} = require("../death-downed");

function buildCombat() {
  const registry = new CombatRegistry();
  return registry.createCombat({
    combat_id: "combat-death-demo",
    participants: [
      {
        participant_id: "hero-001",
        current_hp: 0,
        life_state: LIFE_STATES.ALIVE,
        unconscious: false
      }
    ]
  });
}

function runDeathDownedExamples() {
  const combat = buildCombat();
  const downed = applyDownedState(combat, "hero-001");

  const stateAfterDowned = downed.next_state;

  // Force deterministic examples with custom RNG:
  // nat 20 -> rng close to 1
  const nat20 = resolveDeathSave(stateAfterDowned, "hero-001", { rng: () => 0.999 });

  // create a fresh downed state for nat 1 / failure progression demo
  const secondDowned = applyDownedState(buildCombat(), "hero-001");
  const nat1 = resolveDeathSave(secondDowned.next_state, "hero-001", { rng: () => 0.0 });
  const fail2 = resolveDeathSave(nat1.next_state, "hero-001", { rng: () => 0.1 });

  // create fresh state for stabilize via 3 successes
  let successState = applyDownedState(buildCombat(), "hero-001").next_state;
  successState = resolveDeathSave(successState, "hero-001", { rng: () => 0.8 }).next_state;
  successState = resolveDeathSave(successState, "hero-001", { rng: () => 0.8 }).next_state;
  const stabilize = resolveDeathSave(successState, "hero-001", { rng: () => 0.8 });

  return {
    downed_state: downed.next_state.participants[0],
    nat20_result: nat20.next_state.participants[0],
    nat1_then_failure_result: fail2.next_state.participants[0],
    stabilized_result: stabilize.next_state.participants[0]
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runDeathDownedExamples(), null, 2));
}

module.exports = {
  runDeathDownedExamples
};

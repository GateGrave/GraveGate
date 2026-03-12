"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { resolveConcentrationOnDamage, getConcentrationDC } = require("../concentration");

function buildCombatWithConcentration() {
  const registry = new CombatRegistry();

  const combat = registry.createCombat({
    combat_id: "combat-concentration-demo",
    participants: [
      {
        participant_id: "caster-001",
        current_hp: 30,
        constitution_save_modifier: 3,
        concentration: {
          is_concentrating: true,
          source_spell_id: "spell-hold-person",
          linked_effect_ids: ["effect-001", "effect-002"]
        }
      }
    ]
  });

  const seeded = {
    ...combat,
    active_effects: [
      { effect_id: "effect-001", name: "held_target_a" },
      { effect_id: "effect-002", name: "held_target_b" },
      { effect_id: "effect-999", name: "unrelated_effect" }
    ]
  };

  return { registry, combat: seeded };
}

function runConcentrationExamples() {
  const { combat } = buildCombatWithConcentration();

  const passExample = resolveConcentrationOnDamage({
    combat_state: combat,
    participant_id: "caster-001",
    damage_taken: 8,
    // Fixed RNG for example stability.
    rng: () => 0.9
  });

  const failExample = resolveConcentrationOnDamage({
    combat_state: combat,
    participant_id: "caster-001",
    damage_taken: 22,
    rng: () => 0.01
  });

  return {
    dc_example_damage_8: getConcentrationDC(8),
    dc_example_damage_22: getConcentrationDC(22),
    pass_example: passExample,
    fail_example: failExample
  };
}

if (require.main === module) {
  console.log(JSON.stringify(runConcentrationExamples(), null, 2));
}

module.exports = {
  runConcentrationExamples
};

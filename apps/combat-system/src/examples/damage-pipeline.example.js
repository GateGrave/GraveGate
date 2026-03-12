"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { DAMAGE_TYPES, resolveDamagePipeline, applyDamageToCombatState } = require("../damage");

function buildExampleTarget() {
  return {
    participant_id: "enemy-001",
    current_hp: 40,
    vulnerabilities: [DAMAGE_TYPES.FIRE],
    resistances: [DAMAGE_TYPES.COLD, DAMAGE_TYPES.SLASHING],
    immunities: [DAMAGE_TYPES.NECROTIC]
  };
}

function runStandaloneDamageExamples() {
  const target = buildExampleTarget();

  return {
    fire_example: resolveDamagePipeline({
      target,
      damage_type: DAMAGE_TYPES.FIRE,
      damage_formula: "2d6+3"
    }),
    cold_example: resolveDamagePipeline({
      target,
      damage_type: DAMAGE_TYPES.COLD,
      damage_formula: "2d6+3"
    }),
    necrotic_example: resolveDamagePipeline({
      target,
      damage_type: DAMAGE_TYPES.NECROTIC,
      damage_formula: "2d6+3"
    })
  };
}

function runCombatStateDamageExample() {
  const registry = new CombatRegistry();
  const combat = registry.createCombat({
    combat_id: "combat-damage-demo",
    participants: [
      {
        participant_id: "enemy-001",
        current_hp: 40,
        movement_speed: 30,
        movement_remaining: 30,
        vulnerabilities: [DAMAGE_TYPES.FIRE],
        resistances: [DAMAGE_TYPES.COLD],
        immunities: []
      }
    ]
  });

  const { next_state, damage_result } = applyDamageToCombatState({
    combat_state: combat,
    target_participant_id: "enemy-001",
    damage_type: DAMAGE_TYPES.FIRE,
    damage_formula: "2d6+3"
  });

  return {
    hp_before: damage_result.hp_before,
    hp_after: damage_result.hp_after,
    final_damage: damage_result.final_damage,
    updated_participant: next_state.participants[0]
  };
}

if (require.main === module) {
  console.log(
    JSON.stringify(
      {
        standalone: runStandaloneDamageExamples(),
        combat_state: runCombatStateDamageExample()
      },
      null,
      2
    )
  );
}

module.exports = {
  runStandaloneDamageExamples,
  runCombatStateDamageExample
};

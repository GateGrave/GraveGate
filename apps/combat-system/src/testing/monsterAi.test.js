"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { performAttackAction } = require("../actions/attackAction");
const { resolveMonsterAiTurn, isAiControlledParticipant } = require("../ai/monsterAi");
const { progressCombatAfterResolvedTurn, progressCombatFromCurrentTurn } = require("../flow/progressCombatState");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createCombat(options) {
  const cfg = options || {};
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: cfg.combat_id || "combat-monster-ai-001",
    status: "pending"
  });
  manager.addParticipant({
    combat_id: cfg.combat_id || "combat-monster-ai-001",
    participant: {
      participant_id: "hero-001",
      name: "Hero",
      team: cfg.hero_team || "heroes",
      armor_class: 12,
      current_hp: cfg.hero_hp === undefined ? 12 : cfg.hero_hp,
      max_hp: 12,
      attack_bonus: 4,
      damage: 4,
      position: cfg.hero_position || { x: 0, y: 0 },
      metadata: { owner_player_id: "player-hero-001" }
    }
  });
  manager.addParticipant({
    combat_id: cfg.combat_id || "combat-monster-ai-001",
    participant: {
      participant_id: "monster-001",
      name: "Monster",
      team: cfg.monster_team || "monsters",
      armor_class: 11,
      current_hp: cfg.monster_hp === undefined ? 10 : cfg.monster_hp,
      max_hp: 10,
      attack_bonus: 3,
      damage: 3,
      position: cfg.monster_position || { x: 1, y: 0 }
    }
  });

  const started = startCombat({
    combatManager: manager,
    combat_id: cfg.combat_id || "combat-monster-ai-001",
    roll_function(participant) {
      if (participant.participant_id === (cfg.first_actor_id || "hero-001")) {
        return 20;
      }
      return 1;
    }
  });
  assert.equal(started.ok, true);
  return manager;
}

function runMonsterAiTests() {
  const results = [];

  runTest("monster_participants_without_owner_are_ai_controlled", () => {
    const manager = createCombat();
    const loaded = manager.getCombatById("combat-monster-ai-001");
    const hero = loaded.payload.combat.participants.find((entry) => entry.participant_id === "hero-001");
    const monster = loaded.payload.combat.participants.find((entry) => entry.participant_id === "monster-001");
    assert.equal(isAiControlledParticipant(hero), false);
    assert.equal(isAiControlledParticipant(monster), true);
  }, results);

  runTest("ai_turn_attacks_adjacent_target", () => {
    const manager = createCombat({
      first_actor_id: "monster-001"
    });

    const out = resolveMonsterAiTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001",
      attack_roll_fn: () => 18,
      damage_roll_fn: () => 3
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.action_type, "attack");
    const loaded = manager.getCombatById("combat-monster-ai-001");
    const hero = loaded.payload.combat.participants.find((entry) => entry.participant_id === "hero-001");
    assert.equal(hero.current_hp, 9);
  }, results);

  runTest("ai_turn_moves_toward_target_when_not_adjacent", () => {
    const manager = createCombat({
      first_actor_id: "monster-001",
      hero_position: { x: 0, y: 0 },
      monster_position: { x: 4, y: 4 }
    });

    const out = resolveMonsterAiTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.action_type, "move");
    const loaded = manager.getCombatById("combat-monster-ai-001");
    const monster = loaded.payload.combat.participants.find((entry) => entry.participant_id === "monster-001");
    assert.deepEqual(monster.position, { x: 3, y: 3 });
  }, results);

  runTest("ai_turn_waits_when_condition_blocks_action_and_movement", () => {
    const manager = createCombat({
      first_actor_id: "monster-001"
    });
    const combat = manager.getCombatById("combat-monster-ai-001").payload.combat;
    combat.conditions = [{
      condition_id: "condition-confusion-no-action-001",
      condition_type: "confusion_no_action",
      source_actor_id: "hero-001",
      target_actor_id: "monster-001",
      expiration_trigger: "end_of_turn",
      metadata: {
        source: "confusion_turn_behavior",
        status_hint: "confusion",
        blocks_action: true,
        blocks_bonus_action: true,
        blocks_move: true,
        set_movement_remaining_to_zero: true
      }
    }];
    manager.combats.set("combat-monster-ai-001", combat);

    const out = resolveMonsterAiTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.action_type, "wait");
    assert.equal(out.payload.reason, "confusion_no_action");
  }, results);

  runTest("ai_turn_waits_when_action_was_already_spent", () => {
    const manager = createCombat({
      first_actor_id: "monster-001"
    });
    const combat = manager.getCombatById("combat-monster-ai-001").payload.combat;
    const monster = combat.participants.find((entry) => entry.participant_id === "monster-001");
    monster.action_available = false;
    manager.combats.set("combat-monster-ai-001", combat);

    const out = resolveMonsterAiTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.action_type, "wait");
    assert.equal(out.payload.reason, "action_unavailable");
  }, results);

  runTest("progress_after_player_turn_advances_to_ai_then_back_to_player", () => {
    const manager = createCombat({
      first_actor_id: "hero-001"
    });

    const attacked = performAttackAction({
      combatManager: manager,
      combat_id: "combat-monster-ai-001",
      attacker_id: "hero-001",
      target_id: "monster-001",
      attack_roll_fn: () => 17,
      damage_roll_fn: () => 2
    });
    assert.equal(attacked.ok, true);

    const progressed = progressCombatAfterResolvedTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001",
      ai_attack_roll_fn: () => 18,
      ai_damage_roll_fn: () => 3
    });
    assert.equal(progressed.ok, true);
    assert.equal(progressed.payload.ai_turns.length, 1);

    const loaded = manager.getCombatById("combat-monster-ai-001");
    const combat = loaded.payload.combat;
    assert.equal(combat.initiative_order[combat.turn_index], "hero-001");
    const hero = combat.participants.find((entry) => entry.participant_id === "hero-001");
    assert.equal(hero.current_hp, 9);
  }, results);

  runTest("monster_first_turn_progresses_from_current_turn_without_deadlock", () => {
    const manager = createCombat({
      first_actor_id: "monster-001"
    });

    const progressed = progressCombatFromCurrentTurn({
      combatManager: manager,
      combat_id: "combat-monster-ai-001",
      ai_attack_roll_fn: () => 18,
      ai_damage_roll_fn: () => 3
    });
    assert.equal(progressed.ok, true);
    assert.equal(progressed.payload.ai_turns.length, 1);

    const loaded = manager.getCombatById("combat-monster-ai-001");
    const combat = loaded.payload.combat;
    assert.equal(combat.initiative_order[combat.turn_index], "hero-001");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runMonsterAiTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMonsterAiTests
};

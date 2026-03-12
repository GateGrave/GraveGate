"use strict";

const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { performAttackAction } = require("../actions/attackAction");
const { nextTurn } = require("../flow/nextTurn");
const { checkCombatEnd } = require("../flow/checkCombatEnd");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function createSequenceRoller(values, fallback) {
  let index = 0;
  const safeFallback = Number.isFinite(fallback) ? fallback : 1;
  return function rollNext() {
    if (index < values.length) {
      const value = values[index];
      index += 1;
      return value;
    }
    return safeFallback;
  };
}

// Stage 1 simple deterministic harness:
// - create combat
// - add two participants
// - start combat
// - attack / next turn loop
// - check end each cycle
function runCombatHarness(input) {
  const data = input || {};
  const manager = new CombatManager();
  const log = [];

  const attackRoller = createSequenceRoller(data.attack_rolls || [15, 14, 16, 13], 12);
  const damageRoller = createSequenceRoller(data.damage_rolls || [4, 3, 4, 3], 2);

  const created = manager.createCombat({
    combat_id: data.combat_id || "combat-harness-001",
    status: "pending"
  });
  log.push({ step: "create_combat", result: clone(created) });
  if (!created.ok) {
    return failure("combat_harness_failed", "could not create combat", { log });
  }

  const addA = manager.addParticipant({
    combat_id: created.payload.combat.combat_id,
    participant: {
      participant_id: "p1",
      name: "Hero",
      team: "team_a",
      armor_class: 12,
      current_hp: 12,
      max_hp: 12,
      attack_bonus: 3,
      damage: 4
    }
  });
  log.push({ step: "add_participant_p1", result: clone(addA) });
  if (!addA.ok) {
    return failure("combat_harness_failed", "could not add participant p1", { log });
  }

  const addB = manager.addParticipant({
    combat_id: created.payload.combat.combat_id,
    participant: {
      participant_id: "p2",
      name: "Goblin",
      team: "team_b",
      armor_class: 11,
      current_hp: 10,
      max_hp: 10,
      attack_bonus: 2,
      damage: 3
    }
  });
  log.push({ step: "add_participant_p2", result: clone(addB) });
  if (!addB.ok) {
    return failure("combat_harness_failed", "could not add participant p2", { log });
  }

  const started = startCombat({
    combatManager: manager,
    combat_id: created.payload.combat.combat_id,
    // deterministic start order by giving p1 higher roll first
    roll_function: (participant) => (participant.participant_id === "p1" ? 18 : 12)
  });
  log.push({ step: "start_combat", result: clone(started) });
  if (!started.ok) {
    return failure("combat_harness_failed", "could not start combat", { log });
  }

  const maxLoops = Number.isFinite(data.max_loops) ? Math.max(1, Math.floor(data.max_loops)) : 12;
  let loopCount = 0;
  let finalEndResult = null;

  while (loopCount < maxLoops) {
    const state = manager.getCombatById(created.payload.combat.combat_id);
    if (!state.ok) {
      return failure("combat_harness_failed", "combat missing during loop", { log });
    }

    const combat = state.payload.combat;
    const attackerId = combat.initiative_order[combat.turn_index];
    const targetId = attackerId === "p1" ? "p2" : "p1";

    const attack = performAttackAction({
      combatManager: manager,
      combat_id: combat.combat_id,
      attacker_id: attackerId,
      target_id: targetId,
      attack_roll_fn: attackRoller,
      damage_roll_fn: damageRoller
    });
    log.push({
      step: "attack_" + (loopCount + 1),
      attacker_id: attackerId,
      target_id: targetId,
      result: clone(attack)
    });
    if (!attack.ok) {
      return failure("combat_harness_failed", "attack action failed", { log });
    }

    const endCheck = checkCombatEnd({
      combatManager: manager,
      combat_id: combat.combat_id
    });
    log.push({ step: "check_end_" + (loopCount + 1), result: clone(endCheck) });
    if (!endCheck.ok) {
      return failure("combat_harness_failed", "combat end check failed", { log });
    }
    if (endCheck.event_type === "combat_completed") {
      finalEndResult = endCheck;
      break;
    }

    const turned = nextTurn({
      combatManager: manager,
      combat_id: combat.combat_id
    });
    log.push({ step: "next_turn_" + (loopCount + 1), result: clone(turned) });
    if (!turned.ok) {
      return failure("combat_harness_failed", "next turn failed", { log });
    }

    loopCount += 1;
  }

  const finalState = manager.getCombatById(created.payload.combat.combat_id);
  if (!finalState.ok) {
    return failure("combat_harness_failed", "final combat state missing", { log });
  }

  return success("combat_harness_completed", {
    completed: Boolean(finalEndResult),
    loop_count: loopCount + 1,
    final_combat: clone(finalState.payload.combat),
    end_result: finalEndResult ? clone(finalEndResult) : null,
    log
  });
}

if (require.main === module) {
  const out = runCombatHarness();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCombatHarness
};


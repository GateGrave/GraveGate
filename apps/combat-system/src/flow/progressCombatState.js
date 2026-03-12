"use strict";

const { resolveMonsterAiTurn, getActiveParticipant, isAiControlledParticipant } = require("../ai/monsterAi");
const { checkCombatEnd } = require("./checkCombatEnd");
const { nextTurn } = require("./nextTurn");

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

function loadCombatOrFail(combatManager, combatId) {
  const loaded = combatManager.getCombatById(String(combatId));
  if (!loaded.ok) {
    return failure("combat_progression_failed", loaded.error || "combat not found", {
      combat_id: String(combatId)
    });
  }
  return success("combat_progression_loaded", {
    combat: loaded.payload.combat
  });
}

function progressCombatAfterResolvedTurn(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const maxAiTurns = Number.isFinite(data.max_ai_turns) ? Math.max(1, Math.floor(data.max_ai_turns)) : 20;
  const skipInitialTurnAdvance = data.skip_initial_turn_advance === true;

  if (!combatManager) {
    return failure("combat_progression_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_progression_failed", "combat_id is required");
  }

  const aiTurns = [];
  const initialEndCheck = checkCombatEnd({
    combatManager,
    combat_id: String(combatId)
  });
  if (!initialEndCheck.ok) {
    return failure("combat_progression_failed", initialEndCheck.error || "failed to evaluate combat end", initialEndCheck.payload);
  }
  if (initialEndCheck.event_type === "combat_completed" || initialEndCheck.event_type === "combat_already_completed") {
    return success("combat_progression_completed", {
      combat: clone(initialEndCheck.payload.combat),
      combat_completed: true,
      ai_turns: []
    });
  }

  if (!skipInitialTurnAdvance) {
    const firstAdvance = nextTurn({
      combatManager,
      combat_id: String(combatId)
    });
    if (!firstAdvance.ok) {
      return failure("combat_progression_failed", firstAdvance.error || "failed to advance turn", firstAdvance.payload);
    }
  }

  let turnsProcessed = 0;
  while (turnsProcessed < maxAiTurns) {
    const loaded = loadCombatOrFail(combatManager, combatId);
    if (!loaded.ok) {
      return loaded;
    }
    const combat = loaded.payload.combat;
    if (String(combat.status || "") !== "active") {
      return success("combat_progression_completed", {
        combat: clone(combat),
        combat_completed: String(combat.status || "") === "complete",
        ai_turns: clone(aiTurns)
      });
    }

    const activeParticipant = getActiveParticipant(combat);
    if (!activeParticipant || !isAiControlledParticipant(activeParticipant)) {
      return success("combat_progression_completed", {
        combat: clone(combat),
        combat_completed: false,
        active_participant_id: activeParticipant ? String(activeParticipant.participant_id || "") : null,
        ai_turns: clone(aiTurns)
      });
    }

    const aiOut = resolveMonsterAiTurn({
      combatManager,
      combat_id: String(combatId),
      attack_roll_fn: data.ai_attack_roll_fn,
      damage_roll_fn: data.ai_damage_roll_fn,
      opportunity_attack_roll_fn: data.opportunity_attack_roll_fn,
      opportunity_damage_roll_fn: data.opportunity_damage_roll_fn
    });
    if (!aiOut.ok) {
      return failure("combat_progression_failed", aiOut.error || "failed to resolve AI turn", aiOut.payload);
    }
    aiTurns.push(clone(aiOut.payload));
    turnsProcessed += 1;

    const aiEndCheck = checkCombatEnd({
      combatManager,
      combat_id: String(combatId)
    });
    if (!aiEndCheck.ok) {
      return failure("combat_progression_failed", aiEndCheck.error || "failed to evaluate combat end after AI turn", aiEndCheck.payload);
    }
    if (aiEndCheck.event_type === "combat_completed" || aiEndCheck.event_type === "combat_already_completed") {
      return success("combat_progression_completed", {
        combat: clone(aiEndCheck.payload.combat),
        combat_completed: true,
        ai_turns: clone(aiTurns)
      });
    }

    const advanced = nextTurn({
      combatManager,
      combat_id: String(combatId)
    });
    if (!advanced.ok) {
      return failure("combat_progression_failed", advanced.error || "failed to advance turn after AI action", advanced.payload);
    }
  }

  const loaded = loadCombatOrFail(combatManager, combatId);
  if (!loaded.ok) {
    return loaded;
  }

  return success("combat_progression_completed", {
    combat: clone(loaded.payload.combat),
    combat_completed: String(loaded.payload.combat.status || "") === "complete",
    ai_turns: clone(aiTurns),
    truncated: true
  });
}

function progressCombatFromCurrentTurn(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;

  if (!combatManager) {
    return failure("combat_progression_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_progression_failed", "combat_id is required");
  }

  const loaded = loadCombatOrFail(combatManager, combatId);
  if (!loaded.ok) {
    return loaded;
  }
  const combat = loaded.payload.combat;
  const activeParticipant = getActiveParticipant(combat);
  if (!activeParticipant || !isAiControlledParticipant(activeParticipant)) {
    return success("combat_progression_completed", {
      combat: clone(combat),
      combat_completed: String(combat.status || "") === "complete",
      active_participant_id: activeParticipant ? String(activeParticipant.participant_id || "") : null,
      ai_turns: []
    });
  }

  return progressCombatAfterResolvedTurn({
    combatManager,
    combat_id: String(combatId),
    max_ai_turns: data.max_ai_turns,
    ai_attack_roll_fn: data.ai_attack_roll_fn,
    ai_damage_roll_fn: data.ai_damage_roll_fn,
    opportunity_attack_roll_fn: data.opportunity_attack_roll_fn,
    opportunity_damage_roll_fn: data.opportunity_damage_roll_fn,
    skip_initial_turn_advance: true
  });
}

module.exports = {
  progressCombatAfterResolvedTurn,
  progressCombatFromCurrentTurn
};

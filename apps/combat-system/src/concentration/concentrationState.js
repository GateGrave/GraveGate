"use strict";

const { resolveConcentrationSave } = require("./resolve-concentration-save");
const { getConcentrationDC } = require("./check-concentration");
const { computeSavingThrowModifier, rollConditionDiceModifier } = require("../spells/spellcastingHelpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConcentrationState(participant) {
  const concentration = participant && participant.concentration && typeof participant.concentration === "object"
    ? participant.concentration
    : {};
  return {
    is_concentrating: concentration.is_concentrating === true,
    source_spell_id: concentration.source_spell_id || null,
    target_actor_id: concentration.target_actor_id || null,
    linked_condition_ids: Array.isArray(concentration.linked_condition_ids) ? concentration.linked_condition_ids.slice() : [],
    linked_effect_ids: Array.isArray(concentration.linked_effect_ids) ? concentration.linked_effect_ids.slice() : [],
    linked_restorations: Array.isArray(concentration.linked_restorations) ? clone(concentration.linked_restorations) : [],
    started_at_round: Number.isFinite(Number(concentration.started_at_round)) ? Number(concentration.started_at_round) : null,
    broken_reason: concentration.broken_reason || null
  };
}

function initializeParticipantConcentration(participant) {
  return Object.assign({}, participant, {
    concentration: normalizeConcentrationState(participant)
  });
}

function findParticipantIndex(combatState, participantId) {
  const participants = Array.isArray(combatState && combatState.participants) ? combatState.participants : [];
  return participants.findIndex((entry) => String(entry && entry.participant_id || "") === String(participantId || ""));
}

function participantHasFeatFlag(participant, flagKey) {
  const key = String(flagKey || "").trim();
  if (!key || !participant || typeof participant !== "object") {
    return false;
  }
  const featFlags = participant.feat_flags && typeof participant.feat_flags === "object"
    ? participant.feat_flags
    : participant.metadata && participant.metadata.feat_flags && typeof participant.metadata.feat_flags === "object"
      ? participant.metadata.feat_flags
      : {};
  return featFlags[key] === true;
}

function applyRestorations(combatState, restorations) {
  const nextCombat = clone(combatState);
  const list = Array.isArray(restorations) ? restorations : [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index] && typeof list[index] === "object" ? list[index] : null;
    if (!entry) {
      continue;
    }
    if (String(entry.type || "") === "armor_class_delta") {
      const participantIndex = findParticipantIndex(nextCombat, entry.target_actor_id);
      if (participantIndex === -1) {
        continue;
      }
      const participant = nextCombat.participants[participantIndex];
      const currentArmorClass = Number.isFinite(Number(participant.armor_class)) ? Number(participant.armor_class) : 10;
      const delta = Number.isFinite(Number(entry.delta)) ? Number(entry.delta) : 0;
      nextCombat.participants[participantIndex] = Object.assign({}, participant, {
        armor_class: currentArmorClass + delta
      });
    }
  }
  return nextCombat;
}

function clearParticipantConcentration(combatState, participantId, reason) {
  const nextCombat = clone(combatState);
  const participantIndex = findParticipantIndex(nextCombat, participantId);
  if (participantIndex === -1) {
    return {
      ok: false,
      error: "participant not found"
    };
  }

  const participant = nextCombat.participants[participantIndex];
  const current = normalizeConcentrationState(participant);
  const linkedConditionIds = current.linked_condition_ids;
  const linkedEffectIds = current.linked_effect_ids;
  const linkedRestorations = current.linked_restorations;

  nextCombat.conditions = Array.isArray(nextCombat.conditions)
    ? nextCombat.conditions.filter((condition) => !linkedConditionIds.includes(String(condition && condition.condition_id || "")))
    : [];
  nextCombat.active_effects = Array.isArray(nextCombat.active_effects)
    ? nextCombat.active_effects.filter((effect) => !linkedEffectIds.includes(String(effect && effect.effect_id || "")))
    : [];
  const restoredCombat = applyRestorations(nextCombat, linkedRestorations);
  restoredCombat.participants[participantIndex] = Object.assign({}, restoredCombat.participants[participantIndex], {
    concentration: {
      is_concentrating: false,
      source_spell_id: null,
      target_actor_id: null,
      linked_condition_ids: [],
      linked_effect_ids: [],
      linked_restorations: [],
      started_at_round: null,
      broken_reason: reason || null
    }
  });
  restoredCombat.updated_at = new Date().toISOString();

  return {
    ok: true,
    next_state: restoredCombat,
    cleared: current.is_concentrating === true,
    removed_condition_ids: linkedConditionIds.slice(),
    removed_effect_ids: linkedEffectIds.slice(),
    restoration_count: linkedRestorations.length
  };
}

function startParticipantConcentration(combatState, input) {
  const nextCombat = clone(combatState);
  const participantIndex = findParticipantIndex(nextCombat, input && input.participant_id);
  if (participantIndex === -1) {
    return {
      ok: false,
      error: "participant not found"
    };
  }

  let replaced = null;
  const participant = nextCombat.participants[participantIndex];
  const current = normalizeConcentrationState(participant);
  if (current.is_concentrating) {
    const cleared = clearParticipantConcentration(nextCombat, input.participant_id, "replaced");
    if (!cleared.ok) {
      return cleared;
    }
    replaced = {
      source_spell_id: current.source_spell_id,
      removed_condition_ids: cleared.removed_condition_ids,
      removed_effect_ids: cleared.removed_effect_ids
    };
    nextCombat.conditions = cleared.next_state.conditions;
    nextCombat.active_effects = cleared.next_state.active_effects;
    nextCombat.participants = cleared.next_state.participants;
  }

  const normalizedParticipant = nextCombat.participants[participantIndex];
  nextCombat.participants[participantIndex] = Object.assign({}, normalizedParticipant, {
    concentration: {
      is_concentrating: true,
      source_spell_id: input && input.source_spell_id ? String(input.source_spell_id) : null,
      target_actor_id: input && input.target_actor_id ? String(input.target_actor_id) : null,
      linked_condition_ids: Array.isArray(input && input.linked_condition_ids) ? input.linked_condition_ids.map((entry) => String(entry)) : [],
      linked_effect_ids: Array.isArray(input && input.linked_effect_ids) ? input.linked_effect_ids.map((entry) => String(entry)) : [],
      linked_restorations: Array.isArray(input && input.linked_restorations) ? clone(input.linked_restorations) : [],
      started_at_round: Number.isFinite(Number(input && input.started_at_round)) ? Number(input.started_at_round) : null,
      broken_reason: null
    }
  });
  nextCombat.updated_at = new Date().toISOString();

  return {
    ok: true,
    next_state: nextCombat,
    concentration: clone(nextCombat.participants[participantIndex].concentration),
    replaced_concentration: replaced
  };
}

function resolveConcentrationDamageCheck(combatState, participantId, damageTaken, rng) {
  const nextCombat = clone(combatState);
  const participantIndex = findParticipantIndex(nextCombat, participantId);
  if (participantIndex === -1) {
    return {
      ok: false,
      error: "participant not found"
    };
  }

  const damage = Math.max(0, Number(damageTaken || 0));
  const participant = nextCombat.participants[participantIndex];
  const concentration = normalizeConcentrationState(participant);
  if (damage <= 0 || concentration.is_concentrating !== true) {
    return {
      ok: true,
      required: false,
      next_state: nextCombat,
      concentration_result: null
    };
  }

  const dc = getConcentrationDC(damage);
  const modifier = computeSavingThrowModifier(participant, "constitution");
  const conditionBonus = rollConditionDiceModifier({
    combat_state: nextCombat,
    participant_id: participantId,
    positive_condition: "bless",
    negative_condition: "bane",
    rng
  });
  const saveResult = resolveConcentrationSave({
    dc,
    constitution_save_modifier: modifier + conditionBonus.total,
    advantage: participantHasFeatFlag(participant, "war_caster"),
    rng
  });
  if (saveResult.success) {
    return {
      ok: true,
      required: true,
      next_state: nextCombat,
      concentration_result: {
        participant_id: String(participantId || ""),
        damage_taken: damage,
        concentration_dc: dc,
        save_result: saveResult,
        concentration_broken: false,
        removed_condition_ids: []
      }
    };
  }

  const cleared = clearParticipantConcentration(nextCombat, participantId, "failed_save");
  if (!cleared.ok) {
    return cleared;
  }
  return {
    ok: true,
    required: true,
    next_state: cleared.next_state,
    concentration_result: {
      participant_id: String(participantId || ""),
      damage_taken: damage,
      concentration_dc: dc,
      save_result: saveResult,
      concentration_broken: true,
      removed_condition_ids: cleared.removed_condition_ids
    }
  };
}

module.exports = {
  initializeParticipantConcentration,
  normalizeConcentrationState,
  clearParticipantConcentration,
  startParticipantConcentration,
  resolveConcentrationDamageCheck
};

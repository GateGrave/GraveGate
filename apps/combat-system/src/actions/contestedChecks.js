"use strict";

function defaultContestRoll() {
  return Math.floor(Math.random() * 20) + 1;
}

function normalizeAbilityId(abilityId, fallback) {
  const safe = String(abilityId || "").trim().toLowerCase();
  if (!safe) {
    return fallback || "strength";
  }
  if (safe === "str") return "strength";
  if (safe === "dex") return "dexterity";
  if (safe === "con") return "constitution";
  if (safe === "int") return "intelligence";
  if (safe === "wis") return "wisdom";
  if (safe === "cha") return "charisma";
  return safe;
}

function getAbilityScore(participant, abilityId) {
  const key = normalizeAbilityId(abilityId, "strength");
  const score = Number(
    participant && participant.stats && participant.stats[key] !== undefined
      ? participant.stats[key]
      : participant && participant.metadata && participant.metadata.stats && participant.metadata.stats[key] !== undefined
        ? participant.metadata.stats[key]
        : 10
  );
  return Number.isFinite(score) ? score : 10;
}

function abilityModifierFromScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.floor((numeric - 10) / 2);
}

function getAbilityModifier(participant, abilityId) {
  return abilityModifierFromScore(getAbilityScore(participant, abilityId));
}

function resolveContestedCheck(input) {
  const data = input || {};
  const attacker = data.attacker || null;
  const defender = data.defender || null;
  const attackerAbility = normalizeAbilityId(data.attacker_ability, "strength");
  const defenderAbility = normalizeAbilityId(data.defender_ability, "strength");
  const rollFn = typeof data.roll_fn === "function" ? data.roll_fn : defaultContestRoll;
  const combat = data.combat || null;

  const attackerRoll = Number(rollFn(attacker, attackerAbility, combat, "attacker"));
  const defenderRoll = Number(rollFn(defender, defenderAbility, combat, "defender"));
  const safeAttackerRoll = Number.isFinite(attackerRoll) ? attackerRoll : defaultContestRoll();
  const safeDefenderRoll = Number.isFinite(defenderRoll) ? defenderRoll : defaultContestRoll();
  const attackerModifier = getAbilityModifier(attacker, attackerAbility);
  const defenderModifier = getAbilityModifier(defender, defenderAbility);
  const attackerTotal = safeAttackerRoll + attackerModifier;
  const defenderTotal = safeDefenderRoll + defenderModifier;

  return {
    attacker: {
      participant_id: attacker && attacker.participant_id ? String(attacker.participant_id) : null,
      ability_id: attackerAbility,
      roll: safeAttackerRoll,
      modifier: attackerModifier,
      total: attackerTotal
    },
    defender: {
      participant_id: defender && defender.participant_id ? String(defender.participant_id) : null,
      ability_id: defenderAbility,
      roll: safeDefenderRoll,
      modifier: defenderModifier,
      total: defenderTotal
    },
    attacker_wins: attackerTotal >= defenderTotal
  };
}

module.exports = {
  normalizeAbilityId,
  getAbilityScore,
  getAbilityModifier,
  resolveContestedCheck
};

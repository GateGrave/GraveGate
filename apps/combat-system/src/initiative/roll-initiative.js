"use strict";

/**
 * Roll one d20 using Math.random by default.
 * @param {Function} [rng] - Optional RNG function returning [0, 1).
 * @returns {number}
 */
function rollD20(rng) {
  const randomFn = typeof rng === "function" ? rng : Math.random;
  return Math.floor(randomFn() * 20) + 1;
}

/**
 * Roll initiative for one participant.
 * initiative_total = d20_roll + initiative_modifier
 * @param {object} participant
 * @param {Function} [rng]
 * @returns {object}
 */
function rollInitiativeForParticipant(participant, rng) {
  const modifier = Number(participant.initiative_modifier || 0);
  const d20Roll = rollD20(rng);

  return {
    participant_id: participant.participant_id,
    initiative_modifier: modifier,
    d20_roll: d20Roll,
    initiative_total: d20Roll + modifier
  };
}

/**
 * Roll initiative for all participants in combat.
 * @param {object[]} participants
 * @param {object} [options]
 * @param {Function} [options.rng]
 * @returns {object[]}
 */
function rollInitiativeForAllParticipants(participants, options) {
  const list = Array.isArray(participants) ? participants : [];
  const rng = options && options.rng ? options.rng : undefined;

  return list.map((participant) => rollInitiativeForParticipant(participant, rng));
}

module.exports = {
  rollD20,
  rollInitiativeForParticipant,
  rollInitiativeForAllParticipants
};

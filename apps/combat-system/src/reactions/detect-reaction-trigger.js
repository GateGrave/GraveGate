"use strict";

const { REACTION_TRIGGER_TYPES } = require("./trigger-types");

/**
 * Detect supported reaction trigger from incoming event.
 * Supported event types are placeholders for the reaction pipeline.
 * @param {object} event
 * @returns {object|null}
 */
function detectReactionTrigger(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  if (event.event_type === "combat_trigger_enemy_leaves_melee_range") {
    return {
      trigger_type: REACTION_TRIGGER_TYPES.ENEMY_LEAVES_MELEE_RANGE
    };
  }

  if (event.event_type === "combat_trigger_spell_cast") {
    return {
      trigger_type: REACTION_TRIGGER_TYPES.SPELL_CAST
    };
  }

  if (event.event_type === "combat_trigger_ally_attacked") {
    return {
      trigger_type: REACTION_TRIGGER_TYPES.ALLY_ATTACKED
    };
  }

  return null;
}

module.exports = {
  detectReactionTrigger
};

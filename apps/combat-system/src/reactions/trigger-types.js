"use strict";

const REACTION_TRIGGER_TYPES = {
  ENEMY_LEAVES_MELEE_RANGE: "enemy_leaves_melee_range",
  SPELL_CAST: "spell_cast",
  ALLY_ATTACKED: "ally_attacked"
};

const REACTION_EVENT_TYPES = {
  WINDOW_OPENED: "reaction_window_opened",
  USED: "reaction_used",
  DECLINED: "reaction_declined",
  TIMEOUT: "reaction_timeout",
  IGNORED: "reaction_ignored",
  OPPORTUNITY_ATTACK_DECLARED: "opportunity_attack_declared"
};

module.exports = {
  REACTION_TRIGGER_TYPES,
  REACTION_EVENT_TYPES
};

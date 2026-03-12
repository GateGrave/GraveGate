"use strict";

const { DAMAGE_TYPES } = require("./damage-types");
const { getCharacterDamageProfile } = require("./character-damage-profile");
const {
  applyVulnerability,
  applyResistance,
  applyImmunity,
  resolveDamagePipeline
} = require("./resolve-damage-pipeline");
const { applyDamageToCombatState } = require("./apply-damage-to-combat-state");

module.exports = {
  DAMAGE_TYPES,
  getCharacterDamageProfile,
  applyVulnerability,
  applyResistance,
  applyImmunity,
  resolveDamagePipeline,
  applyDamageToCombatState
};

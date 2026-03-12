"use strict";

const { DAMAGE_TYPES } = require("../damage");

function createMockCombatants() {
  return [
    {
      participant_id: "hero-001",
      name: "Aria",
      team_id: "heroes",
      initiative_modifier: 3,
      position: { x: 2, y: 2 },
      movement_speed: 30,
      movement_remaining: 30,
      action_available: true,
      bonus_action_available: true,
      reaction_available: true,
      current_hp: 28,
      armor_class: 14,
      constitution_save_modifier: 3,
      vulnerabilities: [],
      resistances: [DAMAGE_TYPES.COLD],
      immunities: []
    },
    {
      participant_id: "hero-002",
      name: "Bram",
      team_id: "heroes",
      initiative_modifier: 1,
      position: { x: 1, y: 2 },
      movement_speed: 30,
      movement_remaining: 30,
      action_available: true,
      bonus_action_available: false,
      reaction_available: true,
      current_hp: 30,
      armor_class: 16,
      constitution_save_modifier: 2,
      vulnerabilities: [],
      resistances: [],
      immunities: []
    },
    {
      participant_id: "enemy-001",
      name: "Goblin",
      team_id: "monsters",
      initiative_modifier: 2,
      position: { x: 4, y: 2 },
      movement_speed: 30,
      movement_remaining: 30,
      action_available: true,
      bonus_action_available: false,
      reaction_available: true,
      current_hp: 22,
      armor_class: 13,
      constitution_save_modifier: 1,
      vulnerabilities: [DAMAGE_TYPES.FIRE],
      resistances: [],
      immunities: []
    }
  ];
}

module.exports = {
  createMockCombatants
};

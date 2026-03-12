"use strict";

// Base and derived character stats snapshot.
// This stores values directly and does not calculate modifiers automatically.
const statsModel = {
  ability_scores: {
    strength: "number",
    dexterity: "number",
    constitution: "number",
    intelligence: "number",
    wisdom: "number",
    charisma: "number"
  },
  derived_stats: {
    max_hp: "number",
    armor_class: "number",
    speed: "number",
    proficiency_bonus: "number"
  }
};

const exampleStats = {
  ability_scores: {
    strength: 12,
    dexterity: 14,
    constitution: 14,
    intelligence: 18,
    wisdom: 10,
    charisma: 13
  },
  derived_stats: {
    max_hp: 38,
    armor_class: 15,
    speed: 30,
    proficiency_bonus: 3
  }
};

module.exports = {
  statsModel,
  exampleStats
};

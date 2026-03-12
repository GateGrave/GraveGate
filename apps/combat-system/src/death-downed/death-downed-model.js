"use strict";

const LIFE_STATES = {
  ALIVE: "alive",
  DOWNED: "downed",
  STABILIZED: "stabilized",
  DEAD: "dead"
};

function createDefaultDeathSaves() {
  return {
    successes: 0,
    failures: 0
  };
}

module.exports = {
  LIFE_STATES,
  createDefaultDeathSaves
};

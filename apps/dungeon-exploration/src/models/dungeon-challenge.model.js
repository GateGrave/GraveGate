"use strict";

const CHALLENGE_SOLUTIONS = {
  LOCKPICK: "lockpick",
  FORCE: "force",
  SPELL: "spell",
  USE_ITEM: "use_item"
};

const DUNGEON_CHALLENGE_SCHEMA = {
  challenge_id: "string",
  description: "string",
  difficulty: "string|number",
  solutions: "array<string>",
  success_result: "object",
  failure_result: "object"
};

function createChallenge(input) {
  const value = input || {};
  if (!value.challenge_id) {
    throw new Error("createChallenge requires challenge_id");
  }

  return {
    challenge_id: String(value.challenge_id),
    description: String(value.description || ""),
    difficulty: value.difficulty ?? "normal",
    solutions: Array.isArray(value.solutions) ? value.solutions.map((x) => String(x)) : [],
    success_result: value.success_result || {
      status: "success",
      message: "Challenge completed"
    },
    failure_result: value.failure_result || {
      status: "failure",
      message: "Challenge failed"
    }
  };
}

module.exports = {
  CHALLENGE_SOLUTIONS,
  DUNGEON_CHALLENGE_SCHEMA,
  createChallenge
};


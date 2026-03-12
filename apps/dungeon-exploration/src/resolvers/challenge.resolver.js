"use strict";

const { createChallenge } = require("../models/dungeon-challenge.model");

class InMemoryChallengeStore {
  constructor() {
    this.challenges = new Map();
  }

  save(challenge) {
    this.challenges.set(challenge.challenge_id, challenge);
    return challenge;
  }

  get(challenge_id) {
    return this.challenges.get(challenge_id) || null;
  }
}

/**
 * Resolve one challenge by challenge_id + player_action.
 * This is scaffold logic only (solution matching).
 */
function resolveChallenge(challenge_id, player_action, options) {
  const cfg = options || {};
  const store = cfg.challenge_store;

  if (!store || typeof store.get !== "function") {
    return {
      ok: false,
      event_type: "challenge_resolution_failed",
      reason: "challenge_store_required",
      payload: null
    };
  }

  const challenge = store.get(challenge_id);
  if (!challenge) {
    return {
      ok: false,
      event_type: "challenge_resolution_failed",
      reason: "challenge_not_found",
      payload: {
        challenge_id,
        player_action
      }
    };
  }

  const action = String(player_action || "");
  const matched = challenge.solutions.includes(action);
  const outcome = matched ? "challenge_succeeded" : "challenge_failed";
  const result = matched ? challenge.success_result : challenge.failure_result;

  return {
    ok: true,
    event_type: "challenge_resolved",
    payload: {
      challenge_id: challenge.challenge_id,
      player_action: action,
      matched_solution: matched,
      outcome,
      difficulty: challenge.difficulty,
      next_result: result,
      resolved_at: new Date().toISOString()
    }
  };
}

function createDefaultChallengeStore() {
  const store = new InMemoryChallengeStore();

  store.save(
    createChallenge({
      challenge_id: "challenge-locked-door-001",
      description: "A heavy locked iron door blocks the path.",
      difficulty: "medium",
      solutions: ["lockpick", "force", "spell", "use_item"],
      success_result: {
        status: "success",
        message: "The door opens.",
        room_update: { door_open: true }
      },
      failure_result: {
        status: "failure",
        message: "The door remains shut."
      }
    })
  );

  return store;
}

module.exports = {
  InMemoryChallengeStore,
  resolveChallenge,
  createDefaultChallengeStore
};


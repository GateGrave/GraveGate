"use strict";

const MIN_TURN_TIMEOUT_SECONDS = 60;
const MAX_TURN_TIMEOUT_SECONDS = 90;

const TURN_TIMEOUT_POLICIES = {
  AUTO_DODGE: "auto_dodge",
  SKIP_TURN: "skip_turn"
};

function assertValidTurnTimeoutSeconds(timeoutSeconds) {
  const value = Number(timeoutSeconds);
  if (!Number.isFinite(value)) {
    throw new Error("turn_timeout_seconds must be a number");
  }

  if (value < MIN_TURN_TIMEOUT_SECONDS || value > MAX_TURN_TIMEOUT_SECONDS) {
    throw new Error(
      `turn_timeout_seconds must be between ${MIN_TURN_TIMEOUT_SECONDS} and ${MAX_TURN_TIMEOUT_SECONDS}`
    );
  }

  return value;
}

function buildTimeoutAutoAction(policy, activeParticipantId) {
  if (policy === TURN_TIMEOUT_POLICIES.AUTO_DODGE) {
    return {
      action_type: "dodge",
      actor_participant_id: activeParticipantId,
      source: "timeout_auto_action"
    };
  }

  return {
    action_type: "skip_turn",
    actor_participant_id: activeParticipantId,
    source: "timeout_auto_action"
  };
}

async function waitForPlayerActionWithTimeout(input) {
  const timeoutSeconds = assertValidTurnTimeoutSeconds(input.timeout_seconds);
  const timeoutMs = timeoutSeconds * 1000;
  const provider = input.action_provider;
  const fallbackPayload = input.fallback_action_payload || null;

  if (typeof provider !== "function") {
    return {
      status: "no_provider",
      action_payload: fallbackPayload,
      timeout_seconds: timeoutSeconds
    };
  }

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve({ __timeout__: true }), timeoutMs);
  });

  const actionPromise = Promise.resolve(
    provider({
      combat_id: input.combat_id,
      participant_id: input.participant_id
    })
  );

  const raceResult = await Promise.race([actionPromise, timeoutPromise]);

  if (raceResult && raceResult.__timeout__ === true) {
    return {
      status: "timeout",
      action_payload: null,
      timeout_seconds: timeoutSeconds
    };
  }

  return {
    status: "provided",
    action_payload: raceResult || fallbackPayload,
    timeout_seconds: timeoutSeconds
  };
}

module.exports = {
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout
};

"use strict";

const { SUPPORTED_SOURCE_CONTEXTS } = require("./rollLoot");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function normalizeContext(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

function validateRequiredPayloadFields(payload) {
  const required = ["source_type", "source_id", "reward_context"];
  const missing = required.filter((key) => !payload[key] || String(payload[key]).trim() === "");
  return missing;
}

function resolveLootTableReference(payload, options) {
  const cfg = options || {};

  if (cfg.loot_table && typeof cfg.loot_table === "object") {
    return {
      loot_table: cfg.loot_table,
      loot_table_id: cfg.loot_table.loot_table_id || payload.loot_table_id || null
    };
  }

  const lootTableId = cfg.loot_table_id || payload.loot_table_id || null;
  if (!lootTableId) {
    return {
      loot_table: null,
      loot_table_id: null
    };
  }

  if (typeof cfg.resolve_loot_table_fn === "function") {
    const resolved = cfg.resolve_loot_table_fn(String(lootTableId), payload);
    if (resolved && typeof resolved === "object") {
      return {
        loot_table: resolved,
        loot_table_id: resolved.loot_table_id || String(lootTableId)
      };
    }
  }

  return {
    loot_table: null,
    loot_table_id: String(lootTableId)
  };
}

function consumeRewardHook(input) {
  const data = input || {};
  const rewardPayload = data.reward_hook;

  if (!rewardPayload || typeof rewardPayload !== "object") {
    return failure("reward_hook_consume_failed", "reward_hook payload is required");
  }

  const missing = validateRequiredPayloadFields(rewardPayload);
  if (missing.length > 0) {
    return failure("reward_hook_consume_failed", "missing required reward_hook fields", {
      missing_fields: missing
    });
  }

  const rewardContext = normalizeContext(rewardPayload.reward_context);
  if (!SUPPORTED_SOURCE_CONTEXTS.includes(rewardContext)) {
    return failure("reward_hook_consume_failed", "unsupported reward_context", {
      reward_context: rewardContext,
      supported_reward_contexts: clone(SUPPORTED_SOURCE_CONTEXTS)
    });
  }

  const resolvedTable = resolveLootTableReference(rewardPayload, {
    loot_table: data.loot_table,
    loot_table_id: data.loot_table_id,
    resolve_loot_table_fn: data.resolve_loot_table_fn
  });

  const rollInput = {
    loot_table: resolvedTable.loot_table,
    loot_table_id: resolvedTable.loot_table_id,
    source_context: rewardContext,
    target_player_id: rewardPayload.target_player_id ? String(rewardPayload.target_player_id) : null,
    source_type: String(rewardPayload.source_type),
    source_id: String(rewardPayload.source_id),
    metadata: rewardPayload.metadata && typeof rewardPayload.metadata === "object"
      ? clone(rewardPayload.metadata)
      : {}
  };

  if (rewardPayload.reward_key) {
    rollInput.metadata.reward_key = String(rewardPayload.reward_key);
  }
  if (rewardPayload.source_event_id) {
    rollInput.metadata.source_event_id = String(rewardPayload.source_event_id);
  }

  if (rewardPayload.reward_curve && typeof rewardPayload.reward_curve === "object") {
    rollInput.metadata.reward_curve = clone(rewardPayload.reward_curve);
  }

  return success("reward_hook_consumed", {
    reward_context: rewardContext,
    source_type: rollInput.source_type,
    source_id: rollInput.source_id,
    target_player_id: rollInput.target_player_id,
    loot_table_id: rollInput.loot_table_id,
    next_step: {
      event_type: "loot_roll_requested",
      target_system: "loot_system",
      should_activate: true,
      roll_input: rollInput
    }
  });
}

module.exports = {
  consumeRewardHook
};

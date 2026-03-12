"use strict";

const { renderCombatMapFromState } = require("../render/combatMapRenderer");

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

// Canonical render entrypoint:
// runtime/combat flow should request map output from combat_id here so renderer always
// reads authoritative combat state from CombatManager instead of shadow copies.
function renderCombatById(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const options = data.options || {};

  if (!combatManager || typeof combatManager.getCombatById !== "function") {
    return failure("combat_render_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_render_failed", "combat_id is required");
  }

  const loaded = combatManager.getCombatById(String(combatId));
  if (!loaded.ok) {
    return failure("combat_render_failed", loaded.error || "combat not found", {
      combat_id: String(combatId)
    });
  }

  const renderOut = renderCombatMapFromState({
    combat_state: loaded.payload.combat,
    options
  });
  if (!renderOut.ok) {
    return renderOut;
  }

  return success("combat_render_ready", {
    combat_id: String(combatId),
    render: renderOut.payload
  });
}

module.exports = {
  renderCombatById
};


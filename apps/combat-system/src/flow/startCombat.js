"use strict";

const {
  MAX_GRID_SIZE,
  createBattlefieldGrid,
  getTileAt,
  setTileAt
} = require("../battlefield");
const { initializeParticipantReactions } = require("../reactions/reactionState");
const { initializeParticipantConcentration } = require("../concentration/concentrationState");
const { initializeParticipantSpellcastingTurnState } = require("../spells/spellcastingHelpers");

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

function findParticipantById(participants, participantId) {
  return participants.find((participant) => String(participant.participant_id) === String(participantId)) || null;
}

function initializeParticipantTurnState(participant) {
  const movementSpeed = Number(participant && participant.movement_speed);
  return initializeParticipantSpellcastingTurnState(initializeParticipantConcentration(Object.assign({}, participant, {
    action_available:
      participant && typeof participant.action_available === "boolean"
        ? participant.action_available
        : true,
    bonus_action_available:
      participant && typeof participant.bonus_action_available === "boolean"
        ? participant.bonus_action_available
        : true,
    movement_remaining:
      Number.isFinite(participant && participant.movement_remaining)
        ? Number(participant.movement_remaining)
        : (Number.isFinite(movementSpeed) ? movementSpeed : 30)
  })));
}

function normalizePosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y)
  };
}

function resolveBattlefieldDimension(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(MAX_GRID_SIZE, Math.floor(parsed)));
}

function ensureBattlefieldGrid(combat) {
  if (
    combat.battlefield_grid &&
    typeof combat.battlefield_grid === "object" &&
    Number.isFinite(combat.battlefield_grid.width) &&
    Number.isFinite(combat.battlefield_grid.height) &&
    Array.isArray(combat.battlefield_grid.tiles)
  ) {
    return success("battlefield_grid_ready", {
      battlefield_grid: clone(combat.battlefield_grid)
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < participants.length; index += 1) {
    const position = normalizePosition(participants[index] && participants[index].position);
    if (!position) {
      continue;
    }
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }

  const battlefield = combat.battlefield && typeof combat.battlefield === "object" ? combat.battlefield : {};
  const width = resolveBattlefieldDimension(battlefield.width, Math.max(1, maxX + 1));
  const height = resolveBattlefieldDimension(battlefield.height, Math.max(1, maxY + 1));
  let grid = createBattlefieldGrid({ width, height });

  for (let index = 0; index < participants.length; index += 1) {
    const participant = participants[index];
    const position = normalizePosition(participant && participant.position);
    if (!position) {
      continue;
    }
    if (position.x < 0 || position.y < 0 || position.x >= grid.width || position.y >= grid.height) {
      return failure("combat_start_failed", "participant position is outside battlefield grid", {
        participant_id: participant && participant.participant_id ? String(participant.participant_id) : null,
        position,
        battlefield_size: {
          width: grid.width,
          height: grid.height
        }
      });
    }
    const currentTile = getTileAt(grid, position.x, position.y);
    if (!currentTile) {
      return failure("combat_start_failed", "participant position points to missing battlefield tile", {
        participant_id: participant && participant.participant_id ? String(participant.participant_id) : null,
        position
      });
    }
    if (currentTile.occupant && currentTile.occupant !== String(participant.participant_id || "")) {
      return failure("combat_start_failed", "multiple participants occupy the same battlefield tile", {
        participant_id: participant && participant.participant_id ? String(participant.participant_id) : null,
        position,
        occupant: currentTile.occupant
      });
    }
    grid = setTileAt(grid, position.x, position.y, {
      ...currentTile,
      occupant: String(participant.participant_id || "")
    });
  }

  combat.battlefield_grid = grid;
  return success("battlefield_grid_ready", {
    battlefield_grid: clone(grid)
  });
}

// Stage 1 start-combat flow:
// - verify combat exists
// - require at least 2 participants
// - initialize initiative
// - set status/round/turn_index
// - append a simple event log row
function startCombat(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;
  const rollFunction = data.roll_function;

  if (!combatManager) {
    return failure("combat_start_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_start_failed", "combat_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("combat_start_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = found.payload.combat;
  if (combat.status === "active") {
    return failure("combat_start_failed", "combat is already active", {
      combat_id: String(combatId)
    });
  }
  if (combat.status === "complete") {
    return failure("combat_start_failed", "combat is already complete", {
      combat_id: String(combatId)
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  if (participants.length < 2) {
    return failure("combat_start_failed", "combat needs at least 2 participants", {
      combat_id: String(combatId),
      participant_count: participants.length
    });
  }

  const battlefieldReady = ensureBattlefieldGrid(combat);
  if (!battlefieldReady.ok) {
    return battlefieldReady;
  }
  combatManager.combats.set(String(combatId), clone(combat));

  const initiative = combatManager.initializeInitiativeOrder({
    combat_id: String(combatId),
    roll_function: rollFunction
  });
  if (!initiative.ok) {
    return failure("combat_start_failed", initiative.error || "initiative initialization failed", {
      combat_id: String(combatId),
      initiative_result: initiative
    });
  }

  const latest = combatManager.getCombatById(combatId);
  if (!latest.ok) {
    return failure("combat_start_failed", "combat missing after initiative initialization", {
      combat_id: String(combatId)
    });
  }

  const startedCombat = clone(latest.payload.combat);
  const initiativeOrder = Array.isArray(startedCombat.initiative_order) ? startedCombat.initiative_order : [];
  if (initiativeOrder.length === 0) {
    return failure("combat_start_failed", "initiative_order is empty after initialization", {
      combat_id: String(combatId)
    });
  }

  let firstLivingTurnIndex = -1;
  for (let index = 0; index < initiativeOrder.length; index += 1) {
    const participantId = initiativeOrder[index];
    const participant = findParticipantById(participants, participantId);
    const hp = participant && Number.isFinite(participant.current_hp) ? participant.current_hp : 1;
    if (participant && hp > 0) {
      firstLivingTurnIndex = index;
      break;
    }
  }
  if (firstLivingTurnIndex === -1) {
    return failure("combat_start_failed", "no living participants available to start combat", {
      combat_id: String(combatId)
    });
  }

  startedCombat.status = "active";
  startedCombat.round = 1;
  startedCombat.turn_index = firstLivingTurnIndex;
  startedCombat.participants = initializeParticipantReactions(startedCombat.participants).map(initializeParticipantTurnState);
  startedCombat.event_log = Array.isArray(startedCombat.event_log) ? startedCombat.event_log : [];
  startedCombat.event_log.push({
    event_type: "combat_started",
    timestamp: new Date().toISOString(),
    details: {
      participant_count: participants.length,
      initiative_order: clone(startedCombat.initiative_order),
      first_active_participant_id: initiativeOrder[firstLivingTurnIndex]
    }
  });
  startedCombat.updated_at = new Date().toISOString();

  // Save back into in-memory combat store.
  combatManager.combats.set(String(combatId), startedCombat);

  return success("combat_started", {
    combat: clone(startedCombat)
  });
}

module.exports = {
  startCombat
};

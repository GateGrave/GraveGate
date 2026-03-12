"use strict";

const { createCombatModel } = require("./combatModel");
const { resolveInitiativeOrder } = require("../initiative/initiativeResolver");

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

class CombatManager {
  constructor() {
    // In-memory store. Each combat instance is isolated by combat_id.
    this.combats = new Map();
  }

  createCombat(input) {
    try {
      const combat = createCombatModel(input);

      if (this.combats.has(combat.combat_id)) {
        return failure("combat_create_failed", "combat_id already exists", {
          combat_id: combat.combat_id
        });
      }

      this.combats.set(combat.combat_id, combat);
      return success("combat_created", { combat: clone(combat) });
    } catch (error) {
      return failure("combat_create_failed", error.message);
    }
  }

  getCombatById(combatId) {
    if (!combatId || String(combatId).trim() === "") {
      return failure("combat_fetch_failed", "combat_id is required");
    }

    const combat = this.combats.get(String(combatId));
    if (!combat) {
      return failure("combat_fetch_failed", "combat not found", {
        combat_id: String(combatId)
      });
    }

    return success("combat_found", { combat: clone(combat) });
  }

  addParticipant(input) {
    const data = input || {};
    const combatId = data.combat_id;
    const participant = data.participant;

    if (!combatId || String(combatId).trim() === "") {
      return failure("combat_add_participant_failed", "combat_id is required");
    }
    if (!participant || typeof participant !== "object") {
      return failure("combat_add_participant_failed", "participant object is required");
    }

    const combat = this.combats.get(String(combatId));
    if (!combat) {
      return failure("combat_add_participant_failed", "combat not found", {
        combat_id: String(combatId)
      });
    }

    const participantId = participant.participant_id || participant.id || null;
    if (!participantId) {
      return failure("combat_add_participant_failed", "participant_id is required");
    }

    const alreadyExists = combat.participants.some((p) => {
      return String(p.participant_id || p.id) === String(participantId);
    });
    if (alreadyExists) {
      return failure("combat_add_participant_failed", "participant already exists", {
        combat_id: String(combatId),
        participant_id: String(participantId)
      });
    }

    combat.participants.push(clone(participant));
    combat.updated_at = new Date().toISOString();
    this.combats.set(String(combatId), combat);

    return success("combat_participant_added", {
      combat_id: String(combatId),
      participant: clone(participant),
      participant_count: combat.participants.length
    });
  }

  listParticipants(combatId) {
    if (!combatId || String(combatId).trim() === "") {
      return failure("combat_list_participants_failed", "combat_id is required");
    }

    const combat = this.combats.get(String(combatId));
    if (!combat) {
      return failure("combat_list_participants_failed", "combat not found", {
        combat_id: String(combatId)
      });
    }

    return success("combat_participants_listed", {
      combat_id: String(combatId),
      participants: clone(combat.participants),
      participant_count: combat.participants.length
    });
  }

  initializeInitiativeOrder(input) {
    const data = input || {};
    const combatId = data.combat_id;

    if (!combatId || String(combatId).trim() === "") {
      return failure("initiative_initialize_failed", "combat_id is required");
    }

    const combat = this.combats.get(String(combatId));
    if (!combat) {
      return failure("initiative_initialize_failed", "combat not found", {
        combat_id: String(combatId)
      });
    }

    const resolved = resolveInitiativeOrder({
      combat_state: combat,
      roll_function: data.roll_function
    });

    if (!resolved.ok) {
      return failure("initiative_initialize_failed", resolved.error, resolved.payload);
    }

    const updatedCombat = resolved.payload.combat;
    this.combats.set(String(combatId), updatedCombat);

    return success("initiative_initialized", {
      combat_id: String(combatId),
      initiative_order: clone(updatedCombat.initiative_order),
      initiative_entries: clone(resolved.payload.initiative_entries),
      combat: clone(updatedCombat)
    });
  }
}

module.exports = {
  CombatManager
};

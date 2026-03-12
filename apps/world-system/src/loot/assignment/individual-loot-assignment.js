"use strict";

const { resolveLootRoll } = require("../loot-roll.resolver");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateParty(party) {
  if (!party || typeof party !== "object") {
    return "party_object_required";
  }
  if (!party.party_id) {
    return "party_id_required";
  }
  if (!Array.isArray(party.players)) {
    return "party_players_array_required";
  }
  if (party.players.length === 0) {
    return "party_players_empty";
  }
  const hasInvalidPlayer = party.players.some((player) => !player || !player.player_id);
  if (hasInvalidPlayer) {
    return "player_id_required_for_each_party_member";
  }
  return null;
}

function getEligiblePlayers(party, eligiblePlayerIds) {
  const allowed = Array.isArray(eligiblePlayerIds) && eligiblePlayerIds.length > 0
    ? new Set(eligiblePlayerIds.map((x) => String(x)))
    : null;

  return party.players.filter((player) => {
    const baseEligible = player.eligible_for_loot !== false;
    if (!baseEligible) return false;
    if (!allowed) return true;
    return allowed.has(String(player.player_id));
  });
}

/**
 * Generate loot independently for each eligible player.
 * No inventory mutation is performed here.
 */
function assignIndividualLoot(input) {
  const data = input || {};
  const party = data.party;
  const source_type = data.source_type;
  const source_id = data.source_id;
  const loot_table_id = data.loot_table_id;
  const context = data.context || {};
  const lootTableManager = data.lootTableManager;

  if (!lootTableManager || typeof lootTableManager.getLootTable !== "function") {
    return {
      ok: false,
      event_type: "individual_loot_assignment_failed",
      payload: {
        reason: "loot_table_manager_required"
      }
    };
  }
  if (!source_type || !source_id || !loot_table_id) {
    return {
      ok: false,
      event_type: "individual_loot_assignment_failed",
      payload: {
        reason: "source_type_source_id_and_loot_table_id_required"
      }
    };
  }

  const partyValidationError = validateParty(party);
  if (partyValidationError) {
    return {
      ok: false,
      event_type: "individual_loot_assignment_failed",
      payload: {
        reason: partyValidationError
      }
    };
  }

  const eligiblePlayers = getEligiblePlayers(party, data.eligible_player_ids);
  const eligibleSet = new Set(eligiblePlayers.map((p) => String(p.player_id)));
  const ineligiblePlayers = party.players
    .filter((player) => !eligibleSet.has(String(player.player_id)))
    .map((player) => String(player.player_id));

  const perPlayerResults = eligiblePlayers.map((player) => {
    const rng =
      typeof data.rngByPlayerId === "function"
        ? data.rngByPlayerId(player.player_id)
        : data.rng;

    const resolved = resolveLootRoll({
      source_type,
      source_id,
      loot_table_id,
      context: {
        ...context,
        party_id: party.party_id,
        player_id: player.player_id
      },
      roll_count: data.roll_count,
      include_weighted: data.include_weighted,
      rng,
      lootTableManager
    });

    if (!resolved.ok) {
      return {
        ok: false,
        event_type: "loot_generation_failed",
        player_id: String(player.player_id),
        party_id: String(party.party_id),
        reason: resolved.reason || "loot_roll_failed"
      };
    }

    // Clone to keep each player's payload isolated in memory.
    const payloadCopy = clone(resolved.payload);
    payloadCopy.player_id = String(player.player_id);
    payloadCopy.party_id = String(party.party_id);

    return {
      ok: true,
      event_type: "loot_generated",
      player_id: String(player.player_id),
      party_id: String(party.party_id),
      loot_payload: payloadCopy
    };
  });

  const successCount = perPlayerResults.filter((x) => x.ok).length;
  const failureCount = perPlayerResults.length - successCount;
  const status =
    failureCount === 0 ? "success" : successCount > 0 ? "partial_success" : "failure";

  return {
    ok: status !== "failure",
    event_type: "individual_loot_assignment_completed",
    payload: {
      source_type,
      source_id,
      loot_table_id,
      party_id: String(party.party_id),
      assignment_mode: "individual",
      totals: {
        party_size: party.players.length,
        eligible_players: eligiblePlayers.length,
        ineligible_players: ineligiblePlayers.length,
        generated_success: successCount,
        generated_failed: failureCount
      },
      ineligible_player_ids: ineligiblePlayers,
      per_player_results: perPlayerResults,
      status,
      generated_at: new Date().toISOString()
    }
  };
}

module.exports = {
  assignIndividualLoot
};


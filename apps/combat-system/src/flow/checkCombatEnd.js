"use strict";

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

function checkCombatEnd(input) {
  const data = input || {};
  const combatManager = data.combatManager;
  const combatId = data.combat_id;

  if (!combatManager) {
    return failure("combat_end_check_failed", "combatManager is required");
  }
  if (!combatId || String(combatId).trim() === "") {
    return failure("combat_end_check_failed", "combat_id is required");
  }

  const found = combatManager.getCombatById(combatId);
  if (!found.ok) {
    return failure("combat_end_check_failed", "combat not found", {
      combat_id: String(combatId)
    });
  }

  const combat = clone(found.payload.combat);
  if (combat.status === "complete") {
    return success("combat_already_completed", {
      combat_id: String(combatId),
      combat: clone(combat)
    });
  }

  const participants = Array.isArray(combat.participants) ? combat.participants : [];

  const livingByTeam = {};
  for (const participant of participants) {
    const hp = Number.isFinite(participant.current_hp) ? participant.current_hp : 0;
    if (hp <= 0) continue;

    const team = participant.team ? String(participant.team) : "neutral";
    if (!livingByTeam[team]) {
      livingByTeam[team] = [];
    }
    livingByTeam[team].push(participant);
  }

  const livingTeams = Object.keys(livingByTeam);
  if (livingTeams.length > 1) {
    return success("combat_continues", {
      combat_id: String(combatId),
      living_teams: livingTeams,
      living_team_count: livingTeams.length
    });
  }

  const winnerTeam = livingTeams[0] || null;
  const winners = winnerTeam ? livingByTeam[winnerTeam] : [];

  combat.status = "complete";
  combat.event_log = Array.isArray(combat.event_log) ? combat.event_log : [];
  combat.event_log.push({
    event_type: "combat_completed",
    timestamp: new Date().toISOString(),
    details: {
      winner_team: winnerTeam,
      winner_participant_ids: winners.map((p) => p.participant_id)
    }
  });
  combat.updated_at = new Date().toISOString();
  combatManager.combats.set(String(combatId), combat);

  return success("combat_completed", {
    combat_id: String(combatId),
    winner_team: winnerTeam,
    winner_participants: winners.map((p) => ({
      participant_id: p.participant_id,
      name: p.name,
      team: p.team,
      current_hp: p.current_hp
    })),
    combat: clone(combat)
  });
}

module.exports = {
  checkCombatEnd
};

"use strict";

const { DungeonSessionManager } = require("../manager/dungeon-session-manager");
const { createRoom } = require("../models/dungeon-room.model");
const { createChallenge } = require("../models/dungeon-challenge.model");
const { InMemoryChallengeStore, resolveChallenge } = require("../resolvers/challenge.resolver");
const { moveParty } = require("../movement/party-movement");
const { resolveRoomEntry } = require("../resolvers/room-entry.resolver");
const { checkDungeonCompletion } = require("../validators/dungeon-completion.validator");
const { onBossDefeated, onDungeonCompleted } = require("../hooks/reward-triggers.hooks");

class DungeonSimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.manager = new DungeonSessionManager();
    this.challengeStore = new InMemoryChallengeStore();
    this.logs = [];
    this.step = 0;
  }

  log(kind, data) {
    this.step += 1;
    this.logs.push({
      step: this.step,
      kind,
      timestamp: new Date().toISOString(),
      data
    });
  }

  createMockParty() {
    return [
      { player_id: "player-leader", name: "Aria", role: "leader" },
      { player_id: "player-002", name: "Bram", role: "member" },
      { player_id: "player-003", name: "Cyra", role: "member" }
    ];
  }

  generateMockDungeon() {
    const rooms = [
      createRoom({
        room_id: "room-entrance",
        room_type: "empty_room",
        description: "The dungeon entrance hall.",
        exits: [{ direction: "north", to_room_id: "room-challenge", locked: false }],
        discovered: true
      }),
      createRoom({
        room_id: "room-challenge",
        room_type: "challenge",
        description: "A sealed gate blocks the way.",
        challenge_id: "challenge-gate-001",
        exits: [{ direction: "north", to_room_id: "room-boss", locked: false }]
      }),
      createRoom({
        room_id: "room-boss",
        room_type: "boss_room",
        description: "The boss chamber.",
        encounter_id: "encounter-boss-001",
        exits: []
      })
    ];

    const challenge = createChallenge({
      challenge_id: "challenge-gate-001",
      description: "Unlock the sealed gate.",
      difficulty: "medium",
      solutions: ["lockpick", "force", "spell", "use_item"],
      success_result: {
        status: "success",
        message: "The gate unlocks."
      },
      failure_result: {
        status: "failure",
        message: "The gate remains closed."
      }
    });

    this.challengeStore.save(challenge);

    return {
      floor_number: 1,
      rooms,
      objectives: [
        {
          objective_id: "objective-main-001",
          description: "Defeat the boss and clear the dungeon",
          completed: false
        }
      ]
    };
  }

  updateRoomStatus(sessionId, roomId, patch) {
    return this.manager.updateDungeonSession(sessionId, (session) => ({
      ...session,
      rooms: session.rooms.map((room) => (room.room_id === roomId ? { ...room, ...patch } : room))
    }));
  }

  run() {
    const party = this.createMockParty();
    const dungeon = this.generateMockDungeon();

    const session = this.manager.createDungeonSession({
      session_id: this.options.session_id || `session-sim-${Date.now()}`,
      party_id: "party-sim-001",
      dungeon_type: "crypt",
      floor_number: dungeon.floor_number,
      current_room_id: "room-entrance",
      rooms: dungeon.rooms,
      encounters: [{ encounter_id: "encounter-boss-001", type: "boss", status: "active" }],
      completed_rooms: [],
      session_status: "active",
      leader_id: party[0].player_id,
      movement_locked: false,
      final_room_id: "room-boss",
      objectives: dungeon.objectives
    });

    this.log("session_created", {
      session_id: session.session_id,
      party_id: session.party_id,
      leader_id: session.leader_id,
      party
    });

    this.log("dungeon_generated", {
      floor_number: dungeon.floor_number,
      rooms: dungeon.rooms.map((room) => ({
        room_id: room.room_id,
        room_type: room.room_type,
        exits: room.exits
      }))
    });

    const entryRoom = this.manager
      .getDungeonSession(session.session_id)
      .rooms.find((room) => room.room_id === "room-entrance");
    this.log("room_entry", resolveRoomEntry({ session, room: entryRoom }));

    const moveToChallenge = moveParty({
      manager: this.manager,
      session_id: session.session_id,
      destination_room: "room-challenge",
      player_id: party[0].player_id
    });
    this.log("party_movement", moveToChallenge);

    const challengeSessionState = this.manager.getDungeonSession(session.session_id);
    const challengeRoom = challengeSessionState.rooms.find((room) => room.room_id === "room-challenge");
    const challengeRoomEntry = resolveRoomEntry({ session: challengeSessionState, room: challengeRoom });
    this.log("room_entry", challengeRoomEntry);

    const challengeResult = resolveChallenge("challenge-gate-001", "lockpick", {
      challenge_store: this.challengeStore
    });
    this.log("challenge_resolved", challengeResult);

    if (challengeResult.ok && challengeResult.payload.matched_solution) {
      this.updateRoomStatus(session.session_id, "room-challenge", { cleared: true, discovered: true });
      this.manager.updateDungeonSession(session.session_id, (state) => ({
        ...state,
        objectives: state.objectives.map((objective) =>
          objective.objective_id === "objective-main-001"
            ? { ...objective, completed: true }
            : objective
        ),
        objective_completed: true
      }));
      this.log("challenge_applied", {
        room_id: "room-challenge",
        cleared: true
      });
    }

    const moveToBoss = moveParty({
      manager: this.manager,
      session_id: session.session_id,
      destination_room: "room-boss",
      player_id: party[0].player_id
    });
    this.log("party_movement", moveToBoss);

    const bossSessionState = this.manager.getDungeonSession(session.session_id);
    const bossRoom = bossSessionState.rooms.find((room) => room.room_id === "room-boss");
    const bossEntry = resolveRoomEntry({ session: bossSessionState, room: bossRoom });
    this.log("room_entry", bossEntry);

    this.updateRoomStatus(session.session_id, "room-boss", { cleared: true, discovered: true });
    const bossAppliedState = this.manager.updateDungeonSession(session.session_id, (state) => ({
      ...state,
      boss_defeated: true,
      final_room_cleared: true,
      encounters: state.encounters.map((encounter) =>
        encounter.encounter_id === "encounter-boss-001"
          ? { ...encounter, status: "defeated" }
          : encounter
      )
    }));

    this.log("boss_defeated", {
      session_id: bossAppliedState.session_id,
      boss_room_id: "room-boss",
      reward_trigger: onBossDefeated({
        session_id: bossAppliedState.session_id,
        party_id: bossAppliedState.party_id,
        player_id: party[0].player_id,
        source_id: "encounter-boss-001"
      })
    });

    const completionResult = checkDungeonCompletion(session.session_id, {
      manager: this.manager
    });
    this.log("dungeon_completion_checked", completionResult);

    if (completionResult.ok && completionResult.payload.is_complete) {
      this.log("dungeon_completed", {
        session_id: session.session_id,
        reward_trigger: onDungeonCompleted({
          session_id: session.session_id,
          party_id: session.party_id,
          player_id: party[0].player_id,
          source_id: "dungeon-crypt-001"
        })
      });
    }

    return {
      ok: true,
      session_id: session.session_id,
      logs: this.logs
    };
  }
}

if (require.main === module) {
  const result = new DungeonSimulationRunner().run();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  DungeonSimulationRunner
};


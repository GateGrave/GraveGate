"use strict";

const assert = require("assert");
const { createEvent, EVENT_TYPES } = require("../../../../packages/shared-types");
const { mapSlashCommandToGatewayEvent } = require("../../../gateway/src/discord/commandEventMapper");
const { createReadCommandRuntime } = require("../readCommandRuntime");
const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { SessionPersistenceBridge } = require("../../../dungeon-exploration/src/session.persistence");
const { DungeonSessionManagerCore } = require("../../../dungeon-exploration/src/core/dungeonSessionManager");
const { createRoomObject } = require("../../../dungeon-exploration/src/rooms/roomModel");
const { CombatManager } = require("../../../combat-system/src/core/combatManager");
const { CombatPersistenceBridge } = require("../../../combat-system/src/combat.persistence");
const { PartyPersistenceBridge } = require("../../../world-system/src/party/party.persistence");
const { PartyService } = require("../../../world-system/src/party/party.service");

function runTest(name, fn, results) {
  return Promise.resolve()
    .then(fn)
    .then(function onPass() {
      results.push({ name, ok: true });
    })
    .catch(function onFail(error) {
      results.push({ name, ok: false, reason: error.message });
    });
}

function createInteraction(commandName, optionsData, playerId) {
  return {
    commandName,
    user: { id: playerId || "player-multi-001" },
    guildId: "guild-multi-001",
    channelId: "channel-multi-001",
    options: {
      data: Array.isArray(optionsData) ? optionsData : []
    }
  };
}

function mapInteractionOrThrow(interaction) {
  const mapped = mapSlashCommandToGatewayEvent(interaction);
  if (!mapped.ok) {
    throw new Error(mapped.error || "failed to map interaction");
  }
  return mapped.payload.event;
}

function findResponse(result, responseType) {
  const responses = result.payload.responses || [];
  return responses.find(function findByType(event) {
    return event && event.payload && event.payload.response_type === responseType;
  });
}

function createRuntimeContext() {
  const adapter = createInMemoryAdapter();
  const sessionPersistence = new SessionPersistenceBridge({ adapter });
  const sessionManager = new DungeonSessionManagerCore();
  const combatManager = new CombatManager();
  const combatPersistence = new CombatPersistenceBridge({ adapter });
  const partyPersistence = new PartyPersistenceBridge({ adapter });
  const partyService = new PartyService({ partyPersistence });
  const runtime = createReadCommandRuntime({
    sessionPersistence,
    sessionManager,
    combatManager,
    combatPersistence,
    partyPersistence,
    partyService
  });

  return {
    adapter,
    runtime,
    partyService,
    sessionManager,
    sessionPersistence,
    combatManager
  };
}

async function runMultiplayerFoundationRuntimeTests() {
  const results = [];

  await runTest("party_session_join_and_non_member_rejection", async () => {
    const ctx = createRuntimeContext();
    const leaderId = "player-multi-leader-001";
    const memberId = "player-multi-member-001";
    const outsiderId = "player-multi-outsider-001";
    const dungeonId = "dungeon-multi-001";
    const partyId = "party-multi-001";

    const createdParty = ctx.partyService.createParty({
      party_id: partyId,
      leader_player_id: leaderId
    });
    assert.equal(createdParty.ok, true);
    assert.equal(
      ctx.partyService
        .inviteMember({
          party_id: partyId,
          acting_player_id: leaderId,
          target_player_id: memberId
        })
        .ok,
      true
    );
    assert.equal(
      ctx.partyService.joinParty({
        party_id: partyId,
        player_id: memberId
      }).ok,
      true
    );

    const leaderEnter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: dungeonId },
              { name: "party_id", value: partyId }
            ]
          }
        ], leaderId)
      )
    );
    const leaderResponse = findResponse(leaderEnter, "dungeon_enter");
    assert.equal(leaderResponse.payload.ok, true);
    assert.equal(leaderResponse.payload.data.enter_status, "created");

    const sessionId = leaderResponse.payload.data.session.session_id;
    ctx.sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-multi-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-multi-B" }]
        }),
        createRoomObject({
          room_id: "room-multi-B",
          room_type: "empty",
          exits: [{ direction: "west", to_room_id: "room-multi-A" }]
        })
      ]
    });
    ctx.sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-multi-A"
    });
    ctx.sessionPersistence.saveSession(ctx.sessionManager.getSessionById(sessionId).payload.session);

    const memberEnter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: dungeonId },
              { name: "party_id", value: partyId }
            ]
          }
        ], memberId)
      )
    );
    const memberResponse = findResponse(memberEnter, "dungeon_enter");
    assert.equal(memberResponse.payload.ok, true);
    assert.equal(
      ["joined_existing", "already_exists"].includes(String(memberResponse.payload.data.enter_status)),
      true
    );

    const loadedSession = ctx.sessionPersistence.loadSessionById(sessionId);
    assert.equal(loadedSession.ok, true);
    const members = loadedSession.payload.session.party.members.map((entry) =>
      String(entry && entry.player_id ? entry.player_id : entry)
    );
    assert.equal(members.includes(leaderId), true);
    assert.equal(members.includes(memberId), true);

    const memberMove = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("move", [
          { name: "direction", value: "east" },
          { name: "session_id", value: sessionId }
        ], memberId)
      )
    );
    const memberMoveResponse = findResponse(memberMove, "move");
    assert.equal(memberMoveResponse.payload.ok, true);

    const outsiderMove = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("move", [
          { name: "direction", value: "west" },
          { name: "session_id", value: sessionId }
        ], outsiderId)
      )
    );
    const outsiderMoveResponse = findResponse(outsiderMove, "move");
    assert.equal(outsiderMoveResponse.payload.ok, false);
    assert.equal(outsiderMoveResponse.payload.error, "player is not a participant in this session");
  }, results);

  await runTest("shared_combat_actor_ownership_and_isolation", async () => {
    const ctx = createRuntimeContext();
    const leaderId = "player-multi-combat-leader-001";
    const memberId = "player-multi-combat-member-001";
    const outsiderId = "player-multi-combat-outsider-001";
    const partyId = "party-multi-combat-001";

    ctx.partyService.createParty({
      party_id: partyId,
      leader_player_id: leaderId
    });
    ctx.partyService.inviteMember({
      party_id: partyId,
      acting_player_id: leaderId,
      target_player_id: memberId
    });
    ctx.partyService.joinParty({
      party_id: partyId,
      player_id: memberId
    });

    const leaderEnter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: "dungeon-multi-combat-001" },
              { name: "party_id", value: partyId }
            ]
          }
        ], leaderId)
      )
    );
    const sessionId = findResponse(leaderEnter, "dungeon_enter").payload.data.session.session_id;
    ctx.sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-combat-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-combat-B" }]
        }),
        createRoomObject({
          room_id: "room-combat-B",
          room_type: "encounter",
          encounter: {
            combat_id: "combat-multi-owned-001",
            monster_id: "monster-multi-owned-001"
          },
          exits: [{ direction: "west", to_room_id: "room-combat-A" }]
        })
      ]
    });
    ctx.sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-combat-A"
    });
    ctx.sessionPersistence.saveSession(ctx.sessionManager.getSessionById(sessionId).payload.session);

    await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: "dungeon-multi-combat-001" },
              { name: "party_id", value: partyId }
            ]
          }
        ], memberId)
      )
    );

    const movedToEncounter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("move", [
          { name: "direction", value: "east" },
          { name: "session_id", value: sessionId }
        ], leaderId)
      )
    );
    const moveResponse = findResponse(movedToEncounter, "move");
    assert.equal(moveResponse.payload.ok, true);

    const listedParticipants = ctx.combatManager.listParticipants("combat-multi-owned-001");
    assert.equal(listedParticipants.ok, true);
    const players = listedParticipants.payload.participants.filter((entry) => String(entry.team || "") === "party");
    assert.equal(players.length, 2);
    assert.equal(
      players.every((entry) => String(entry.metadata && entry.metadata.owner_player_id || "") === String(entry.participant_id || "")),
      true
    );

    const outsiderAttack = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("attack", [
          { name: "target_id", value: "monster-multi-owned-001" },
          { name: "combat_id", value: "combat-multi-owned-001" }
        ], outsiderId)
      )
    );
    const outsiderAttackResponse = findResponse(outsiderAttack, "attack");
    assert.equal(outsiderAttackResponse.payload.ok, false);
    assert.equal(outsiderAttackResponse.payload.error, "participant not found in combat");

    const crossActorAttack = await ctx.runtime.processGatewayReadCommandEvent(
      createEvent(
        EVENT_TYPES.PLAYER_ATTACK,
        {
          target_id: "monster-multi-owned-001",
          actor_id: leaderId
        },
        {
          source: "gateway.discord",
          target_system: "combat_system",
          player_id: memberId,
          combat_id: "combat-multi-owned-001"
        }
      )
    );
    const crossActorResponse = findResponse(crossActorAttack, "attack");
    assert.equal(crossActorResponse.payload.ok, false);
    assert.equal(crossActorResponse.payload.error, "player is not authorized to control this combat participant");

    const otherCombat = "combat-multi-owned-002";
    ctx.combatManager.createCombat({ combat_id: otherCombat, status: "pending" });
    ctx.combatManager.addParticipant({
      combat_id: otherCombat,
      participant: {
        participant_id: "player-unrelated-001",
        team: "party",
        armor_class: 10,
        current_hp: 5,
        max_hp: 5,
        attack_bonus: 1,
        damage: 1,
        metadata: { owner_player_id: "player-unrelated-001" }
      }
    });
    const isolated = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("attack", [
          { name: "target_id", value: "player-unrelated-001" },
          { name: "combat_id", value: otherCombat }
        ], leaderId)
      )
    );
    const isolatedResponse = findResponse(isolated, "attack");
    assert.equal(isolatedResponse.payload.ok, false);
    assert.equal(isolatedResponse.payload.error, "participant not found in combat");
  }, results);

  await runTest("duplicate_session_attachment_and_ended_session_reject_multiplayer_actions", async () => {
    const ctx = createRuntimeContext();
    const leaderId = "player-multi-ended-leader-001";
    const memberId = "player-multi-ended-member-001";
    const partyId = "party-multi-ended-001";
    const dungeonId = "dungeon-multi-ended-001";

    ctx.partyService.createParty({
      party_id: partyId,
      leader_player_id: leaderId
    });
    ctx.partyService.inviteMember({
      party_id: partyId,
      acting_player_id: leaderId,
      target_player_id: memberId
    });
    ctx.partyService.joinParty({
      party_id: partyId,
      player_id: memberId
    });

    const leaderEnter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: dungeonId },
              { name: "party_id", value: partyId }
            ]
          }
        ], leaderId)
      )
    );
    const sessionId = findResponse(leaderEnter, "dungeon_enter").payload.data.session.session_id;

    ctx.sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-ended-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-ended-B" }]
        }),
        createRoomObject({
          room_id: "room-ended-B",
          room_type: "empty",
          exits: [{ direction: "west", to_room_id: "room-ended-A" }]
        })
      ]
    });
    ctx.sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-ended-A"
    });
    ctx.sessionPersistence.saveSession(ctx.sessionManager.getSessionById(sessionId).payload.session);

    const memberEnterOne = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: dungeonId },
              { name: "party_id", value: partyId }
            ]
          }
        ], memberId)
      )
    );
    const memberEnterTwo = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: dungeonId },
              { name: "party_id", value: partyId }
            ]
          }
        ], memberId)
      )
    );

    assert.equal(findResponse(memberEnterOne, "dungeon_enter").payload.ok, true);
    assert.equal(findResponse(memberEnterTwo, "dungeon_enter").payload.ok, true);
    const loadedSession = ctx.sessionPersistence.loadSessionById(sessionId);
    assert.equal(loadedSession.ok, true);
    const sessionMembers = loadedSession.payload.session.party.members.map((entry) =>
      String(entry && entry.player_id ? entry.player_id : entry)
    );
    assert.equal(sessionMembers.filter((id) => id === memberId).length, 1);

    const sessionSnapshot = ctx.sessionManager.getSessionById(sessionId).payload.session;
    sessionSnapshot.status = "completed";
    ctx.sessionManager.sessions.set(sessionId, sessionSnapshot);
    ctx.sessionPersistence.saveSession(sessionSnapshot);

    const endedSessionMove = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("move", [
          { name: "direction", value: "east" },
          { name: "session_id", value: sessionId }
        ], memberId)
      )
    );
    const endedSessionMoveResponse = findResponse(endedSessionMove, "move");
    assert.equal(endedSessionMoveResponse.payload.ok, false);
    assert.equal(endedSessionMoveResponse.payload.error, "session is not active");
  }, results);

  await runTest("ended_combat_rejects_multiplayer_actions_even_for_valid_members", async () => {
    const ctx = createRuntimeContext();
    const leaderId = "player-multi-ended-combat-leader-001";
    const memberId = "player-multi-ended-combat-member-001";
    const partyId = "party-multi-ended-combat-001";

    ctx.partyService.createParty({
      party_id: partyId,
      leader_player_id: leaderId
    });
    ctx.partyService.inviteMember({
      party_id: partyId,
      acting_player_id: leaderId,
      target_player_id: memberId
    });
    ctx.partyService.joinParty({
      party_id: partyId,
      player_id: memberId
    });

    const leaderEnter = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: "dungeon-multi-ended-combat-001" },
              { name: "party_id", value: partyId }
            ]
          }
        ], leaderId)
      )
    );
    const sessionId = findResponse(leaderEnter, "dungeon_enter").payload.data.session.session_id;
    ctx.sessionManager.addMultipleRoomsToSession({
      session_id: sessionId,
      rooms: [
        createRoomObject({
          room_id: "room-ended-combat-A",
          room_type: "empty",
          exits: [{ direction: "east", to_room_id: "room-ended-combat-B" }]
        }),
        createRoomObject({
          room_id: "room-ended-combat-B",
          room_type: "encounter",
          encounter: {
            combat_id: "combat-multi-ended-001",
            monster_id: "monster-multi-ended-001"
          },
          exits: [{ direction: "west", to_room_id: "room-ended-combat-A" }]
        })
      ]
    });
    ctx.sessionManager.setStartRoom({
      session_id: sessionId,
      room_id: "room-ended-combat-A"
    });
    ctx.sessionPersistence.saveSession(ctx.sessionManager.getSessionById(sessionId).payload.session);

    await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("dungeon", [
          {
            type: 1,
            name: "enter",
            options: [
              { name: "dungeon_id", value: "dungeon-multi-ended-combat-001" },
              { name: "party_id", value: partyId }
            ]
          }
        ], memberId)
      )
    );

    const moved = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("move", [
          { name: "direction", value: "east" },
          { name: "session_id", value: sessionId }
        ], leaderId)
      )
    );
    assert.equal(findResponse(moved, "move").payload.ok, true);

    const loadedCombat = ctx.combatManager.getCombatById("combat-multi-ended-001");
    assert.equal(loadedCombat.ok, true);
    const combat = loadedCombat.payload.combat;
    combat.status = "complete";
    ctx.combatManager.combats.set("combat-multi-ended-001", combat);

    const endedCombatAttack = await ctx.runtime.processGatewayReadCommandEvent(
      mapInteractionOrThrow(
        createInteraction("attack", [
          { name: "target_id", value: "monster-multi-ended-001" },
          { name: "combat_id", value: "combat-multi-ended-001" }
        ], memberId)
      )
    );
    const endedCombatAttackResponse = findResponse(endedCombatAttack, "attack");
    assert.equal(endedCombatAttackResponse.payload.ok, false);
    assert.equal(endedCombatAttackResponse.payload.error, "combat is not active");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  runMultiplayerFoundationRuntimeTests()
    .then(function done(summary) {
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    })
    .catch(function failed(error) {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runMultiplayerFoundationRuntimeTests
};

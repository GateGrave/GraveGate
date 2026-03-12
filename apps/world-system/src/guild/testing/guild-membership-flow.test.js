"use strict";

const assert = require("assert");
const {
  GuildManager,
  InMemoryGuildStore,
  InMemoryGuildInviteStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  declineGuildInvite,
  leaveGuild,
  kickGuildMember,
  promoteGuildOfficer,
  demoteGuildOfficer,
  transferGuildLeadership
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createGuildManager() {
  return new GuildManager({
    store: new InMemoryGuildStore()
  });
}

function createSeedGuild(manager) {
  return manager.createGuild({
    guild_id: "guild-001",
    guild_name: "Iron Wolves",
    guild_tag: "IWLF",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002", "player-003"],
    guild_level: 1,
    guild_xp: 0,
    guild_status: "active"
  });
}

function runGuildMembershipFlowTests() {
  const results = [];

  runTest("valid_invite_flow", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    const out = inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-002",
      target_player_id: "player-004"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "guild_member_invited");
  }, results);

  runTest("accept_invite", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-004"
    });
    const out = acceptGuildInvite({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      player_id: "player-004"
    });

    assert.equal(out.ok, true);
    assert.equal(guildManager.getGuild("guild-001").member_ids.includes("player-004"), true);
  }, results);

  runTest("decline_invite", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-005"
    });
    const out = declineGuildInvite({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      player_id: "player-005"
    });

    assert.equal(out.ok, true);
    assert.equal(inviteStore.loadInvite("guild-001", "player-005"), null);
  }, results);

  runTest("leave_guild", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);

    const out = leaveGuild({
      guildManager,
      guild_id: "guild-001",
      player_id: "player-003"
    });

    assert.equal(out.ok, true);
    assert.equal(guildManager.getGuild("guild-001").member_ids.includes("player-003"), false);
  }, results);

  runTest("kick_member_with_valid_permissions", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);

    const out = kickGuildMember({
      guildManager,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-003"
    });

    assert.equal(out.ok, true);
    assert.equal(guildManager.getGuild("guild-001").member_ids.includes("player-003"), false);
  }, results);

  runTest("officer_promotion_demotion", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);

    const promoted = promoteGuildOfficer({
      guildManager,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-003"
    });
    const demoted = demoteGuildOfficer({
      guildManager,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-003"
    });

    assert.equal(promoted.ok, true);
    assert.equal(demoted.ok, true);
    assert.equal(guildManager.getGuild("guild-001").officer_ids.includes("player-003"), false);
  }, results);

  runTest("leadership_transfer", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);

    const out = transferGuildLeadership({
      guildManager,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-002"
    });

    assert.equal(out.ok, true);
    assert.equal(guildManager.getGuild("guild-001").leader_id, "player-002");
  }, results);

  runTest("invalid_permission_rejection", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    const invite = inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-003",
      target_player_id: "player-010"
    });
    const kick = kickGuildMember({
      guildManager,
      guild_id: "guild-001",
      acting_player_id: "player-003",
      target_player_id: "player-002"
    });

    assert.equal(invite.ok, false);
    assert.equal(kick.ok, false);
    assert.equal(invite.payload.reason, "insufficient_permissions");
    assert.equal(kick.payload.reason, "insufficient_permissions");
  }, results);

  runTest("duplicate_invite_handling", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    const first = inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-004"
    });
    const second = inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      acting_player_id: "player-001",
      target_player_id: "player-004"
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.payload.reason, "duplicate_invite");
  }, results);

  runTest("invalid_membership_state_handling", () => {
    const guildManager = createGuildManager();
    createSeedGuild(guildManager);
    const inviteStore = new InMemoryGuildInviteStore();

    const acceptMissing = acceptGuildInvite({
      guildManager,
      inviteStore,
      guild_id: "guild-001",
      player_id: "player-404"
    });
    const leaveMissing = leaveGuild({
      guildManager,
      guild_id: "guild-001",
      player_id: "player-404"
    });

    assert.equal(acceptMissing.ok, false);
    assert.equal(acceptMissing.payload.reason, "invite_not_found");
    assert.equal(leaveMissing.ok, false);
    assert.equal(leaveMissing.payload.reason, "target_not_member");
  }, results);

  const passed = results.filter((x) => x.ok).length;
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
  const summary = runGuildMembershipFlowTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGuildMembershipFlowTests
};


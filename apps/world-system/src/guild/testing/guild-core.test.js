"use strict";

const assert = require("assert");
const {
  GuildManager,
  InMemoryGuildStore,
  createGuildRecord
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManager() {
  return new GuildManager({
    store: new InMemoryGuildStore()
  });
}

function baseGuild(overrides) {
  return {
    guild_id: "guild-001",
    guild_name: "Iron Wolves",
    guild_tag: "IWLF",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002", "player-003"],
    guild_level: 1,
    guild_xp: 0,
    guild_status: "active",
    ...(overrides || {})
  };
}

function runGuildCoreTests() {
  const results = [];

  runTest("guild_creation", () => {
    const manager = createManager();
    const created = manager.createGuild(baseGuild());
    assert.equal(created.guild_id, "guild-001");
    assert.equal(created.guild_name, "Iron Wolves");
  }, results);

  runTest("fetch_guild", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    const loaded = manager.getGuild("guild-001");
    assert.ok(loaded);
    assert.equal(loaded.guild_tag, "IWLF");
  }, results);

  runTest("update_guild", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    const updated = manager.updateGuild("guild-001", {
      guild_name: "Iron Wolves Prime",
      guild_level: 2,
      guild_xp: 150
    });

    assert.equal(updated.guild_name, "Iron Wolves Prime");
    assert.equal(updated.guild_level, 2);
    assert.equal(updated.guild_xp, 150);
  }, results);

  runTest("delete_guild", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    const deleted = manager.deleteGuild("guild-001");
    const loaded = manager.getGuild("guild-001");
    assert.equal(deleted, true);
    assert.equal(loaded, null);
  }, results);

  runTest("list_members", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    const members = manager.listGuildMembers("guild-001");
    assert.equal(members.length, 3);
    assert.ok(members.includes("player-003"));
  }, results);

  runTest("list_officers", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    const officers = manager.listGuildOfficers("guild-001");
    assert.equal(officers.length, 1);
    assert.equal(officers[0], "player-002");
  }, results);

  runTest("malformed_guild_rejection", () => {
    assert.throws(() => createGuildRecord({}), /guild_id/);
    assert.throws(() => createGuildRecord(baseGuild({ guild_name: "" })), /guild_name/);
    assert.throws(() => createGuildRecord(baseGuild({ guild_tag: "" })), /guild_tag/);
  }, results);

  runTest("duplicate_guild_id_handling", () => {
    const manager = createManager();
    manager.createGuild(baseGuild());
    assert.throws(() => manager.createGuild(baseGuild({ guild_name: "Duplicate" })), /unique guild_id/);
  }, results);

  runTest("invalid_leader_member_structure_handling", () => {
    assert.throws(
      () =>
        createGuildRecord(
          baseGuild({
            leader_id: "player-leader-missing",
            member_ids: ["player-002", "player-003"]
          })
        ),
      /leader_id must be included/
    );
    assert.throws(
      () =>
        createGuildRecord(
          baseGuild({
            officer_ids: ["player-not-member"],
            member_ids: ["player-001", "player-002"]
          })
        ),
      /officer_ids must all be included/
    );
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
  const summary = runGuildCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGuildCoreTests
};


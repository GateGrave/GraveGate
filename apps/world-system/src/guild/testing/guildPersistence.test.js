"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { GuildPersistenceBridge } = require("../guild.persistence");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function buildGuild(overrides) {
  return {
    guild_id: "guild-persist-001",
    guild_name: "Persistence Wardens",
    guild_tag: "PWRD",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002"],
    guild_level: 1,
    guild_xp: 0,
    guild_status: "active",
    ...(overrides || {})
  };
}

function runGuildPersistenceTests() {
  const results = [];

  runTest("guild_creation_and_lookup", () => {
    const bridge = new GuildPersistenceBridge({ adapter: createInMemoryAdapter() });
    const saved = bridge.saveGuild(buildGuild());
    assert.equal(saved.ok, true);
    assert.equal(saved.event_type, "guild_persistence_saved");

    const loaded = bridge.loadGuildById("guild-persist-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.guild.guild_name, "Persistence Wardens");
  }, results);

  runTest("guild_membership_persists_after_update", () => {
    const bridge = new GuildPersistenceBridge({ adapter: createInMemoryAdapter() });
    bridge.saveGuild(buildGuild());
    bridge.saveGuild(
      buildGuild({
        member_ids: ["player-001", "player-002", "player-003"],
        officer_ids: ["player-002", "player-003"]
      })
    );

    const loaded = bridge.loadGuildById("guild-persist-001");
    assert.equal(loaded.ok, true);
    assert.equal(loaded.payload.guild.member_ids.includes("player-003"), true);
    assert.equal(loaded.payload.guild.officer_ids.includes("player-003"), true);
  }, results);

  runTest("guild_delete_and_missing_lookup", () => {
    const bridge = new GuildPersistenceBridge({ adapter: createInMemoryAdapter() });
    bridge.saveGuild(buildGuild());

    const deleted = bridge.deleteGuild("guild-persist-001");
    assert.equal(deleted.ok, true);
    assert.equal(deleted.payload.deleted, true);

    const missing = bridge.loadGuildById("guild-persist-001");
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "guild not found");
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: { total: results.length, passed, failed },
    results
  };
}

if (require.main === module) {
  const summary = runGuildPersistenceTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runGuildPersistenceTests
};


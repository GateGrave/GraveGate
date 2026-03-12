"use strict";

const assert = require("assert");
const {
  GuildManager,
  InMemoryGuildStore,
  GuildStorageManager,
  InMemoryGuildStorageStore
} = require("../../guild");
const {
  RaidManager,
  InMemoryRaidStore
} = require("../../raid");
const {
  WorldEventManager,
  InMemoryWorldEventStore
} = require("../../world-events");
const {
  ContractHuntBoardManager,
  InMemoryContractStore,
  HunterAssociationManager,
  InMemoryHunterAssociationStore
} = require("../../hunter-association");
const {
  RankingManager,
  InMemoryRankingStore
} = require("../../ranking");
const {
  createAdvancedSystemsSnapshot,
  restoreAdvancedSystemsSnapshot
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagers() {
  const guildManager = new GuildManager({ store: new InMemoryGuildStore() });
  const guildStorageManager = new GuildStorageManager({ store: new InMemoryGuildStorageStore() });
  const raidManager = new RaidManager({ store: new InMemoryRaidStore() });
  const worldEventManager = new WorldEventManager({ store: new InMemoryWorldEventStore() });
  const contractManager = new ContractHuntBoardManager({ store: new InMemoryContractStore() });
  const hunterAssociationManager = new HunterAssociationManager({ store: new InMemoryHunterAssociationStore() });
  const rankingManager = new RankingManager({ store: new InMemoryRankingStore() });

  guildManager.createGuild({
    guild_id: "guild-001",
    guild_name: "Iron Wolves",
    guild_tag: "IWLF",
    leader_id: "player-001",
    officer_ids: ["player-002"],
    member_ids: ["player-001", "player-002", "player-003"],
    guild_level: 2,
    guild_xp: 140
  });

  guildStorageManager.saveGuildStorage({
    guild_id: "guild-001",
    storage_items: [{ item_id: "item-ore", quantity: 12 }]
  });

  raidManager.createRaidInstance({
    raid_id: "raid-001",
    raid_name: "Vault of Ash",
    participating_party_ids: ["party-001"],
    participating_player_ids: ["player-001", "player-002"],
    raid_state: { stage: "entry" },
    encounter_state: { encounter_id: "enc-001", status: "pending" },
    raid_status: "pending"
  });

  worldEventManager.createWorldEvent({
    event_id: "world-event-001",
    event_name: "Moon Hunt",
    event_type: "global_hunt",
    event_scope: "global",
    event_state: { status: "active" },
    start_time: "2026-03-01T00:00:00.000Z",
    end_time: "2026-03-31T23:59:59.000Z",
    participation_rules: {},
    reward_rules: {},
    active_flag: true
  });

  contractManager.createContract({
    contract_id: "contract-001",
    contract_type: "hunt_monster",
    target_data: { target_id: "enemy-001", required_kills: 1 },
    reward_data: { gold: 100 },
    expiry: "2026-12-31T23:59:59.000Z"
  });

  hunterAssociationManager.createHunterAssociation({
    association_id: "assoc-001",
    hunter_profiles: {},
    rank_tiers: ["F", "E", "D"],
    active_contracts: [{ contract_id: "contract-001", contract_status: "active" }],
    completed_contracts: []
  });
  hunterAssociationManager.createHunterProfile({
    association_id: "assoc-001",
    player_id: "player-001",
    hunter_name: "Ranker One",
    rank_tier: "F"
  });

  rankingManager.createRankingEntry({
    ranking_id: "rank-001",
    ranking_type: "hunter",
    entity_id: "player-001",
    score_value: 80
  });

  return {
    guildManager,
    guildStorageManager,
    raidManager,
    worldEventManager,
    contractManager,
    hunterAssociationManager,
    rankingManager
  };
}

function listGuilds(manager) {
  return manager.store.list().map((x) => JSON.parse(JSON.stringify(x)));
}

function listGuildStorages(manager) {
  return Array.from(manager.store.storages.values()).map((x) => JSON.parse(JSON.stringify(x)));
}

function listRaids(manager) {
  return manager.store.list().map((x) => JSON.parse(JSON.stringify(x)));
}

function listWorldEvents(manager) {
  return manager.store.list().map((x) => JSON.parse(JSON.stringify(x)));
}

function listContracts(manager) {
  return manager.store.list().map((x) => JSON.parse(JSON.stringify(x)));
}

function listHunterAssociations(manager) {
  return Array.from(manager.store.associations.values()).map((x) => JSON.parse(JSON.stringify(x)));
}

function listRankings(manager) {
  return manager.store.list().map((x) => JSON.parse(JSON.stringify(x)));
}

function runAdvancedSystemsSnapshotRecoveryTests() {
  const results = [];

  runTest("snapshot_creation", () => {
    const managers = createManagers();
    const out = createAdvancedSystemsSnapshot(managers);

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "advanced_systems_snapshot_created");
    assert.equal(Array.isArray(out.payload.guild_state), true);
    assert.equal(Array.isArray(out.payload.guild_storage_state), true);
    assert.equal(Array.isArray(out.payload.raid_instance_state), true);
    assert.equal(Array.isArray(out.payload.world_event_state), true);
    assert.equal(Array.isArray(out.payload.contract_state), true);
    assert.equal(Array.isArray(out.payload.hunter_association_state), true);
    assert.equal(Array.isArray(out.payload.ranking_state), true);
  }, results);

  runTest("restore_snapshot", () => {
    const source = createManagers();
    const snapshot = createAdvancedSystemsSnapshot(source);

    const target = createManagers();
    target.guildManager.updateGuild("guild-001", { guild_level: 99 });
    target.raidManager.updateRaidInstance("raid-001", { raid_status: "active" });

    const restored = restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      ...target
    });

    assert.equal(restored.ok, true);
    assert.equal(restored.event_type, "advanced_systems_snapshot_restored");
  }, results);

  runTest("restored_guilds_match_original_state", () => {
    const source = createManagers();
    const snapshot = createAdvancedSystemsSnapshot(source);

    const target = createManagers();
    target.guildManager.updateGuild("guild-001", { guild_level: 5, guild_xp: 999 });

    restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      ...target
    });

    assert.equal(JSON.stringify(listGuilds(target.guildManager)), JSON.stringify(listGuilds(source.guildManager)));
    assert.equal(
      JSON.stringify(listGuildStorages(target.guildStorageManager)),
      JSON.stringify(listGuildStorages(source.guildStorageManager))
    );
  }, results);

  runTest("restored_raids_events_contracts_match_original_state", () => {
    const source = createManagers();
    const snapshot = createAdvancedSystemsSnapshot(source);

    const target = createManagers();
    target.raidManager.updateRaidInstance("raid-001", { raid_status: "cancelled" });
    target.worldEventManager.closeWorldEvent("world-event-001");
    target.contractManager.expireContract({ contract_id: "contract-001" });

    restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      ...target
    });

    assert.equal(JSON.stringify(listRaids(target.raidManager)), JSON.stringify(listRaids(source.raidManager)));
    assert.equal(
      JSON.stringify(listWorldEvents(target.worldEventManager)),
      JSON.stringify(listWorldEvents(source.worldEventManager))
    );
    assert.equal(
      JSON.stringify(listContracts(target.contractManager)),
      JSON.stringify(listContracts(source.contractManager))
    );
  }, results);

  runTest("restored_hunter_associations_and_rankings_match_original_state", () => {
    const source = createManagers();
    const snapshot = createAdvancedSystemsSnapshot(source);

    const target = createManagers();
    target.hunterAssociationManager.updateHunterProfile("assoc-001", "player-001", { rank_tier: "D" });
    target.rankingManager.updateRankingScore({
      ranking_id: "rank-001",
      score_value: 999,
      reason: "test_mutation"
    });

    restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      ...target
    });

    assert.equal(
      JSON.stringify(listHunterAssociations(target.hunterAssociationManager)),
      JSON.stringify(listHunterAssociations(source.hunterAssociationManager))
    );
    assert.equal(JSON.stringify(listRankings(target.rankingManager)), JSON.stringify(listRankings(source.rankingManager)));
  }, results);

  runTest("malformed_snapshot_handling", () => {
    const managers = createManagers();
    const bad1 = restoreAdvancedSystemsSnapshot({
      snapshot: null,
      ...managers
    });
    const bad2 = restoreAdvancedSystemsSnapshot({
      snapshot: { guild_state: [] },
      ...managers
    });

    assert.equal(bad1.ok, false);
    assert.equal(bad1.payload.reason, "snapshot_object_required");
    assert.equal(bad2.ok, false);
    assert.equal(bad2.payload.reason, "snapshot_missing_required_arrays");
  }, results);

  runTest("no_cross_system_contamination", () => {
    const managers = createManagers();
    const unrelated = {
      combat: { combat_id: "combat-001", status: "active" },
      dungeon: { session_id: "session-001", floor: 3 },
      economy: { account_count: 4 },
      crafting: { active_jobs: 2 }
    };
    const before = JSON.stringify(unrelated);

    const snapshot = createAdvancedSystemsSnapshot(managers);
    restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      ...managers
    });

    const after = JSON.stringify(unrelated);
    assert.equal(after, before);
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
  const summary = runAdvancedSystemsSnapshotRecoveryTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAdvancedSystemsSnapshotRecoveryTests
};

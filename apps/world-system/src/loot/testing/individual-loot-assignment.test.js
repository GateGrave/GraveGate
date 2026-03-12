"use strict";

const assert = require("assert");
const {
  LootTableManager,
  InMemoryLootTableStore,
  createExampleLootTables,
  assignIndividualLoot
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createManagerWithEnemyTable() {
  const manager = new LootTableManager({
    store: new InMemoryLootTableStore()
  });
  const examples = createExampleLootTables();
  manager.createLootTable(examples.normal_enemy);
  return manager;
}

function buildParty(overrides) {
  return {
    party_id: "party-001",
    players: [
      { player_id: "char-001", eligible_for_loot: true },
      { player_id: "char-002", eligible_for_loot: true },
      { player_id: "char-003", eligible_for_loot: true }
    ],
    ...(overrides || {})
  };
}

function runIndividualLootAssignmentTests() {
  const results = [];

  runTest("each_eligible_player_gets_independent_loot_result", () => {
    const manager = createManagerWithEnemyTable();
    const out = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: buildParty(),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "individual_loot_assignment_completed");
    assert.equal(out.payload.per_player_results.length, 3);
    assert.ok(out.payload.per_player_results.every((x) => x.ok && x.event_type === "loot_generated"));
  }, results);

  runTest("one_players_result_does_not_overwrite_another", () => {
    const manager = createManagerWithEnemyTable();
    const out = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: buildParty(),
      lootTableManager: manager
    });

    const first = out.payload.per_player_results[0];
    const second = out.payload.per_player_results[1];
    assert.ok(first && second);
    assert.notStrictEqual(first.loot_payload, second.loot_payload);

    const secondBefore = JSON.stringify(second.loot_payload.all_drops);
    first.loot_payload.all_drops.push({
      item_id: "item-test-mutation",
      quantity: 1,
      rarity: "common",
      drop_type: "weighted",
      quantity_roll: null
    });
    const secondAfter = JSON.stringify(second.loot_payload.all_drops);
    assert.equal(secondAfter, secondBefore);
  }, results);

  runTest("ineligible_player_receives_no_loot", () => {
    const manager = createManagerWithEnemyTable();
    const out = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: buildParty({
        players: [
          { player_id: "char-001", eligible_for_loot: true },
          { player_id: "char-002", eligible_for_loot: false },
          { player_id: "char-003", eligible_for_loot: true }
        ]
      }),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.per_player_results.length, 2);
    assert.ok(out.payload.ineligible_player_ids.includes("char-002"));
    const generatedPlayerIds = out.payload.per_player_results.map((x) => x.player_id);
    assert.equal(generatedPlayerIds.includes("char-002"), false);
  }, results);

  runTest("single_player_party_still_works", () => {
    const manager = createManagerWithEnemyTable();
    const out = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: buildParty({
        party_id: "party-single-001",
        players: [{ player_id: "char-single", eligible_for_loot: true }]
      }),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.per_player_results.length, 1);
    assert.equal(out.payload.per_player_results[0].player_id, "char-single");
  }, results);

  runTest("malformed_party_data_fails_safely", () => {
    const manager = createManagerWithEnemyTable();

    const noParty = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      lootTableManager: manager
    });
    const noPartyId = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: { players: [{ player_id: "char-001" }] },
      lootTableManager: manager
    });
    const badPlayers = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: { party_id: "party-bad", players: "not-an-array" },
      lootTableManager: manager
    });

    assert.equal(noParty.ok, false);
    assert.equal(noParty.event_type, "individual_loot_assignment_failed");
    assert.equal(noParty.payload.reason, "party_object_required");

    assert.equal(noPartyId.ok, false);
    assert.equal(noPartyId.payload.reason, "party_id_required");

    assert.equal(badPlayers.ok, false);
    assert.equal(badPlayers.payload.reason, "party_players_array_required");
  }, results);

  runTest("payload_structure_valid_for_multiple_players", () => {
    const manager = createManagerWithEnemyTable();
    const out = assignIndividualLoot({
      source_type: "enemy",
      source_id: "goblin",
      loot_table_id: "table-enemy-goblin-001",
      party: buildParty(),
      lootTableManager: manager
    });

    assert.equal(out.ok, true);
    assert.equal(typeof out.payload.party_id, "string");
    assert.equal(out.payload.assignment_mode, "individual");
    assert.ok(Array.isArray(out.payload.per_player_results));

    out.payload.per_player_results.forEach((row) => {
      assert.equal(typeof row.player_id, "string");
      assert.equal(typeof row.party_id, "string");
      assert.ok(row.loot_payload);
      assert.equal(row.loot_payload.player_id, row.player_id);
      assert.equal(row.loot_payload.party_id, row.party_id);
      assert.ok(Array.isArray(row.loot_payload.all_drops));
    });
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
  const summary = runIndividualLootAssignmentTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runIndividualLootAssignmentTests
};


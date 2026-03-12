"use strict";

const assert = require("assert");
const {
  HunterAssociationManager,
  InMemoryHunterAssociationStore,
  createHunterAssociationRecord
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
  return new HunterAssociationManager({
    store: new InMemoryHunterAssociationStore()
  });
}

function baseAssociation(overrides) {
  return {
    association_id: "assoc-001",
    hunter_profiles: {},
    rank_tiers: ["E", "D", "C", "B", "A", "S"],
    active_contracts: [
      {
        contract_id: "contract-001",
        contract_name: "Goblin Cleanup",
        contract_status: "active"
      }
    ],
    completed_contracts: [
      {
        contract_id: "contract-old-001",
        contract_name: "Wolf Hunt",
        contract_status: "completed"
      }
    ],
    ...(overrides || {})
  };
}

function baseProfile(overrides) {
  return {
    association_id: "assoc-001",
    player_id: "player-001",
    hunter_name: "Iris",
    rank_tier: "E",
    ...(overrides || {})
  };
}

function runHunterAssociationCoreTests() {
  const results = [];

  runTest("hunter_profile_creation", () => {
    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());
    const created = manager.createHunterProfile(baseProfile());
    assert.equal(created.player_id, "player-001");
    assert.equal(created.rank_tier, "E");
  }, results);

  runTest("fetch_update_profile", () => {
    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());
    manager.createHunterProfile(baseProfile());

    const loaded = manager.getHunterProfile("assoc-001", "player-001");
    assert.ok(loaded);
    assert.equal(loaded.hunter_name, "Iris");

    const updated = manager.updateHunterProfile("assoc-001", "player-001", {
      rank_tier: "D",
      hunter_name: "Iris Prime"
    });
    assert.equal(updated.rank_tier, "D");
    assert.equal(updated.hunter_name, "Iris Prime");
  }, results);

  runTest("active_contract_listing", () => {
    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());

    const active = manager.listActiveContracts("assoc-001");
    assert.equal(active.length, 1);
    assert.equal(active[0].contract_id, "contract-001");
  }, results);

  runTest("completed_contract_listing", () => {
    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());

    const completed = manager.listCompletedContracts("assoc-001");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].contract_id, "contract-old-001");
  }, results);

  runTest("malformed_profile_rejection", () => {
    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());
    assert.throws(() => manager.createHunterProfile({ association_id: "assoc-001" }), /player_id/);
    assert.throws(
      () => manager.createHunterProfile(baseProfile({ player_id: "", rank_tier: "E" })),
      /player_id/
    );
  }, results);

  runTest("invalid_rank_structure_handling", () => {
    assert.throws(
      () =>
        createHunterAssociationRecord(
          baseAssociation({
            rank_tiers: "E,D,C"
          })
        ),
      /rank_tiers must be an array/
    );
    assert.throws(
      () =>
        createHunterAssociationRecord(
          baseAssociation({
            rank_tiers: []
          })
        ),
      /rank_tiers must contain at least one rank/
    );

    const manager = createManager();
    manager.createHunterAssociation(baseAssociation());
    assert.throws(
      () => manager.createHunterProfile(baseProfile({ rank_tier: "Z" })),
      /rank_tier must be defined in association rank_tiers/
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
  const summary = runHunterAssociationCoreTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runHunterAssociationCoreTests
};


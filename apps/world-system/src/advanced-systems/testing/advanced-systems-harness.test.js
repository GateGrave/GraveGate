"use strict";

const assert = require("assert");
const { AdvancedSystemsSimulationRunner } = require("./advanced-systems-simulation-runner");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runAdvancedSystemsHarnessTests() {
  const results = [];

  runTest("successful_end_to_end_guild_flow", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.guild_creation, true);
    assert.equal(out.scenarios.guild_membership_flow, true);
    assert.equal(out.scenarios.guild_progression, true);
  }, results);

  runTest("successful_guild_storage_flow", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.guild_storage_flow, true);
    assert.equal(out.details.storageFlow.deposit.ok, true);
    assert.equal(out.details.storageFlow.withdrawFirst.ok, true);
  }, results);

  runTest("successful_raid_coordination_flow", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.raid_creation, true);
    assert.equal(out.scenarios.multi_party_participation, true);
    assert.equal(out.details.raidFlow.validation.payload.valid, true);
  }, results);

  runTest("successful_world_event_boss_flow", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.world_event_creation, true);
    assert.equal(out.scenarios.world_boss_flow, true);
    assert.equal(out.details.worldEventBossFlow.rewardTrigger.ok, true);
  }, results);

  runTest("successful_contract_claim_completion_flow", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.contract_flow, true);
    assert.equal(out.details.hunterContractFlow.claim.ok, true);
    assert.equal(out.details.hunterContractFlow.complete.ok, true);
  }, results);

  runTest("duplicate_claim_prevention", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.duplicate_claim_prevention, true);
    assert.equal(out.details.hunterContractFlow.claimDuplicate.ok, false);
    assert.equal(out.details.hunterContractFlow.claimDuplicate.payload.reason, "already_claimed");
  }, results);

  runTest("ranking_update_correctness", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.ranking_updates, true);
    assert.equal(out.details.rankingFlow.updatedHunter.score_value, 140);
    assert.equal(out.details.rankingFlow.topHunters[0].entity_id, "player-001");
  }, results);

  runTest("snapshot_restore_correctness", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.snapshot_restore, true);
    assert.equal(out.details.snapshotRestoreFlow.state_comparison.guild_restored, true);
    assert.equal(out.details.snapshotRestoreFlow.state_comparison.raid_restored, true);
    assert.equal(out.details.snapshotRestoreFlow.state_comparison.event_restored, true);
    assert.equal(out.details.snapshotRestoreFlow.state_comparison.contract_restored, true);
  }, results);

  runTest("no_duplicate_rewards_or_item_movement_in_simulation", () => {
    const out = new AdvancedSystemsSimulationRunner().runAllScenarios();
    assert.equal(out.scenarios.no_duplicate_rewards_or_item_movement, true);
    assert.equal(out.details.worldEventBossFlow.duplicate_reward_prevented, true);
    assert.equal(out.details.storageFlow.duplicate_item_movement_prevented, true);
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
  const summary = runAdvancedSystemsHarnessTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runAdvancedSystemsHarnessTests
};


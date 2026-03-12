"use strict";

const assert = require("assert");
const { createInMemoryAdapter } = require("../../../../database/src/adapters/inMemoryAdapter");
const { InventoryPersistenceBridge } = require("../../../../inventory-system/src/inventory.persistence");
const { CharacterPersistenceBridge } = require("../../character/character.persistence");
const {
  ContractHuntBoardManager,
  InMemoryContractStore,
  createContractRecord,
  ProcessedContractRewardStore,
  processContractCompletionReward
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
  return new ContractHuntBoardManager({
    store: new InMemoryContractStore()
  });
}

function baseContract(overrides) {
  return {
    contract_id: "contract-001",
    contract_type: "hunt_monster",
    target_data: {
      target_id: "enemy-wolf-alpha",
      required_kills: 1
    },
    reward_data: {
      gold: 150,
      xp: 60
    },
    claim_state: "unclaimed",
    claimed_by: null,
    completion_state: "incomplete",
    expiry: "2026-12-31T23:59:59.000Z",
    ...(overrides || {})
  };
}

function createInventory(ownerId) {
  return {
    inventory_id: "inv-" + ownerId,
    owner_type: "player",
    owner_id: ownerId,
    stackable_items: [],
    equipment_items: [],
    quest_items: [],
    currency: { gold: 0, silver: 0, copper: 0 },
    metadata: {}
  };
}

function runContractHuntBoardSystemTests() {
  const results = [];

  runTest("contract_creation", () => {
    const manager = createManager();
    const created = manager.createContract(baseContract());
    assert.equal(created.contract_id, "contract-001");
    assert.equal(created.claim_state, "unclaimed");
  }, results);

  runTest("successful_claim", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    const claim = manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.event_type, "contract_claimed");
    assert.equal(claim.payload.claimed_by, "player-001");
  }, results);

  runTest("duplicate_claim_rejection", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });
    const duplicate = manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-002"
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.payload.reason, "already_claimed");
  }, results);

  runTest("successful_completion", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });
    const completion = manager.completeContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });

    assert.equal(completion.ok, true);
    assert.equal(completion.event_type, "contract_completed");
    assert.equal(completion.payload.contract.completion_state, "completed");
  }, results);

  runTest("duplicate_completion_rejection", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });
    manager.completeContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });

    const duplicate = manager.completeContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });

    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.payload.reason, "already_completed");
  }, results);

  runTest("expiry_handling", () => {
    const manager = createManager();
    manager.createContract(
      baseContract({
        contract_id: "contract-expiry",
        expiry: "2026-01-01T00:00:00.000Z"
      })
    );
    const claimAfterExpiry = manager.claimContract({
      contract_id: "contract-expiry",
      player_id: "player-001",
      at_time: "2026-02-01T00:00:00.000Z"
    });
    const loaded = manager.getContract("contract-expiry");

    assert.equal(claimAfterExpiry.ok, false);
    assert.equal(claimAfterExpiry.payload.reason, "contract_expired");
    assert.equal(loaded.claim_state, "expired");
    assert.equal(loaded.completion_state, "expired");
  }, results);

  runTest("malformed_contract_rejection", () => {
    assert.throws(() => createContractRecord({}), /contract_id/);
    assert.throws(
      () =>
        createContractRecord(
          baseContract({
            contract_type: ""
          })
        ),
      /contract_type/
    );
    assert.throws(
      () =>
        createContractRecord(
          baseContract({
            target_data: "bad"
          })
        ),
      /target_data must be an object/
    );
  }, results);

  runTest("stale_claimed_state_handling", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    const cancel = manager.cancelContractClaim({
      contract_id: "contract-001",
      player_id: "player-001"
    });
    assert.equal(cancel.ok, false);
    assert.equal(cancel.payload.reason, "stale_claim_state");
  }, results);

  runTest("contract_completion_reward_is_processed_once", () => {
    const manager = createManager();
    manager.createContract(baseContract());
    manager.claimContract({
      contract_id: "contract-001",
      player_id: "player-001"
    });

    const rewardStore = new ProcessedContractRewardStore();
    const first = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-001",
      player_id: "player-001",
      rewardProcessor: function rewardProcessor() {
        return {
          ok: true,
          payload: {
            granted: true
          }
        };
      }
    });

    const second = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-001",
      player_id: "player-001",
      rewardProcessor: function rewardProcessor() {
        return {
          ok: true,
          payload: {
            granted: true
          }
        };
      }
    });

    assert.equal(first.ok, true);
    assert.equal(first.event_type, "contract_reward_processed");
    assert.equal(second.ok, false);
    assert.equal(second.error, "duplicate_contract_reward_claim");
  }, results);

  runTest("contract_completion_reward_uses_canonical_loot_grant_path", () => {
    const manager = createManager();
    const adapter = createInMemoryAdapter();
    const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
    const characterPersistence = new CharacterPersistenceBridge({ adapter });

    characterPersistence.saveCharacter({
      character_id: "char-contract-001",
      player_id: "player-001",
      name: "Contract Tester",
      race: "human",
      class: "fighter",
      background: "mercenary",
      level: 1,
      xp: 0,
      stats: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
      inventory_id: "inv-player-001"
    });
    inventoryPersistence.saveInventory(createInventory("player-001"));

    manager.createContract(baseContract({
      contract_id: "contract-canonical-001",
      reward_data: {
        gold: 150,
        xp: 60,
        items: [{ item_id: "item_contract_claw", quantity: 2 }]
      }
    }));
    manager.claimContract({
      contract_id: "contract-canonical-001",
      player_id: "player-001"
    });

    const out = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: new ProcessedContractRewardStore(),
      contract_id: "contract-canonical-001",
      player_id: "player-001",
      inventory_service: {
        getInventory(id) {
          return inventoryPersistence.loadInventoryById(id);
        },
        saveInventory(inventory) {
          return inventoryPersistence.saveInventory(inventory);
        }
      },
      inventory_id: "inv-player-001",
      owner_id: "player-001",
      characterPersistence
    });

    const inventory = inventoryPersistence.loadInventoryById("inv-player-001");
    const character = characterPersistence.loadCharacterById("char-contract-001");
    assert.equal(out.ok, true);
    assert.equal(inventory.ok, true);
    assert.equal(character.ok, true);
    assert.equal(inventory.payload.inventory.currency.gold, 150);
    assert.equal(character.payload.character.xp, 60);
    assert.equal(
      inventory.payload.inventory.stackable_items.some((entry) => entry.item_id === "item_contract_claw" && entry.quantity === 2),
      true
    );
  }, results);

  runTest("contract_reward_can_retry_after_reward_processor_failure_without_double_grant", () => {
    const manager = createManager();
    let attempts = 0;
    manager.createContract(baseContract({
      contract_id: "contract-retry-001",
      reward_data: { gold: 50 }
    }));
    manager.claimContract({
      contract_id: "contract-retry-001",
      player_id: "player-001"
    });

    const rewardStore = new ProcessedContractRewardStore();
    const first = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-retry-001",
      player_id: "player-001",
      rewardProcessor() {
        attempts += 1;
        return { ok: false };
      }
    });
    const second = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-retry-001",
      player_id: "player-001",
      rewardProcessor() {
        attempts += 1;
        return { ok: true, payload: { granted: true } };
      }
    });

    assert.equal(first.ok, false);
    assert.equal(second.ok, true);
    assert.equal(attempts, 2);
  }, results);

  runTest("completed_contract_reward_cannot_be_regranted_with_alternate_claim_key", () => {
    const manager = createManager();
    manager.createContract(baseContract({
      contract_id: "contract-claim-key-001",
      reward_data: { gold: 25 }
    }));
    manager.claimContract({
      contract_id: "contract-claim-key-001",
      player_id: "player-001"
    });

    const rewardStore = new ProcessedContractRewardStore();
    const first = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-claim-key-001",
      player_id: "player-001",
      claim_key: "custom-claim-a",
      rewardProcessor() {
        return { ok: true, payload: { granted: true } };
      }
    });
    const second = processContractCompletionReward({
      contractManager: manager,
      processedRewardStore: rewardStore,
      contract_id: "contract-claim-key-001",
      player_id: "player-001",
      claim_key: "custom-claim-b",
      rewardProcessor() {
        return { ok: true, payload: { granted: true } };
      }
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.error, "duplicate_contract_reward_claim");
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
  const summary = runContractHuntBoardSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runContractHuntBoardSystemTests
};

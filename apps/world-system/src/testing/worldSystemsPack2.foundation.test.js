"use strict";

const assert = require("assert");
const {
  GuildManager,
  InMemoryGuildStore,
  InMemoryGuildInviteStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  leaveGuild,
  PlayerTradeManager,
  InMemoryPlayerTradeStore,
  upsertRankingScore,
  readRankingBoard,
  ContractHuntBoardManager,
  InMemoryContractStore,
  ProcessedContractRewardStore,
  processContractCompletionReward,
  RaidManager,
  InMemoryRaidStore,
  WorldEventManager,
  InMemoryWorldEventStore
} = require("../index");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runWorldSystemsPack2FoundationTests() {
  const results = [];

  runTest("guild_creation_and_membership_flow", () => {
    const guildManager = new GuildManager({ store: new InMemoryGuildStore() });
    const inviteStore = new InMemoryGuildInviteStore();
    guildManager.createGuild({
      guild_id: "guild-pack2-001",
      guild_name: "Ashen Hunters",
      guild_tag: "ASHN",
      leader_id: "player-001",
      officer_ids: [],
      member_ids: ["player-001"],
      guild_level: 1,
      guild_xp: 0,
      guild_status: "active"
    });

    const invited = inviteMemberToGuild({
      guildManager,
      inviteStore,
      guild_id: "guild-pack2-001",
      acting_player_id: "player-001",
      target_player_id: "player-002"
    });
    assert.equal(invited.ok, true);

    const joined = acceptGuildInvite({
      guildManager,
      inviteStore,
      guild_id: "guild-pack2-001",
      player_id: "player-002"
    });
    assert.equal(joined.ok, true);

    const left = leaveGuild({
      guildManager,
      guild_id: "guild-pack2-001",
      player_id: "player-002"
    });
    assert.equal(left.ok, true);
  }, results);

  runTest("trade_lifecycle_rejects_duplicate_completion", () => {
    const tradeManager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });
    const proposed = tradeManager.proposeTrade({
      trade_id: "trade-pack2-001",
      initiator_player_id: "player-a",
      counterparty_player_id: "player-b",
      offered: { item_id: "item_herb", quantity: 1 },
      requested: {}
    });
    assert.equal(proposed.ok, true);

    const accepted = tradeManager.acceptTrade({
      trade_id: "trade-pack2-001",
      acting_player_id: "player-b",
      seller_inventory: {
        inventory_id: "inv-a",
        owner_type: "player",
        owner_id: "player-a",
        stackable_items: [{ item_id: "item_herb", quantity: 1, stackable: true, owner_player_id: "player-a", metadata: {} }],
        equipment_items: [],
        quest_items: [],
        currency: {},
        metadata: {}
      },
      buyer_inventory: {
        inventory_id: "inv-b",
        owner_type: "player",
        owner_id: "player-b",
        stackable_items: [],
        equipment_items: [],
        quest_items: [],
        currency: {},
        metadata: {}
      }
    });
    assert.equal(accepted.ok, true);

    const duplicate = tradeManager.acceptTrade({
      trade_id: "trade-pack2-001",
      acting_player_id: "player-b",
      seller_inventory: accepted.payload.execution_result.seller_inventory,
      buyer_inventory: accepted.payload.execution_result.buyer_inventory
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error, "trade is not pending");
  }, results);

  runTest("ranking_update_read_path", () => {
    const upsert = upsertRankingScore({
      ranking_type: "hunter",
      entity_id: "player-110",
      score_value: 125
    });
    assert.equal(upsert.ok, true);

    const board = readRankingBoard({
      ranking_type: "hunter",
      limit: 3
    });
    assert.equal(board.ok, true);
    assert.equal(board.payload.rankings.some((entry) => entry.entity_id === "player-110"), true);
  }, results);

  runTest("contract_completion_reward_no_duplicate_grant", () => {
    const contractManager = new ContractHuntBoardManager({ store: new InMemoryContractStore() });
    contractManager.createContract({
      contract_id: "contract-pack2-001",
      contract_type: "hunt_monster",
      target_data: { target_id: "goblin", required_kills: 1 },
      reward_data: { xp: 40, gold: 25 },
      claim_state: "unclaimed",
      completion_state: "incomplete"
    });
    contractManager.claimContract({
      contract_id: "contract-pack2-001",
      player_id: "player-300"
    });

    const rewardStore = new ProcessedContractRewardStore();
    const first = processContractCompletionReward({
      contractManager,
      processedRewardStore: rewardStore,
      contract_id: "contract-pack2-001",
      player_id: "player-300",
      rewardProcessor: () => ({ ok: true, payload: { granted: true } })
    });
    const second = processContractCompletionReward({
      contractManager,
      processedRewardStore: rewardStore,
      contract_id: "contract-pack2-001",
      player_id: "player-300",
      rewardProcessor: () => ({ ok: true, payload: { granted: true } })
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.error, "duplicate_contract_reward_claim");
  }, results);

  runTest("raid_and_world_event_scaffolds_create_and_read", () => {
    const raidManager = new RaidManager({ store: new InMemoryRaidStore() });
    const worldEventManager = new WorldEventManager({ store: new InMemoryWorldEventStore() });

    const raid = raidManager.createRaidInstance({
      raid_id: "raid-pack2-001",
      raid_name: "Frost Crucible",
      participating_party_ids: [],
      participating_player_ids: [],
      raid_state: {},
      encounter_state: {},
      raid_status: "pending"
    });
    const event = worldEventManager.createWorldEvent({
      event_id: "we-pack2-001",
      event_name: "Night of Hunters",
      event_type: "seasonal",
      event_scope: "global",
      event_state: { status: "active" },
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-31T00:00:00.000Z",
      participation_rules: { min_level: 1 },
      reward_rules: { table_id: "table-hunt-001" },
      active_flag: true
    });

    assert.equal(raid.raid_id, "raid-pack2-001");
    assert.equal(event.event_id, "we-pack2-001");
    assert.equal(worldEventManager.getWorldEvent("we-pack2-001").active_flag, true);
  }, results);

  runTest("world_state_entities_are_isolated", () => {
    const guildManager = new GuildManager({ store: new InMemoryGuildStore() });
    guildManager.createGuild({
      guild_id: "guild-pack2-A",
      guild_name: "Guild A",
      guild_tag: "GA",
      leader_id: "leader-A",
      officer_ids: [],
      member_ids: ["leader-A"],
      guild_level: 1,
      guild_xp: 0,
      guild_status: "active"
    });
    guildManager.createGuild({
      guild_id: "guild-pack2-B",
      guild_name: "Guild B",
      guild_tag: "GB",
      leader_id: "leader-B",
      officer_ids: [],
      member_ids: ["leader-B"],
      guild_level: 1,
      guild_xp: 0,
      guild_status: "active"
    });

    const tradeManager = new PlayerTradeManager({ store: new InMemoryPlayerTradeStore() });
    tradeManager.proposeTrade({
      trade_id: "trade-pack2-iso-1",
      initiator_player_id: "leader-A",
      counterparty_player_id: "leader-B",
      offered: { item_id: "item_ore", quantity: 1 },
      requested: {}
    });

    const guildA = guildManager.getGuild("guild-pack2-A");
    const guildB = guildManager.getGuild("guild-pack2-B");
    const tradesA = tradeManager.listTradesByPlayer("leader-A");
    const tradesC = tradeManager.listTradesByPlayer("player-C");

    assert.equal(guildA.member_ids.includes("leader-B"), false);
    assert.equal(guildB.member_ids.includes("leader-A"), false);
    assert.equal(tradesA.length, 1);
    assert.equal(tradesC.length, 0);
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
  const summary = runWorldSystemsPack2FoundationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runWorldSystemsPack2FoundationTests
};


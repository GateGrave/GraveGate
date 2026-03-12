"use strict";

const { InMemoryInventoryStore } = require("../../../../database/src/world-storage");
const {
  GuildManager,
  InMemoryGuildStore,
  GuildStorageManager,
  InMemoryGuildStorageStore,
  InMemoryGuildInviteStore,
  ProcessedGuildStorageWithdrawalStore,
  ProcessedGuildProgressionStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  depositItemToGuildStorage,
  withdrawItemFromGuildStorage,
  addGuildXp
} = require("../../guild");
const {
  RaidManager,
  InMemoryRaidStore,
  joinRaidParty,
  markRaidPartyReady,
  validateMultiPartyParticipation
} = require("../../raid");
const {
  WorldEventManager,
  InMemoryWorldEventStore,
  WorldBossManager,
  InMemoryWorldBossStore,
  ProcessedWorldBossRewardClaimStore,
  registerWorldBossParticipation,
  trackWorldBossContribution,
  markWorldBossDefeated,
  generateWorldBossRewardTrigger,
  claimWorldBossReward
} = require("../../world-events");
const {
  HunterAssociationManager,
  InMemoryHunterAssociationStore,
  ContractHuntBoardManager,
  InMemoryContractStore
} = require("../../hunter-association");
const {
  RankingManager,
  InMemoryRankingStore
} = require("../../ranking");
const {
  createAdvancedSystemsSnapshot,
  restoreAdvancedSystemsSnapshot
} = require("../advanced-systems-snapshot");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function qtyInInventory(inventoryStore, inventoryId, itemId) {
  const inventory = inventoryStore.loadInventory(inventoryId) || { item_entries: [] };
  return (inventory.item_entries || [])
    .filter((x) => x.item_id === itemId)
    .reduce((sum, x) => sum + (Number.isFinite(x.quantity) ? Math.floor(x.quantity) : 0), 0);
}

class AdvancedSystemsSimulationRunner {
  constructor(options) {
    this.options = options || {};
    this.step = 0;
    this.logs = [];

    this.guildManager = new GuildManager({ store: new InMemoryGuildStore() });
    this.guildStorageManager = new GuildStorageManager({ store: new InMemoryGuildStorageStore() });
    this.inviteStore = new InMemoryGuildInviteStore();
    this.inventoryStore = new InMemoryInventoryStore();
    this.processedWithdrawalStore = new ProcessedGuildStorageWithdrawalStore();
    this.processedProgressionStore = new ProcessedGuildProgressionStore();

    this.raidManager = new RaidManager({ store: new InMemoryRaidStore() });

    this.worldEventManager = new WorldEventManager({ store: new InMemoryWorldEventStore() });
    this.worldBossManager = new WorldBossManager({ store: new InMemoryWorldBossStore() });
    this.worldBossRewardClaimStore = new ProcessedWorldBossRewardClaimStore();

    this.hunterAssociationManager = new HunterAssociationManager({
      store: new InMemoryHunterAssociationStore()
    });
    this.contractManager = new ContractHuntBoardManager({ store: new InMemoryContractStore() });
    this.rankingManager = new RankingManager({ store: new InMemoryRankingStore() });
  }

  log(kind, data) {
    this.step += 1;
    this.logs.push({
      step: this.step,
      kind,
      timestamp: new Date().toISOString(),
      data: clone(data)
    });
  }

  setupMocks() {
    this.players = {
      leader: { player_id: "player-001", inventory_id: "inv-player-001" },
      officer: { player_id: "player-002", inventory_id: "inv-player-002" },
      member: { player_id: "player-003", inventory_id: "inv-player-003" },
      recruit: { player_id: "player-004", inventory_id: "inv-player-004" }
    };

    this.guild = this.guildManager.createGuild({
      guild_id: "guild-001",
      guild_name: "Iron Wolves",
      guild_tag: "IWLF",
      leader_id: this.players.leader.player_id,
      officer_ids: [this.players.officer.player_id],
      member_ids: [
        this.players.leader.player_id,
        this.players.officer.player_id,
        this.players.member.player_id
      ],
      guild_level: 1,
      guild_xp: 0
    });
    this.guildStorageManager.ensureGuildStorage(this.guild.guild_id);

    this.inventoryStore.saveInventory({
      inventory_id: this.players.leader.inventory_id,
      owner_character_id: this.players.leader.player_id,
      item_entries: [{ entry_id: "entry-1", item_id: "item-herb", quantity: 6, entry_type: "stackable" }]
    });
    this.inventoryStore.saveInventory({
      inventory_id: this.players.officer.inventory_id,
      owner_character_id: this.players.officer.player_id,
      item_entries: [{ entry_id: "entry-2", item_id: "item-herb", quantity: 1, entry_type: "stackable" }]
    });

    this.raid = this.raidManager.createRaidInstance({
      raid_id: "raid-001",
      raid_name: "Vault of Ash",
      participating_party_ids: [],
      participating_player_ids: [],
      raid_state: {},
      encounter_state: {},
      raid_status: "pending"
    });

    this.worldEvent = this.worldEventManager.createWorldEvent({
      event_id: "world-event-001",
      event_name: "Moonfall Crisis",
      event_type: "world_boss",
      event_scope: "global",
      event_state: { status: "active" },
      start_time: "2026-03-01T00:00:00.000Z",
      end_time: "2026-03-31T23:59:59.000Z",
      participation_rules: {},
      reward_rules: {},
      active_flag: true
    });

    this.association = this.hunterAssociationManager.createHunterAssociation({
      association_id: "assoc-001",
      hunter_profiles: {},
      rank_tiers: ["E", "D", "C", "B", "A", "S"],
      active_contracts: [],
      completed_contracts: []
    });

    this.log("setup_complete", {
      guild_id: this.guild.guild_id,
      raid_id: this.raid.raid_id,
      world_event_id: this.worldEvent.event_id,
      association_id: this.association.association_id
    });
  }

  runGuildFlow() {
    const invite = inviteMemberToGuild({
      guildManager: this.guildManager,
      inviteStore: this.inviteStore,
      guild_id: this.guild.guild_id,
      acting_player_id: this.players.leader.player_id,
      target_player_id: this.players.recruit.player_id
    });
    const accept = acceptGuildInvite({
      guildManager: this.guildManager,
      inviteStore: this.inviteStore,
      guild_id: this.guild.guild_id,
      player_id: this.players.recruit.player_id
    });

    this.log("guild_membership_flow", { invite, accept });
    return { invite, accept };
  }

  runGuildStorageFlow() {
    const deposit = depositItemToGuildStorage({
      guildManager: this.guildManager,
      guildStorageManager: this.guildStorageManager,
      inventoryStore: this.inventoryStore,
      guild_id: this.guild.guild_id,
      acting_player_id: this.players.leader.player_id,
      inventory_id: this.players.leader.inventory_id,
      item_id: "item-herb",
      quantity: 3
    });

    const beforeFirstWithdraw = qtyInInventory(this.inventoryStore, this.players.officer.inventory_id, "item-herb");
    const withdrawFirst = withdrawItemFromGuildStorage({
      guildManager: this.guildManager,
      guildStorageManager: this.guildStorageManager,
      inventoryStore: this.inventoryStore,
      processedWithdrawalStore: this.processedWithdrawalStore,
      guild_id: this.guild.guild_id,
      acting_player_id: this.players.officer.player_id,
      inventory_id: this.players.officer.inventory_id,
      item_id: "item-herb",
      quantity: 1,
      withdrawal_key: "withdraw-001"
    });
    const afterFirstWithdraw = qtyInInventory(this.inventoryStore, this.players.officer.inventory_id, "item-herb");

    const withdrawDuplicate = withdrawItemFromGuildStorage({
      guildManager: this.guildManager,
      guildStorageManager: this.guildStorageManager,
      inventoryStore: this.inventoryStore,
      processedWithdrawalStore: this.processedWithdrawalStore,
      guild_id: this.guild.guild_id,
      acting_player_id: this.players.officer.player_id,
      inventory_id: this.players.officer.inventory_id,
      item_id: "item-herb",
      quantity: 1,
      withdrawal_key: "withdraw-001"
    });
    const afterDuplicateWithdraw = qtyInInventory(this.inventoryStore, this.players.officer.inventory_id, "item-herb");

    this.log("guild_storage_flow", {
      deposit,
      withdraw_first: withdrawFirst,
      withdraw_duplicate: withdrawDuplicate,
      inventory_qty: {
        before_first: beforeFirstWithdraw,
        after_first: afterFirstWithdraw,
        after_duplicate: afterDuplicateWithdraw
      }
    });

    return {
      deposit,
      withdrawFirst,
      withdrawDuplicate,
      duplicate_item_movement_prevented:
        withdrawDuplicate.event_type === "guild_storage_withdraw_skipped" &&
        afterDuplicateWithdraw === afterFirstWithdraw
    };
  }

  runGuildProgressionFlow() {
    const xpGain = addGuildXp({
      guildManager: this.guildManager,
      processedProgressionStore: this.processedProgressionStore,
      guild_id: this.guild.guild_id,
      xp_gain: 180,
      progression_key: "guild-xp-001"
    });
    this.log("guild_progression_flow", xpGain);
    return xpGain;
  }

  runRaidFlow() {
    const joinA = joinRaidParty({
      raidManager: this.raidManager,
      raid_id: this.raid.raid_id,
      party_id: "party-001",
      player_ids: [this.players.leader.player_id, this.players.officer.player_id]
    });
    const joinB = joinRaidParty({
      raidManager: this.raidManager,
      raid_id: this.raid.raid_id,
      party_id: "party-002",
      player_ids: [this.players.member.player_id, this.players.recruit.player_id]
    });
    const readyA = markRaidPartyReady({
      raidManager: this.raidManager,
      raid_id: this.raid.raid_id,
      party_id: "party-001",
      ready: true
    });
    const readyB = markRaidPartyReady({
      raidManager: this.raidManager,
      raid_id: this.raid.raid_id,
      party_id: "party-002",
      ready: true
    });
    const validation = validateMultiPartyParticipation({
      raidManager: this.raidManager,
      raid_id: this.raid.raid_id,
      min_parties: 2
    });

    this.log("raid_coordination_flow", { joinA, joinB, readyA, readyB, validation });
    return { joinA, joinB, readyA, readyB, validation };
  }

  runWorldEventBossFlow() {
    const bind = this.worldBossManager.bindWorldBossToEvent({
      worldEventManager: this.worldEventManager,
      boss_id: "boss-001",
      event_id: this.worldEvent.event_id,
      boss_name: "Abyss Watcher"
    });
    const participationA = registerWorldBossParticipation({
      worldBossManager: this.worldBossManager,
      boss_id: "boss-001",
      player_id: this.players.leader.player_id
    });
    const participationB = registerWorldBossParticipation({
      worldBossManager: this.worldBossManager,
      boss_id: "boss-001",
      player_id: this.players.officer.player_id
    });
    const contribution = trackWorldBossContribution({
      worldBossManager: this.worldBossManager,
      boss_id: "boss-001",
      player_id: this.players.leader.player_id,
      contribution_value: 150
    });
    const defeated = markWorldBossDefeated({
      worldBossManager: this.worldBossManager,
      boss_id: "boss-001"
    });
    const rewardTrigger = generateWorldBossRewardTrigger({
      worldBossManager: this.worldBossManager,
      boss_id: "boss-001"
    });
    const claimOne = claimWorldBossReward({
      worldBossManager: this.worldBossManager,
      rewardClaimStore: this.worldBossRewardClaimStore,
      boss_id: "boss-001",
      player_id: this.players.leader.player_id
    });
    const claimDuplicate = claimWorldBossReward({
      worldBossManager: this.worldBossManager,
      rewardClaimStore: this.worldBossRewardClaimStore,
      boss_id: "boss-001",
      player_id: this.players.leader.player_id
    });

    this.log("world_event_boss_flow", {
      bind,
      participationA,
      participationB,
      contribution,
      defeated,
      rewardTrigger,
      claimOne,
      claimDuplicate
    });

    return {
      bind,
      participationA,
      participationB,
      contribution,
      defeated,
      rewardTrigger,
      claimOne,
      claimDuplicate,
      duplicate_reward_prevented: claimDuplicate.ok === false && claimDuplicate.payload.reason === "duplicate_reward_claim"
    };
  }

  runHunterContractFlow() {
    const profile = this.hunterAssociationManager.createHunterProfile({
      association_id: this.association.association_id,
      player_id: this.players.leader.player_id,
      hunter_name: "Aerin",
      rank_tier: "E"
    });

    const contract = this.contractManager.createContract({
      contract_id: "contract-001",
      contract_type: "hunt_monster",
      target_data: { enemy_id: "enemy-001", required_kills: 1 },
      reward_data: { guild_xp: 30, score: 25 },
      expiry: "2026-12-31T23:59:59.000Z"
    });
    const claim = this.contractManager.claimContract({
      contract_id: contract.contract_id,
      player_id: this.players.leader.player_id
    });
    const claimDuplicate = this.contractManager.claimContract({
      contract_id: contract.contract_id,
      player_id: this.players.officer.player_id
    });
    const complete = this.contractManager.completeContract({
      contract_id: contract.contract_id,
      player_id: this.players.leader.player_id
    });

    this.log("hunter_contract_flow", { profile, contract, claim, claimDuplicate, complete });
    return { profile, contract, claim, claimDuplicate, complete };
  }

  runRankingFlow() {
    const hunterEntry = this.rankingManager.createRankingEntry({
      ranking_id: "rank-hunter-001",
      ranking_type: "hunter",
      entity_id: this.players.leader.player_id,
      score_value: 100
    });
    const guildEntry = this.rankingManager.createRankingEntry({
      ranking_id: "rank-guild-001",
      ranking_type: "guild",
      entity_id: this.guild.guild_id,
      score_value: 50
    });
    const updatedHunter = this.rankingManager.updateRankingScore({
      ranking_id: hunterEntry.ranking_id,
      score_value: 140,
      reason: "contract_completed"
    });
    const topHunters = this.rankingManager.listTopRankings("hunter", 5);

    this.log("ranking_flow", { hunterEntry, guildEntry, updatedHunter, topHunters });
    return { hunterEntry, guildEntry, updatedHunter, topHunters };
  }

  runSnapshotRestoreFlow() {
    const snapshot = createAdvancedSystemsSnapshot({
      guildManager: this.guildManager,
      guildStorageManager: this.guildStorageManager,
      raidManager: this.raidManager,
      worldEventManager: this.worldEventManager,
      contractManager: this.contractManager,
      rankingManager: this.rankingManager
    });

    const guildBefore = this.guildManager.getGuild(this.guild.guild_id);
    const raidBefore = this.raidManager.getRaidInstance(this.raid.raid_id);
    const eventBefore = this.worldEventManager.getWorldEvent(this.worldEvent.event_id);
    const contractBefore = this.contractManager.getContract("contract-001");

    this.guildManager.updateGuild(this.guild.guild_id, { guild_level: 99 });
    this.raidManager.updateRaidInstance(this.raid.raid_id, { raid_status: "cancelled" });
    this.worldEventManager.closeWorldEvent(this.worldEvent.event_id);
    this.contractManager.expireContract({ contract_id: "contract-001" });

    const restore = restoreAdvancedSystemsSnapshot({
      snapshot: snapshot.payload,
      guildManager: this.guildManager,
      guildStorageManager: this.guildStorageManager,
      raidManager: this.raidManager,
      worldEventManager: this.worldEventManager,
      contractManager: this.contractManager
    });

    const guildAfter = this.guildManager.getGuild(this.guild.guild_id);
    const raidAfter = this.raidManager.getRaidInstance(this.raid.raid_id);
    const eventAfter = this.worldEventManager.getWorldEvent(this.worldEvent.event_id);
    const contractAfter = this.contractManager.getContract("contract-001");

    this.log("snapshot_restore_flow", {
      snapshot,
      restore,
      state_comparison: {
        guild_restored: JSON.stringify(guildBefore) === JSON.stringify(guildAfter),
        raid_restored: JSON.stringify(raidBefore) === JSON.stringify(raidAfter),
        event_restored: JSON.stringify(eventBefore) === JSON.stringify(eventAfter),
        contract_restored: JSON.stringify(contractBefore) === JSON.stringify(contractAfter)
      }
    });

    return {
      snapshot,
      restore,
      state_comparison: {
        guild_restored: JSON.stringify(guildBefore) === JSON.stringify(guildAfter),
        raid_restored: JSON.stringify(raidBefore) === JSON.stringify(raidAfter),
        event_restored: JSON.stringify(eventBefore) === JSON.stringify(eventAfter),
        contract_restored: JSON.stringify(contractBefore) === JSON.stringify(contractAfter)
      }
    };
  }

  runAllScenarios() {
    this.setupMocks();

    const guildFlow = this.runGuildFlow();
    const storageFlow = this.runGuildStorageFlow();
    const progressionFlow = this.runGuildProgressionFlow();
    const raidFlow = this.runRaidFlow();
    const worldEventBossFlow = this.runWorldEventBossFlow();
    const hunterContractFlow = this.runHunterContractFlow();
    const rankingFlow = this.runRankingFlow();
    const snapshotRestoreFlow = this.runSnapshotRestoreFlow();

    return {
      ok: true,
      scenarios: {
        guild_creation: true,
        guild_membership_flow: guildFlow.invite.ok && guildFlow.accept.ok,
        guild_storage_flow: storageFlow.deposit.ok && storageFlow.withdrawFirst.ok,
        guild_progression: progressionFlow.ok,
        raid_creation: true,
        multi_party_participation: raidFlow.validation.ok && raidFlow.validation.payload.valid === true,
        world_event_creation: true,
        world_boss_flow:
          worldEventBossFlow.bind.ok &&
          worldEventBossFlow.defeated.ok &&
          worldEventBossFlow.rewardTrigger.ok,
        hunter_profile_creation: Boolean(hunterContractFlow.profile?.player_id),
        contract_flow: hunterContractFlow.claim.ok && hunterContractFlow.complete.ok,
        ranking_updates: rankingFlow.updatedHunter.score_value === 140,
        snapshot_restore: snapshotRestoreFlow.restore.ok,
        duplicate_claim_prevention:
          hunterContractFlow.claimDuplicate.ok === false &&
          hunterContractFlow.claimDuplicate.payload.reason === "already_claimed",
        no_duplicate_rewards_or_item_movement:
          worldEventBossFlow.duplicate_reward_prevented === true &&
          storageFlow.duplicate_item_movement_prevented === true
      },
      details: {
        guildFlow,
        storageFlow,
        progressionFlow,
        raidFlow,
        worldEventBossFlow,
        hunterContractFlow,
        rankingFlow,
        snapshotRestoreFlow
      },
      logs: this.logs
    };
  }
}

if (require.main === module) {
  const result = new AdvancedSystemsSimulationRunner().runAllScenarios();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  AdvancedSystemsSimulationRunner
};


"use strict";

const {
  HUNTER_ASSOCIATION_SCHEMA,
  createHunterAssociationRecord,
  createHunterProfileRecord
} = require("./hunter-association.schema");
const {
  InMemoryHunterAssociationStore,
  HunterAssociationManager
} = require("./hunter-association.manager");
const {
  CONTRACT_SCHEMA,
  VALID_CLAIM_STATES,
  VALID_COMPLETION_STATES,
  InMemoryContractStore,
  ContractHuntBoardManager,
  createContractRecord,
  isContractExpired
} = require("./contract-hunt-board.system");
const {
  ProcessedContractRewardStore,
  processContractCompletionReward
} = require("./contract-reward.flow");

const defaultHunterAssociationManager = new HunterAssociationManager();
const defaultContractHuntBoardManager = new ContractHuntBoardManager();

function createHunterAssociation(input) {
  return defaultHunterAssociationManager.createHunterAssociation(input);
}

function getHunterAssociation(association_id) {
  return defaultHunterAssociationManager.getHunterAssociation(association_id);
}

function updateHunterAssociation(association_id, updater) {
  return defaultHunterAssociationManager.updateHunterAssociation(association_id, updater);
}

function createHunterProfile(input) {
  return defaultHunterAssociationManager.createHunterProfile(input);
}

function getHunterProfile(association_id, player_id) {
  return defaultHunterAssociationManager.getHunterProfile(association_id, player_id);
}

function updateHunterProfile(association_id, player_id, updater) {
  return defaultHunterAssociationManager.updateHunterProfile(association_id, player_id, updater);
}

function listActiveContracts(association_id) {
  return defaultHunterAssociationManager.listActiveContracts(association_id);
}

function listCompletedContracts(association_id) {
  return defaultHunterAssociationManager.listCompletedContracts(association_id);
}

function createContract(input) {
  return defaultContractHuntBoardManager.createContract(input);
}

function getContract(contract_id) {
  return defaultContractHuntBoardManager.getContract(contract_id);
}

function claimContract(input) {
  return defaultContractHuntBoardManager.claimContract(input);
}

function cancelContractClaim(input) {
  return defaultContractHuntBoardManager.cancelClaim(input);
}

function completeContract(input) {
  return defaultContractHuntBoardManager.completeContract(input);
}

function expireContract(input) {
  return defaultContractHuntBoardManager.expireContract(input);
}

module.exports = {
  HUNTER_ASSOCIATION_SCHEMA,
  createHunterAssociationRecord,
  createHunterProfileRecord,
  InMemoryHunterAssociationStore,
  HunterAssociationManager,
  defaultHunterAssociationManager,
  CONTRACT_SCHEMA,
  VALID_CLAIM_STATES,
  VALID_COMPLETION_STATES,
  InMemoryContractStore,
  ContractHuntBoardManager,
  defaultContractHuntBoardManager,
  createContractRecord,
  isContractExpired,
  createHunterAssociation,
  getHunterAssociation,
  updateHunterAssociation,
  createHunterProfile,
  getHunterProfile,
  updateHunterProfile,
  listActiveContracts,
  listCompletedContracts,
  createContract,
  getContract,
  claimContract,
  cancelContractClaim,
  completeContract,
  expireContract,
  ProcessedContractRewardStore,
  processContractCompletionReward
};

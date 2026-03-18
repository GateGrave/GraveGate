"use strict";

const {
  COMBAT_STATE_SCHEMA,
  isCombatStateShapeValid
} = require("./schema/combat-state.schema");
const { createCombatModel } = require("./core/combatModel");
const { CombatManager } = require("./core/combatManager");
const { resolveInitiativeOrder } = require("./initiative/initiativeResolver");
const { startCombat } = require("./flow/startCombat");
const { nextTurn } = require("./flow/nextTurn");
const { checkCombatEnd } = require("./flow/checkCombatEnd");
const {
  processCombatAttackRequest,
  processCombatHelpRequest,
  processCombatReadyRequest,
  processCombatDashRequest,
  processCombatGrappleRequest,
  processCombatEscapeGrappleRequest,
  processCombatShoveRequest,
  processCombatDisengageRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest
} = require("./flow/processCombatActionRequest");
const { renderCombatById } = require("./flow/renderCombatState");
const { renderCombatMapFromState, LAYER_ORDER } = require("./render/combatMapRenderer");
const { performAttackAction } = require("./actions/attackAction");
const { performMoveAction } = require("./actions/moveAction");
const { performHelpAction } = require("./actions/helpAction");
const { performReadyAction } = require("./actions/readyAction");
const { performDisengageAction } = require("./actions/disengageAction");
const { performDodgeAction } = require("./actions/dodgeAction");
const { performDashAction } = require("./actions/dashAction");
const { performGrappleAction } = require("./actions/grappleAction");
const { performEscapeGrappleAction } = require("./actions/escapeGrappleAction");
const { performShoveAction } = require("./actions/shoveAction");
const { useItemAction } = require("./actions/useItemAction");
const {
  createCombatId,
  createCombatInstance
} = require("./factory/create-combat-instance");
const { CombatRegistry } = require("./registry/combat-registry");
const {
  lockCombatInstance,
  unlockCombatInstance,
  isCombatInstanceLocked
} = require("./locks/combat-lock");
const { processCombatEventSafe } = require("./processing/process-combat-event-safe");
const {
  rollD20,
  rollInitiativeForParticipant,
  rollInitiativeForAllParticipants,
  sortParticipantsIntoInitiativeOrder,
  initializeInitiativeState,
  advanceToNextTurn
} = require("./initiative");
const {
  resolveTurnStarted,
  processTurnStartedEvent,
  resolveMovement,
  processMovementEvent
} = require("./resolvers");
const {
  MAX_GRID_SIZE,
  TILE_SIZE_FEET,
  createBattlefieldTile,
  createBattlefieldGrid,
  getTileIndex,
  isWithinBounds,
  getTileAt,
  setTileAt
} = require("./battlefield");
const { getTileMovementCostFeet } = require("./movement/movement-cost");
const {
  ACTION_TYPES,
  validateCombatAction,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect
} = require("./validation");
const {
  parseDiceFormula,
  rollDie,
  rollDiceFormula,
  ROLL_TYPES,
  resolveDiceRoll,
  rollAttackRoll,
  rollSavingThrow,
  rollAbilityCheck,
  rollSkillCheck,
  rollDamageRoll,
  rollHealingRoll,
  rollDeathSave
} = require("./dice");
const {
  DAMAGE_TYPES,
  getCharacterDamageProfile,
  applyVulnerability,
  applyResistance,
  applyImmunity,
  resolveDamagePipeline,
  applyDamageToCombatState
} = require("./damage");
const {
  isConcentrating,
  getConcentrationDC,
  resolveConcentrationSave,
  removeConcentrationEffects,
  resolveConcentrationOnDamage
} = require("./concentration");
const {
  REACTION_TRIGGER_TYPES,
  REACTION_EVENT_TYPES,
  ReactionRegistry,
  OPPORTUNITY_ATTACK,
  COUNTERSPELL_REACTION,
  PROTECT_ALLY_REACTION,
  createDefaultReactionDefinitions,
  createDefaultReactionRegistry,
  detectReactionTrigger,
  buildReactionWindow,
  waitForReactionDecision,
  consumeReactionAvailability,
  runReactionEngine,
  processReactionTriggerEvent
} = require("./reactions");
const {
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect,
  addEffect,
  removeEffect,
  updateEffectDuration,
  processTurnEffectsByTiming,
  processStartOfTurnEffects,
  processEndOfTurnEffects
} = require("./status-effects");
const {
  LIFE_STATES,
  createDefaultDeathSaves,
  applyDownedState,
  resolveDeathSave,
  stabilizeCharacter,
  markCharacterDead
} = require("./death-downed");
const {
  resolveCombatTurn,
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout
} = require("./turn");
const {
  COMBAT_SNAPSHOT_SCHEMA,
  createCombatSnapshot,
  CombatSnapshotStore
} = require("./snapshots");
const { CombatPersistenceBridge } = require("./combat.persistence");
const {
  CombatSimulationRunner,
  createMockCombatants,
  buildMockMoveEvent,
  buildMockAttackActionPayload,
  buildMockReactionTriggerEvent,
  buildMockTurnEvent
} = require("./testing");

module.exports = {
  COMBAT_STATE_SCHEMA,
  isCombatStateShapeValid,
  createCombatModel,
  CombatManager,
  resolveInitiativeOrder,
  startCombat,
  nextTurn,
  checkCombatEnd,
  processCombatAttackRequest,
  processCombatHelpRequest,
  processCombatReadyRequest,
  processCombatDashRequest,
  processCombatGrappleRequest,
  processCombatEscapeGrappleRequest,
  processCombatShoveRequest,
  processCombatDisengageRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest,
  renderCombatById,
  renderCombatMapFromState,
  LAYER_ORDER,
  performAttackAction,
  performMoveAction,
  performHelpAction,
  performReadyAction,
  performDisengageAction,
  performDodgeAction,
  performDashAction,
  performGrappleAction,
  performEscapeGrappleAction,
  performShoveAction,
  useItemAction,
  createCombatId,
  createCombatInstance,
  CombatRegistry,
  lockCombatInstance,
  unlockCombatInstance,
  isCombatInstanceLocked,
  processCombatEventSafe,
  rollD20,
  rollInitiativeForParticipant,
  rollInitiativeForAllParticipants,
  sortParticipantsIntoInitiativeOrder,
  initializeInitiativeState,
  advanceToNextTurn,
  resolveTurnStarted,
  processTurnStartedEvent,
  resolveMovement,
  processMovementEvent,
  MAX_GRID_SIZE,
  TILE_SIZE_FEET,
  createBattlefieldTile,
  createBattlefieldGrid,
  getTileIndex,
  isWithinBounds,
  getTileAt,
  setTileAt,
  getTileMovementCostFeet,
  ACTION_TYPES,
  validateCombatAction,
  validateTargetExists,
  validateTargetInRange,
  validateTargetValidForAction,
  validateTileReachable,
  validateActionAvailability,
  validateLineOfEffect,
  parseDiceFormula,
  rollDie,
  rollDiceFormula,
  ROLL_TYPES,
  resolveDiceRoll,
  rollAttackRoll,
  rollSavingThrow,
  rollAbilityCheck,
  rollSkillCheck,
  rollDamageRoll,
  rollHealingRoll,
  rollDeathSave,
  DAMAGE_TYPES,
  getCharacterDamageProfile,
  applyVulnerability,
  applyResistance,
  applyImmunity,
  resolveDamagePipeline,
  applyDamageToCombatState,
  isConcentrating,
  getConcentrationDC,
  resolveConcentrationSave,
  removeConcentrationEffects,
  resolveConcentrationOnDamage,
  REACTION_TRIGGER_TYPES,
  REACTION_EVENT_TYPES,
  ReactionRegistry,
  OPPORTUNITY_ATTACK,
  COUNTERSPELL_REACTION,
  PROTECT_ALLY_REACTION,
  createDefaultReactionDefinitions,
  createDefaultReactionRegistry,
  detectReactionTrigger,
  buildReactionWindow,
  waitForReactionDecision,
  consumeReactionAvailability,
  runReactionEngine,
  processReactionTriggerEvent,
  STATUS_EFFECT_TYPES,
  TICK_TIMING,
  STACKING_MODES,
  createStatusEffect,
  addEffect,
  removeEffect,
  updateEffectDuration,
  processTurnEffectsByTiming,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  LIFE_STATES,
  createDefaultDeathSaves,
  applyDownedState,
  resolveDeathSave,
  stabilizeCharacter,
  markCharacterDead,
  resolveCombatTurn,
  MIN_TURN_TIMEOUT_SECONDS,
  MAX_TURN_TIMEOUT_SECONDS,
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout,
  COMBAT_SNAPSHOT_SCHEMA,
  createCombatSnapshot,
  CombatSnapshotStore,
  CombatPersistenceBridge,
  CombatSimulationRunner,
  createMockCombatants,
  buildMockMoveEvent,
  buildMockAttackActionPayload,
  buildMockReactionTriggerEvent,
  buildMockTurnEvent
};

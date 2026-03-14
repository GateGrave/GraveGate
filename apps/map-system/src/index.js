"use strict";

const { MAP_TYPES, OVERLAY_KINDS, TOKEN_TYPES, DISTANCE_METRICS, MOVEMENT_RULES, ATTACK_MODES, COVER_LEVELS, EDGE_WALL_SIDES } = require("./constants");
const { validateMapStateShape, assertValidMapState } = require("./schema/map-state.schema");
const { createMapInstance } = require("./core/create-map-instance");
const { loadJsonFile, applyMapProfile, loadMapWithProfile } = require("./core/map-profile-loader");
const {
  normalizeHexColor,
  parseHexColor,
  loadTerrainMaskPalette,
  getTerrainMaskMetrics,
  buildTerrainEntriesFromMaskBitmap,
  buildTerrainEntriesFromMaskPath,
  applyTerrainMaskToMap
} = require("./core/terrain-mask-loader");
const {
  loadDungeonMaskPalette,
  buildDungeonEntriesFromMaskBitmap,
  buildDungeonEntriesFromMaskPath
} = require("./core/dungeon-mask-loader");
const {
  listTerrainStampPresets,
  findTerrainStampPreset,
  buildTerrainStampZone,
  applyTerrainStampToProfile,
  writeJsonFile,
  loadProfileFile
} = require("./core/terrain-stamping");
const { coordinateKey, isWithinBounds, getNeighborCoordinates, getDistance } = require("./coordinates/grid");
const { buildTerrainIndex, buildBlockedTileSet, buildSightBlockingSet, buildHazardTileList, getTileProperties } = require("./logic/terrain");
const { getCoverBetween, getCoverBonusAc, getCoverRank } = require("./logic/cover");
const {
  normalizeEdgeWall,
  buildEdgeWallKey,
  buildEdgeWallIndex,
  getCardinalEdgeForPoints,
  edgeWallBlocksTraversal,
  edgeWallBlocksLine,
  mergeUniqueEdgeWalls
} = require("./logic/edge-walls");
const { firstFiniteNumber, resolveActorMovementSpeedFeet } = require("./logic/actor-movement");
const {
  normalizeTerrainType,
  getTerrainDefinition,
  inferTerrainTypeFromText,
  inferTerrainType,
  resolveTerrainDefinition
} = require("./logic/terrain-catalog");
const { buildOccupiedTileSet, getReachableTiles, isDiagonalMove, getStepFeetCost } = require("./logic/movement");
const { hasLineOfSight, getTilesInRange } = require("./logic/range");
const { expandTerrainZones } = require("./logic/zones");
const { buildAttackProfile, isTargetValidForAttack, getValidAttackTargets, inspectAttackTargets } = require("./logic/attacks");
const { listWeaponProfiles, findWeaponProfile, resolveWeaponProfile } = require("./logic/weapon-profiles");
const {
  buildActorAttackProfile,
  buildAttackPreviewState,
  selectAttackTarget
} = require("./attacks/attack-interaction.service");
const {
  parseFeet,
  parseShapeFromTargetType,
  buildSpellTargetingProfile,
  getValidSpellTargets,
  inspectSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity
} = require("./spells/spell-targeting");
const {
  getCombatMapSpellSupport,
  partitionCombatMapSpells,
  filterSupportedCombatMapSpells,
  isAreaCombatMapSpell,
  getSpellShapeHint
} = require("./spells/spell-support");
const {
  feetToTiles,
  normalizeDirection,
  resolveAreaAnchor,
  buildSpellAreaTiles
} = require("./spells/spell-area");
const {
  listActorSpells,
  listActorCombatMapSpells,
  findSpellById,
  buildSpellPreviewOverlays,
  canSelectSpellTargetPosition,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection
} = require("./spells/spell-interaction.service");
const {
  buildMovementOverlay,
  buildActorMovementOverlay,
  buildRangeOverlay,
  buildPhysicalRangeOverlay,
  buildSpellRangeOverlay,
  buildSpellAreaOverlay,
  buildSelectionOverlay,
  buildHazardOverlay
} = require("./logic/overlay-builders");
const { buildAssetLibraryManifest } = require("./procedural/asset-library");
const { renderMapSvg } = require("./render/render-map-svg");
const { renderMapPng } = require("./render/render-map-png");
const { buildRenderRequest, renderMapAsync, createMapRenderQueue } = require("./render/map-render-service");
const { buildTokenVisualProfile, applyTokenVisualProfile, buildPlayerToken, buildEnemyToken, buildTokenAssetPath } = require("./tokens/token-catalog");
const {
  loadPlayerTokenCatalog,
  findPlayerTokenChoice,
  buildPlayerTokenFromChoice,
  listPlayerTokenChoices
} = require("./tokens/player-token-selection");
const {
  loadEnemyTokenCatalog,
  findEnemyTokenChoice,
  buildEnemyTokenFromChoice,
  listEnemyTokenChoices
} = require("./tokens/enemy-token-selection");
const {
  buildTokenSelectionChoices,
  applyPlayerTokenChoice
} = require("./tokens/token-selection.service");
const {
  colorDistance,
  sampleBackgroundColorFromCorners,
  removeBackgroundColor,
  findOpaqueBounds,
  processTokenImage
} = require("./tokens/token-image-processor");
const { parseCoordinatePair, parseMoveCommand, parseAttackCommand, parseSpellCommand, parseTargetCommand, parseMapCommand } = require("./commands/map-command-parser");
const { MAP_BUTTON_ACTIONS, buildMapButtonCustomId, parseMapButtonCustomId } = require("./discord/map-ui.contract");
const {
  DEBUG_FLAG_LABELS,
  normalizeDebugFlags,
  toggleDebugFlag,
  getActiveDebugFlagKeys,
  formatDebugFlagSummary
} = require("./interaction/debug-flags");
const { MAP_SYSTEM_INTEGRATION_CONTRACT } = require("./contracts/map-integration.contract");
const {
  MAP_ACTION_TYPES,
  createMapAction,
  createMoveToCoordinateAction,
  createAttackTargetTokenAction,
  createAttackTargetCoordinateAction,
  createCastSpellAction,
  createSelectTokenAction
} = require("./contracts/map-action.contract");
const { adaptMapActionToCanonicalEvent } = require("./contracts/map-event-adapter");
const {
  DUNGEON_MAP_ACTION_TYPES,
  createDungeonMapAction,
  createDungeonMapPreviewMoveAction,
  createDungeonMapMoveDirectionAction,
  createDungeonMapBackAction
} = require("./contracts/dungeon-map-action.contract");
const { adaptDungeonMapActionToCanonicalEvent } = require("./contracts/dungeon-map-event-adapter");
const {
  INTERACTION_MODES,
  createIdleState,
  handleButtonAction,
  handleTextCommand,
  enterMoveMode,
  enterAttackMode,
  enterSpellMode,
  enterTokenMode,
  previewSpell,
  confirmSpell,
  applyTokenSelection,
  applyAttackTargetSelection,
  confirmAttack
} = require("./interaction/map-interaction-controller");
const {
  buildMapActionRow,
  buildMapActionRows,
  buildMapMessagePayload,
  buildMapMessageEditPayload,
  buildMovePreviewMessagePayload,
  buildTokenSelectionRows,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionRows,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
} = require("./discord/map-message-builder");

module.exports = {
  MAP_TYPES,
  OVERLAY_KINDS,
  TOKEN_TYPES,
  DISTANCE_METRICS,
  MOVEMENT_RULES,
  ATTACK_MODES,
  COVER_LEVELS,
  EDGE_WALL_SIDES,
  validateMapStateShape,
  assertValidMapState,
  createMapInstance,
  loadJsonFile,
  applyMapProfile,
  loadMapWithProfile,
  normalizeHexColor,
  parseHexColor,
  loadTerrainMaskPalette,
  getTerrainMaskMetrics,
  buildTerrainEntriesFromMaskBitmap,
  buildTerrainEntriesFromMaskPath,
  applyTerrainMaskToMap,
  loadDungeonMaskPalette,
  buildDungeonEntriesFromMaskBitmap,
  buildDungeonEntriesFromMaskPath,
  listTerrainStampPresets,
  findTerrainStampPreset,
  buildTerrainStampZone,
  applyTerrainStampToProfile,
  writeJsonFile,
  loadProfileFile,
  coordinateKey,
  isWithinBounds,
  getNeighborCoordinates,
  getDistance,
  buildTerrainIndex,
  buildBlockedTileSet,
  buildSightBlockingSet,
  buildHazardTileList,
  getTileProperties,
  getCoverBetween,
  getCoverBonusAc,
  getCoverRank,
  normalizeEdgeWall,
  buildEdgeWallKey,
  buildEdgeWallIndex,
  getCardinalEdgeForPoints,
  edgeWallBlocksTraversal,
  edgeWallBlocksLine,
  mergeUniqueEdgeWalls,
  firstFiniteNumber,
  resolveActorMovementSpeedFeet,
  normalizeTerrainType,
  getTerrainDefinition,
  inferTerrainTypeFromText,
  inferTerrainType,
  resolveTerrainDefinition,
  expandTerrainZones,
  buildOccupiedTileSet,
  getReachableTiles,
  isDiagonalMove,
  getStepFeetCost,
  hasLineOfSight,
  getTilesInRange,
  buildAttackProfile,
  isTargetValidForAttack,
  getValidAttackTargets,
  inspectAttackTargets,
  listWeaponProfiles,
  findWeaponProfile,
  resolveWeaponProfile,
  buildActorAttackProfile,
  buildAttackPreviewState,
  selectAttackTarget,
  parseFeet,
  parseShapeFromTargetType,
  buildSpellTargetingProfile,
  getValidSpellTargets,
  inspectSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity,
  getCombatMapSpellSupport,
  partitionCombatMapSpells,
  filterSupportedCombatMapSpells,
  isAreaCombatMapSpell,
  getSpellShapeHint,
  feetToTiles,
  normalizeDirection,
  resolveAreaAnchor,
  buildSpellAreaTiles,
  listActorSpells,
  listActorCombatMapSpells,
  findSpellById,
  buildSpellPreviewOverlays,
  canSelectSpellTargetPosition,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection,
  buildMovementOverlay,
  buildActorMovementOverlay,
  buildRangeOverlay,
  buildPhysicalRangeOverlay,
  buildSpellRangeOverlay,
  buildSpellAreaOverlay,
  buildSelectionOverlay,
  buildHazardOverlay,
  buildAssetLibraryManifest,
  renderMapSvg,
  renderMapPng,
  buildRenderRequest,
  renderMapAsync,
  createMapRenderQueue,
  buildTokenVisualProfile,
  applyTokenVisualProfile,
  buildPlayerToken,
  buildEnemyToken,
  buildTokenAssetPath,
  loadPlayerTokenCatalog,
  findPlayerTokenChoice,
  buildPlayerTokenFromChoice,
  listPlayerTokenChoices,
  loadEnemyTokenCatalog,
  findEnemyTokenChoice,
  buildEnemyTokenFromChoice,
  listEnemyTokenChoices,
  buildTokenSelectionChoices,
  applyPlayerTokenChoice,
  colorDistance,
  sampleBackgroundColorFromCorners,
  removeBackgroundColor,
  findOpaqueBounds,
  processTokenImage,
  parseCoordinatePair,
  parseMoveCommand,
  parseAttackCommand,
  parseSpellCommand,
  parseTargetCommand,
  parseMapCommand,
  MAP_ACTION_TYPES,
  createMapAction,
  createMoveToCoordinateAction,
  createAttackTargetTokenAction,
  createAttackTargetCoordinateAction,
  createCastSpellAction,
  createSelectTokenAction,
  adaptMapActionToCanonicalEvent,
  DUNGEON_MAP_ACTION_TYPES,
  createDungeonMapAction,
  createDungeonMapPreviewMoveAction,
  createDungeonMapMoveDirectionAction,
  createDungeonMapBackAction,
  adaptDungeonMapActionToCanonicalEvent,
  INTERACTION_MODES,
  createIdleState,
  handleButtonAction,
  handleTextCommand,
  enterMoveMode,
  enterAttackMode,
  enterSpellMode,
  enterTokenMode,
  previewSpell,
  confirmSpell,
  applyTokenSelection,
  applyAttackTargetSelection,
  confirmAttack,
  MAP_SYSTEM_INTEGRATION_CONTRACT,
  MAP_BUTTON_ACTIONS,
  buildMapButtonCustomId,
  parseMapButtonCustomId,
  DEBUG_FLAG_LABELS,
  normalizeDebugFlags,
  toggleDebugFlag,
  getActiveDebugFlagKeys,
  formatDebugFlagSummary,
  buildMapActionRow,
  buildMapActionRows,
  buildMapMessagePayload,
  buildMapMessageEditPayload,
  buildMovePreviewMessagePayload,
  buildTokenSelectionRows,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionRows,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
};

"use strict";

const { MAP_TYPES, OVERLAY_KINDS, TOKEN_TYPES, DISTANCE_METRICS, MOVEMENT_RULES, ATTACK_MODES } = require("./constants");
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
  listTerrainStampPresets,
  findTerrainStampPreset,
  buildTerrainStampZone,
  applyTerrainStampToProfile,
  writeJsonFile,
  loadProfileFile
} = require("./core/terrain-stamping");
const { coordinateKey, isWithinBounds, getNeighborCoordinates, getDistance } = require("./coordinates/grid");
const { buildTerrainIndex, buildBlockedTileSet, buildSightBlockingSet, getTileProperties } = require("./logic/terrain");
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
const { buildAttackProfile, isTargetValidForAttack, getValidAttackTargets } = require("./logic/attacks");
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
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity
} = require("./spells/spell-targeting");
const {
  feetToTiles,
  normalizeDirection,
  resolveAreaAnchor,
  buildSpellAreaTiles
} = require("./spells/spell-area");
const {
  listActorSpells,
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
  buildSelectionOverlay
} = require("./logic/overlay-builders");
const { buildAssetLibraryManifest } = require("./procedural/asset-library");
const { renderMapSvg } = require("./render/render-map-svg");
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
  getTileProperties,
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
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  matchesTargetAffinity,
  feetToTiles,
  normalizeDirection,
  resolveAreaAnchor,
  buildSpellAreaTiles,
  listActorSpells,
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
  buildAssetLibraryManifest,
  renderMapSvg,
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
  buildMapActionRow,
  buildMapActionRows,
  buildMapMessagePayload,
  buildMapMessageEditPayload,
  buildTokenSelectionRows,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionRows,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
};

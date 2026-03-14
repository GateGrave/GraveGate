"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { normalizeProfilePaths, loadMapWithProfile } = require("../core/map-profile-loader");
const {
  validateMapStateShape,
  normalizeHexColor,
  parseHexColor,
  loadTerrainMaskPalette,
  buildTerrainEntriesFromMaskBitmap,
  loadDungeonMaskPalette,
  buildDungeonEntriesFromMaskBitmap,
  listTerrainStampPresets,
  findTerrainStampPreset,
  buildTerrainStampZone,
  applyTerrainStampToProfile,
  buildMovementOverlay,
  buildActorMovementOverlay,
  buildRangeOverlay,
  buildPhysicalRangeOverlay,
  buildSpellRangeOverlay,
  buildHazardOverlay,
  buildSelectionOverlay,
  renderMapSvg,
  renderMapPng,
  buildRenderRequest,
  buildAssetLibraryManifest,
  getReachableTiles,
  MOVEMENT_RULES,
  ATTACK_MODES,
  COVER_LEVELS,
  listWeaponProfiles,
  findWeaponProfile,
  getValidAttackTargets,
  getCoverBetween,
  buildAttackPreviewState,
  selectAttackTarget,
  hasLineOfSight,
  applyMapProfile,
  buildHazardTileList,
  getTileProperties,
  resolveActorMovementSpeedFeet,
  inferTerrainTypeFromText,
  resolveTerrainDefinition,
  buildPlayerToken,
  buildEnemyToken,
  buildTokenAssetPath,
  buildPlayerTokenFromChoice,
  listPlayerTokenChoices,
  buildTokenSelectionChoices,
  applyPlayerTokenChoice,
  colorDistance,
  findOpaqueBounds,
  parseMapCommand,
  buildSpellTargetingProfile,
  getValidSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec,
  getCombatMapSpellSupport,
  partitionCombatMapSpells,
  buildSpellAreaTiles,
  listActorSpells,
  listActorCombatMapSpells,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection,
  MAP_ACTION_TYPES,
  createMoveToCoordinateAction,
  createAttackTargetTokenAction,
  createCastSpellAction,
  createSelectTokenAction,
  adaptMapActionToCanonicalEvent,
  DUNGEON_MAP_ACTION_TYPES,
  createDungeonMapPreviewMoveAction,
  createDungeonMapMoveDirectionAction,
  createDungeonMapBackAction,
  adaptDungeonMapActionToCanonicalEvent,
  INTERACTION_MODES,
  createIdleState,
  handleButtonAction,
  handleTextCommand,
  confirmSpell,
  buildMapButtonCustomId,
  parseMapButtonCustomId,
  buildMapMessageEditPayload,
  buildMovePreviewMessagePayload,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
} = require("..");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createTestMap() {
  return {
    map_id: "test-map",
    map_type: "combat",
    name: "Test Map",
    grid: {
      width: 5,
      height: 5,
      tile_size: 70
    },
    asset: {
      base_image_path: "apps/map-system/assets/base-maps/test-map.png"
    },
    blocked_tiles: [{ x: 2, y: 1 }],
    edge_walls: [],
    terrain: [
      { x: 1, y: 1, terrain_type: "brush", movement_cost: 2 },
      { x: 3, y: 1, terrain_type: "tree", blocks_sight: true }
    ],
    terrain_zones: [
      { zone_id: "copse", shape: "circle", x: 4, y: 1, radius: 0, terrain_type: "tree", blocks_movement: true, blocks_sight: true }
    ],
    tokens: [
      {
        token_id: "hero-1",
        token_type: "player",
        label: "H",
        position: { x: 0, y: 0 }
      },
      {
        token_id: "enemy-1",
        token_type: "enemy",
        label: "E",
        position: { x: 4, y: 4 }
      }
    ],
    overlays: []
  };
}

function createBitmap(width, height, fillColor) {
  const data = Buffer.alloc(width * height * 4);
  const color = fillColor || { r: 255, g: 255, b: 255, a: 255 };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    }
  }

  return {
    width,
    height,
    data
  };
}

function fillBitmapRect(bitmap, rectangle, color) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      const offset = ((y * bitmap.width) + x) * 4;
      bitmap.data[offset] = color.r;
      bitmap.data[offset + 1] = color.g;
      bitmap.data[offset + 2] = color.b;
      bitmap.data[offset + 3] = color.a;
    }
  }
}

function runMapSystemTests() {
  const results = [];

  runTest("map_schema_accepts_valid_map", () => {
    const result = validateMapStateShape(createTestMap());
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  }, results);

  runTest("terrain_stamp_presets_are_listed_and_resolvable", () => {
    const presets = listTerrainStampPresets();
    const boulder = findTerrainStampPreset("boulder");

    assert.equal(presets.length > 0, true);
    assert.equal(Boolean(boulder), true);
    assert.equal(boulder.terrain_type, "boulder");
  }, results);

  runTest("terrain_stamp_builder_creates_semantic_zones", () => {
    const zone = buildTerrainStampZone({
      preset_id: "mountain_ridge",
      x: 4,
      y: 6
    });

    assert.equal(zone.terrain_type, "mountain");
    assert.equal(zone.shape, "rectangle");
    assert.equal(zone.width > 0, true);
  }, results);

  runTest("terrain_stamp_application_updates_profiles_without_manual_flags", () => {
    const profile = applyTerrainStampToProfile({
      terrain_zones: []
    }, {
      preset_id: "river_section",
      zone_id: "test-river",
      x: 1,
      y: 2
    });

    assert.equal(profile.terrain_zones.length, 1);
    assert.equal(profile.terrain_zones[0].terrain_type, "river");
    assert.equal(profile.terrain_zones[0].blocks_movement, undefined);
  }, results);

  runTest("movement_overlay_respects_blocked_tiles_and_costs", () => {
    const map = createTestMap();
    const overlay = buildMovementOverlay({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 15,
      ignore_token_id: "hero-1"
    });

    const keys = overlay.tiles.map((tile) => `${tile.x},${tile.y}`);
    assert.equal(keys.includes("2,1"), false);
    assert.equal(keys.includes("1,1"), true);
    assert.equal(keys.includes("3,0"), true);
  }, results);

  runTest("movement_overlay_exposes_tile_cost_metadata_for_button_previews", () => {
    const map = createTestMap();
    const overlay = buildMovementOverlay({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 30,
      allow_diagonal: true,
      ignore_token_id: "hero-1"
    });

    const reachable = overlay.metadata && Array.isArray(overlay.metadata.reachable_tiles)
      ? overlay.metadata.reachable_tiles
      : [];
    const difficultTile = reachable.find((tile) => tile.x === 1 && tile.y === 1);

    assert.equal(reachable.length > 0, true);
    assert.equal(Boolean(difficultTile), true);
    assert.equal(difficultTile.movement_cost_feet, 10);
    assert.equal(difficultTile.remaining_movement_feet, 20);
  }, results);

  runTest("movement_rejects_diagonal_corner_cutting", () => {
    const map = createTestMap();
    map.blocked_tiles = [{ x: 1, y: 0 }, { x: 0, y: 1 }];

    const reachable = getReachableTiles({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 30,
      allow_diagonal: true,
      ignore_token_id: "hero-1"
    });

    const keys = reachable.map((tile) => `${tile.x},${tile.y}`);
    assert.equal(keys.includes("1,1"), false);
  }, results);

  runTest("movement_respects_edge_walls_between_open_tiles", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [];
    map.terrain_zones = [];
    map.tokens = [
      {
        token_id: "hero-1",
        token_type: "player",
        label: "H",
        position: { x: 0, y: 0 }
      }
    ];
    map.edge_walls = [
      {
        x: 1,
        y: 0,
        side: "west",
        blocks_movement: true,
        blocks_sight: true
      }
    ];

    const reachable = getReachableTiles({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 5,
      allow_diagonal: false,
      ignore_token_id: "hero-1"
    });

    const keys = reachable.map((tile) => `${tile.x},${tile.y}`);
    assert.equal(keys.includes("1,0"), false);
    assert.equal(keys.includes("0,1"), true);
  }, results);

  runTest("movement_defaults_to_30_feet", () => {
    const map = createTestMap();
    const overlay = buildMovementOverlay({
      map,
      origin: { x: 0, y: 0 },
      ignore_token_id: "hero-1"
    });

    assert.equal(overlay.metadata.max_cost_feet, MOVEMENT_RULES.DEFAULT_SPEED_FEET);
  }, results);

  runTest("actor_movement_speed_reader_supports_players_and_enemies", () => {
    const playerSpeed = resolveActorMovementSpeedFeet({
      actor: {
        token_type: "player",
        movement_speed_feet: 30
      }
    });
    const enemySpeed = resolveActorMovementSpeedFeet({
      actor: {
        token_type: "enemy",
        speed: { walk_feet: 15 }
      }
    });

    assert.equal(playerSpeed, 30);
    assert.equal(enemySpeed, 15);
  }, results);

  runTest("actor_movement_speed_reader_prefers_remaining_movement_when_present", () => {
    const speed = resolveActorMovementSpeedFeet({
      actor: {
        movement_speed_feet: 30,
        movement: {
          remaining_feet: 10
        }
      }
    });

    assert.equal(speed, 10);
  }, results);

  runTest("alternating_diagonal_rule_increases_every_second_diagonal_step", () => {
    const map = createTestMap();
    const reachable = getReachableTiles({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 15,
      allow_diagonal: true,
      diagonal_rule: MOVEMENT_RULES.DIAGONAL_ALTERNATING,
      ignore_token_id: "hero-1"
    });

    const tile = reachable.find((entry) => entry.x === 2 && entry.y === 2);
    assert.equal(Boolean(tile), true);
    assert.equal(tile.movement_cost_feet, 15);
  }, results);

  runTest("alternating_diagonal_rule_tracks_parity_per_path_state", () => {
    const map = createTestMap();
    const reachable = getReachableTiles({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 20,
      allow_diagonal: true,
      diagonal_rule: MOVEMENT_RULES.DIAGONAL_ALTERNATING,
      ignore_token_id: "hero-1"
    });

    const target = reachable.find((entry) => entry.x === 3 && entry.y === 2);
    assert.equal(Boolean(target), true);
    assert.equal(target.movement_cost_feet <= 20, true);
  }, results);

  runTest("movement_overlay_uses_map_diagonal_rule_defaults", () => {
    const map = {
      map_id: "movement-rule-map",
      map_type: "combat",
      grid: { width: 5, height: 5, tile_size: 70 },
      rules: {
        diagonal_rule: MOVEMENT_RULES.DIAGONAL_ALTERNATING
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [
        {
          token_id: "hero-1",
          token_type: "player",
          label: "H",
          position: { x: 0, y: 0 }
        }
      ],
      overlays: []
    };

    const overlay = buildMovementOverlay({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 15,
      allow_diagonal: true,
      ignore_token_id: "hero-1"
    });

    const keys = overlay.tiles.map((tile) => `${tile.x},${tile.y}`);
    assert.equal(overlay.metadata.diagonal_rule, MOVEMENT_RULES.DIAGONAL_ALTERNATING);
    assert.equal(keys.includes("3,3"), false);
  }, results);

  runTest("thirty_foot_movement_never_exceeds_six_straight_tiles", () => {
    const map = {
      map_id: "thirty-foot-map",
      map_type: "combat",
      grid: { width: 20, height: 20, tile_size: 70 },
      rules: {
        diagonal_rule: MOVEMENT_RULES.DIAGONAL_ALTERNATING
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [
        {
          token_id: "hero-1",
          token_type: "player",
          label: "H",
          position: { x: 10, y: 10 }
        }
      ],
      overlays: []
    };

    const reachable = getReachableTiles({
      map,
      origin: { x: 10, y: 10 },
      max_cost: 30,
      allow_diagonal: true,
      diagonal_rule: MOVEMENT_RULES.DIAGONAL_ALTERNATING,
      ignore_token_id: "hero-1"
    });

    assert.equal(reachable.every((tile) => Math.abs(tile.x - 10) <= 6), true);
    assert.equal(reachable.every((tile) => Math.abs(tile.y - 10) <= 6), true);
    assert.equal(reachable.some((tile) => tile.x === 10 && tile.y === 4), true);
    assert.equal(reachable.some((tile) => tile.x === 10 && tile.y === 3), false);
  }, results);

  runTest("enemy_tokens_use_same_reachable_tile_rules", () => {
    const map = createTestMap();
    map.tokens[0].position = { x: 4, y: 0 };
    map.tokens[1].position = { x: 0, y: 0 };

    const reachable = getReachableTiles({
      map,
      origin: { x: 0, y: 0 },
      max_cost: 30,
      allow_diagonal: true,
      ignore_token_id: "enemy-1"
    });

    assert.equal(reachable.some((tile) => tile.x === 1 && tile.y === 0), true);
  }, results);

  runTest("range_overlay_returns_expected_tiles", () => {
    const map = createTestMap();
    const overlay = buildRangeOverlay({
      map,
      origin: { x: 0, y: 0 },
      range: 2,
      include_origin: false
    });

    const keys = overlay.tiles.map((tile) => `${tile.x},${tile.y}`);
    assert.equal(keys.includes("0,0"), false);
    assert.equal(keys.includes("2,0"), true);
    assert.equal(keys.includes("0,2"), true);
    assert.equal(keys.includes("2,1"), false);
  }, results);

  runTest("physical_and_spell_range_builders_use_distinct_color_defaults", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 1, y: 0 };
    const physical = buildPhysicalRangeOverlay({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        mode: ATTACK_MODES.MELEE,
        range_feet: 5
      }
    });
    const spell = buildSpellRangeOverlay({
      map,
      origin: { x: 0, y: 0 },
      range: 3
    });

    assert.equal(physical.kind, "physical_range");
    assert.equal(spell.kind, "spell_range");
    assert.equal(physical.color, "#ff3b30");
    assert.equal(spell.color, "#4dabf7");
    assert.deepEqual(physical.tiles, [{ x: 1, y: 0 }]);
  }, results);

  runTest("physical_range_only_shows_valid_targets", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 4, y: 4 };

    const targets = getValidAttackTargets({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        mode: ATTACK_MODES.MELEE,
        range_feet: 5
      }
    });

    assert.equal(targets.length, 0);
  }, results);

  runTest("attack_preview_state_returns_valid_targets_and_overlay", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 1, y: 0 };

    const out = buildAttackPreviewState({
      map,
      actor: map.tokens[0]
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.valid_targets.length, 1);
    assert.equal(out.payload.overlays.length, 1);
  }, results);

  runTest("attack_preview_state_reports_invalid_targets_for_preview_clarity", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [
      { x: 1, y: 0, terrain_type: "tree", blocks_sight: true }
    ];
    map.terrain_zones = [];
    map.tokens[1].position = { x: 0, y: 1 };
    map.tokens.push({
      token_id: "ally-1",
      token_type: "player",
      label: "A",
      position: { x: 1, y: 1 }
    });
    map.tokens.push({
      token_id: "enemy-hidden",
      token_type: "enemy",
      label: "X",
      position: { x: 2, y: 0 }
    });

    const out = buildAttackPreviewState({
      map,
      actor: map.tokens[0],
      attack_profile: {
        weapon_name: "Practice Bow",
        mode: ATTACK_MODES.RANGED_WEAPON,
        range_feet: 30,
        long_range_feet: 60
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.valid_targets.some((entry) => entry.token_id === "enemy-1"), true);
    assert.equal(
      out.payload.invalid_targets.some((entry) => entry.token_id === "ally-1" && entry.reason_summary === "not a valid attack target"),
      true
    );
    assert.equal(
      out.payload.invalid_targets.some((entry) => entry.token_id === "enemy-hidden" && entry.reason_summary === "line of sight blocked"),
      true
    );
  }, results);

  runTest("attack_profiles_support_reach_and_long_range_targets", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 2, y: 0 };

    const reachTargets = getValidAttackTargets({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        weapon_profile_id: "glaive"
      }
    });

    const longRangeTargets = getValidAttackTargets({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        weapon_name: "Practice Bow",
        mode: ATTACK_MODES.RANGED_WEAPON,
        range_feet: 5,
        long_range_feet: 20
      }
    });

    assert.equal(reachTargets.length, 1);
    assert.equal(reachTargets[0].distance_feet, 10);
    assert.equal(longRangeTargets[0].range_band, "long");
  }, results);

  runTest("attack_targets_report_partial_cover_without_becoming_illegal", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [
      { x: 1, y: 0, terrain_type: "fence" }
    ];
    map.terrain_zones = [];
    map.tokens[1].position = { x: 2, y: 0 };

    const targets = getValidAttackTargets({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        weapon_name: "Practice Bow",
        mode: ATTACK_MODES.RANGED_WEAPON,
        range_feet: 30,
        long_range_feet: 60
      }
    });

    assert.equal(targets.length, 1);
    assert.equal(targets[0].cover.level, COVER_LEVELS.HALF);
    assert.equal(targets[0].cover.ac_bonus, 2);
  }, results);

  runTest("attack_target_selection_accepts_valid_token_target", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 1, y: 0 };

    const out = selectAttackTarget({
      map,
      actor: map.tokens[0],
      target_token_ref: "enemy-1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.selected_target_id, "enemy-1");
    assert.equal(out.payload.overlays.some((overlay) => overlay.kind === "selection"), true);
  }, results);

  runTest("terrain_zones_block_line_of_sight_and_movement", () => {
    const map = createTestMap();
    const canSee = hasLineOfSight(map, { x: 3, y: 1 }, { x: 5, y: 1 });
    assert.equal(canSee, false);
  }, results);

  runTest("map_profiles_merge_authored_obstacle_data", () => {
    const baseMap = createTestMap();
    const merged = applyMapProfile(baseMap, {
      terrain_zones: [
        {
          zone_id: "new-copse",
          shape: "circle",
          x: 2,
          y: 2,
          radius: 1,
          terrain_type: "tree_cluster",
          blocks_movement: true,
          blocks_sight: true
        }
      ],
      tokens: [
        {
          token_id: "hero-2",
          token_type: "player",
          label: "P",
          position: { x: 2, y: 3 }
        }
      ]
    });

    assert.equal(merged.terrain_zones.length, 2);
    assert.equal(merged.tokens.length, 3);
    assert.equal(merged.tokens.some((token) => token.token_id === "hero-1"), true);
    assert.equal(merged.tokens.some((token) => token.token_id === "enemy-1"), true);
    assert.equal(merged.tokens.some((token) => token.token_id === "hero-2"), true);
  }, results);

  runTest("profile_loader_supports_comma_separated_layered_profiles", () => {
    const tempDirectory = path.resolve(process.cwd(), "apps/map-system/output/test-profile-loader");
    fs.mkdirSync(tempDirectory, { recursive: true });

    const mapPath = path.join(tempDirectory, "base-map.json");
    const combatProfilePath = path.join(tempDirectory, "combat-profile.json");
    const previewProfilePath = path.join(tempDirectory, "preview-profile.json");

    fs.writeFileSync(mapPath, JSON.stringify({
      map_id: "profile-loader-map",
      map_type: "combat",
      grid: { width: 5, height: 5, tile_size: 70 },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    }, null, 2), "utf8");

    fs.writeFileSync(combatProfilePath, JSON.stringify({
      terrain: [
        { x: 2, y: 2, terrain_type: "wall" }
      ],
      tokens: [
        { token_id: "enemy-1", token_type: "enemy", position: { x: 4, y: 4 } }
      ],
      overlays: [
        { overlay_id: "combat-overlay", kind: "move", tiles: [{ x: 2, y: 2 }] }
      ],
      terrain_mask_metadata: {
        palette_id: "mspaint_basic",
        generated_terrain_tiles: 1
      }
    }, null, 2), "utf8");

    fs.writeFileSync(previewProfilePath, JSON.stringify({
      tokens: [
        { token_id: "actor-1", token_type: "player", position: { x: 1, y: 1 } }
      ],
      overlays: [
        { overlay_id: "preview-overlay", kind: "selection", tiles: [{ x: 1, y: 1 }] }
      ]
    }, null, 2), "utf8");

    assert.deepEqual(
      normalizeProfilePaths(`${combatProfilePath}, ${previewProfilePath}`),
      [combatProfilePath, previewProfilePath]
    );

    const loaded = loadMapWithProfile({
      map_path: mapPath,
      profile_path: `${combatProfilePath},${previewProfilePath}`
    });

    assert.equal(loaded.terrain.length, 1);
    assert.equal(loaded.terrain[0].terrain_type, "wall");
    assert.equal(loaded.tokens.length, 2);
    assert.equal(loaded.tokens.some((token) => token.token_id === "actor-1"), true);
    assert.equal(loaded.tokens.some((token) => token.token_id === "enemy-1"), true);
    assert.equal(loaded.overlays.length, 2);
    assert.equal(loaded.terrain_mask_summary.generated_terrain_tiles, 1);
  }, results);

  runTest("terrain_types_like_rivers_walls_and_pits_default_to_impassable", () => {
    const map = createTestMap();
    map.terrain = [
      { x: 1, y: 0, terrain_type: "river" },
      { x: 2, y: 0, terrain_type: "wall" },
      { x: 3, y: 0, terrain_type: "pit" },
      { x: 4, y: 0, terrain_type: "impassable" }
    ];

    assert.equal(getTileProperties(map, { x: 1, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 2, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 3, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 4, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 4, y: 0 }).blocks_sight, false);
  }, results);

  runTest("difficult_terrain_and_hazard_flags_are_derived_from_semantic_types", () => {
    const map = createTestMap();
    map.terrain = [
      { x: 1, y: 0, terrain_type: "mud" },
      { x: 2, y: 0, terrain_type: "fire" }
    ];

    const mud = getTileProperties(map, { x: 1, y: 0 });
    const fire = getTileProperties(map, { x: 2, y: 0 });
    const hazards = buildHazardTileList(map);

    assert.equal(mud.movement_cost, 2);
    assert.equal(mud.is_hazard, false);
    assert.equal(fire.is_hazard, true);
    assert.equal(fire.hazard_kind, "fire");
    assert.equal(hazards.length, 1);
    assert.equal(hazards[0].x, 2);
  }, results);

  runTest("hazard_overlay_marks_semantic_hazard_tiles", () => {
    const map = createTestMap();
    map.terrain = [
      { x: 1, y: 0, terrain_type: "fire" },
      { x: 2, y: 0, terrain_type: "acid" }
    ];

    const overlay = buildHazardOverlay({ map });

    assert.equal(overlay.kind, "hazard");
    assert.equal(overlay.tiles.length, 2);
    assert.equal(overlay.tiles.some((tile) => tile.label === "FIR"), true);
    assert.equal(overlay.tiles.some((tile) => tile.label === "ACI"), true);
  }, results);

  runTest("terrain_catalog_infers_impassable_types_from_text_and_assets", () => {
    assert.equal(inferTerrainTypeFromText("tiles/terrain/boulder-large.png"), "boulder");
    assert.equal(inferTerrainTypeFromText("mountain-ridge-01"), "mountain");
    assert.equal(resolveTerrainDefinition({ asset_path: "tiles/terrain/river-bend.png" }).blocks_movement, true);
  }, results);

  runTest("terrain_mask_palette_loads_ms_paint_defaults", () => {
    const palette = loadTerrainMaskPalette({
      palette_id: "mspaint_basic"
    });

    assert.equal(palette.palette_id, "mspaint_basic");
    assert.equal(palette.entries.some((entry) => entry.terrain_type === "wall" && entry.hex === "#000000"), true);
    assert.deepEqual(parseHexColor("#00FF00"), { r: 0, g: 255, b: 0 });
    assert.equal(normalizeHexColor("#ff0000"), "#FF0000");
  }, results);

  runTest("dungeon_mask_palette_loads_marker_defaults", () => {
    const palette = loadDungeonMaskPalette({
      palette_id: "mspaint_dungeon_markers"
    });

    assert.equal(palette.palette_id, "mspaint_dungeon_markers");
    assert.equal(palette.entries.some((entry) => entry.marker_type === "party"), true);
    assert.equal(palette.entries.some((entry) => entry.marker_type === "enemy"), true);
    assert.equal(palette.entries.some((entry) => entry.marker_type === "trap"), true);
    assert.equal(palette.entries.some((entry) => entry.marker_type === "exit"), true);
  }, results);

  runTest("terrain_mask_bitmap_generates_semantic_terrain_from_flat_colors", () => {
    const bitmap = createBitmap(20, 20, { r: 255, g: 255, b: 255, a: 255 });
    fillBitmapRect(bitmap, { x: 10, y: 0, width: 10, height: 10 }, { r: 0, g: 0, b: 0, a: 255 });
    fillBitmapRect(bitmap, { x: 0, y: 10, width: 10, height: 10 }, { r: 0, g: 255, b: 0, a: 255 });
    fillBitmapRect(bitmap, { x: 10, y: 10, width: 10, height: 10 }, { r: 255, g: 0, b: 0, a: 255 });

    const map = {
      map_id: "mask-map",
      map_type: "combat",
      grid: {
        width: 2,
        height: 2,
        tile_size: 10
      },
      asset: {
        render_width_px: 20,
        render_height_px: 20,
        terrain_mask_palette_id: "mspaint_basic"
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    };

    const out = buildTerrainEntriesFromMaskBitmap(map, bitmap, {});
    const entries = out.terrain.sort((left, right) => left.y - right.y || left.x - right.x);

    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => ({
      x: entry.x,
      y: entry.y,
      terrain_type: entry.terrain_type
    })), [
      { x: 1, y: 0, terrain_type: "wall" },
      { x: 0, y: 1, terrain_type: "brush" },
      { x: 1, y: 1, terrain_type: "impassable" }
    ]);
    assert.equal(out.summary.terrain_type_counts.open, 1);
    assert.equal(out.summary.terrain_type_counts.wall, 1);
    assert.equal(out.summary.terrain_type_counts.impassable, 1);
  }, results);

  runTest("terrain_mask_bitmap_detects_thin_black_wall_lines_as_edge_walls", () => {
    const bitmap = createBitmap(20, 10, { r: 255, g: 255, b: 255, a: 255 });
    fillBitmapRect(bitmap, { x: 9, y: 0, width: 2, height: 10 }, { r: 0, g: 0, b: 0, a: 255 });

    const map = {
      map_id: "edge-mask-map",
      map_type: "combat",
      grid: {
        width: 2,
        height: 1,
        tile_size: 10
      },
      asset: {
        render_width_px: 20,
        render_height_px: 10,
        terrain_mask_palette_id: "mspaint_basic"
      },
      blocked_tiles: [],
      edge_walls: [],
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    };

    const out = buildTerrainEntriesFromMaskBitmap(map, bitmap, {});
    assert.equal(out.terrain.length, 0);
    assert.equal(out.edge_walls.length, 1);
    assert.equal(out.edge_walls[0].x, 1);
    assert.equal(out.edge_walls[0].y, 0);
    assert.equal(out.edge_walls[0].side, "west");
    assert.equal(out.summary.generated_edge_walls, 1);
  }, results);

  runTest("terrain_mask_bitmap_center_sampling_ignores_grid_lines", () => {
    const bitmap = createBitmap(20, 20, { r: 255, g: 255, b: 255, a: 255 });

    for (let x = 0; x < 20; x += 1) {
      fillBitmapRect(bitmap, { x, y: 9, width: 1, height: 2 }, { r: 0, g: 0, b: 0, a: 255 });
    }
    for (let y = 0; y < 20; y += 1) {
      fillBitmapRect(bitmap, { x: 9, y, width: 2, height: 1 }, { r: 0, g: 0, b: 0, a: 255 });
    }

    fillBitmapRect(bitmap, { x: 12, y: 12, width: 6, height: 6 }, { r: 0, g: 255, b: 0, a: 255 });

    const map = {
      map_id: "mask-grid-map",
      map_type: "combat",
      grid: {
        width: 2,
        height: 2,
        tile_size: 10
      },
      asset: {
        render_width_px: 20,
        render_height_px: 20,
        terrain_mask_palette_id: "mspaint_basic"
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    };

    const out = buildTerrainEntriesFromMaskBitmap(map, bitmap, {});
    assert.equal(out.terrain.some((entry) => entry.x === 0 && entry.y === 0), false);
    assert.equal(out.terrain.some((entry) => entry.x === 1 && entry.y === 0), false);
    assert.equal(out.terrain.some((entry) => entry.x === 0 && entry.y === 1), false);
    assert.equal(out.terrain.some((entry) => entry.x === 1 && entry.y === 1 && entry.terrain_type === "brush"), true);
  }, results);

  runTest("dungeon_mask_bitmap_generates_party_enemy_trap_and_exit_markers", () => {
    const bitmap = createBitmap(280, 280, { r: 255, g: 255, b: 255, a: 255 });
    fillBitmapRect(bitmap, { x: 18, y: 18, width: 34, height: 34 }, { r: 255, g: 255, b: 0, a: 255 });
    fillBitmapRect(bitmap, { x: 88, y: 18, width: 34, height: 34 }, { r: 255, g: 0, b: 0, a: 255 });
    fillBitmapRect(bitmap, { x: 18, y: 88, width: 34, height: 34 }, { r: 0, g: 0, b: 255, a: 255 });
    fillBitmapRect(bitmap, { x: 158, y: 18, width: 34, height: 34 }, { r: 128, g: 0, b: 128, a: 255 });

    const map = {
      map_id: "dungeon-mask-map",
      map_type: "dungeon",
      grid: {
        width: 4,
        height: 4,
        tile_size: 70
      },
      asset: {
        render_width_px: 280,
        render_height_px: 280,
        dungeon_mask_palette_id: "mspaint_dungeon_markers"
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [],
      overlays: []
    };

    const out = buildDungeonEntriesFromMaskBitmap(map, bitmap, {});
    assert.deepEqual(out.party_position, { x: 0, y: 0 });
    assert.equal(out.visible_enemy_tokens.length, 1);
    assert.deepEqual(out.visible_enemy_tokens[0].position, { x: 1, y: 0 });
    assert.equal(out.objects.length, 1);
    assert.equal(out.objects[0].object_type, "trap");
    assert.deepEqual(out.objects[0].position, { x: 0, y: 1 });
    assert.equal(out.exits.length, 1);
    assert.equal(out.exits[0].direction, "north");
    assert.deepEqual(out.exits[0].position, { x: 2, y: 0 });
  }, results);

  runTest("mask_driven_12x10_profile_persists_edge_walls_and_blocks_cross_wall_sight", () => {
    const loaded = loadMapWithProfile({
      map_path: path.resolve(process.cwd(), "apps/map-system/data/maps/combat/map-12x10.base-map.json"),
      profile_path: [
        path.resolve(process.cwd(), "apps/map-system/data/profiles/combat/map-12x10.combat-profile.json")
      ]
    });

    assert.equal(Array.isArray(loaded.edge_walls), true);
    assert.equal(loaded.edge_walls.length > 0, true);
    assert.equal(hasLineOfSight(loaded, { x: 5, y: 1 }, { x: 6, y: 1 }), false);
  }, results);

  runTest("mask_driven_12x10_movement_preview_respects_authored_wall_tiles", () => {
    const loaded = loadMapWithProfile({
      map_path: path.resolve(process.cwd(), "apps/map-system/data/maps/combat/map-12x10.base-map.json"),
      profile_path: [
        path.resolve(process.cwd(), "apps/map-system/data/profiles/combat/map-12x10.combat-profile.json"),
        path.resolve(process.cwd(), "apps/map-system/data/profiles/combat/map-12x10.movement-preview.json")
      ]
    });
    const actor = loaded.tokens.find((token) => token.token_id === "movement-player-12x10");
    const reachable = getReachableTiles({
      map: loaded,
      origin: actor.position,
      max_cost: actor.movement_speed_feet,
      allow_diagonal: true,
      diagonal_rule: loaded.rules.diagonal_rule,
      ignore_token_id: actor.token_id
    });

    assert.equal(reachable.some((tile) => tile.x === 2 && tile.y === 5), false);
    assert.equal(reachable.some((tile) => tile.x === 3 && tile.y === 6), false);
  }, results);

  runTest("terrain_zones_infer_default_flags_from_semantic_type", () => {
    const map = createTestMap();
    map.terrain_zones = [
      {
        zone_id: "north-river",
        shape: "rectangle",
        x: 1,
        y: 0,
        width: 2,
        height: 1,
        terrain_type: "river"
      },
      {
        zone_id: "mountain-pass",
        shape: "rectangle",
        x: 3,
        y: 0,
        width: 1,
        height: 1,
        label: "Mountain Ridge"
      }
    ];

    assert.equal(getTileProperties(map, { x: 1, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 3, y: 0 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 3, y: 0 }).blocks_sight, true);
  }, results);

  runTest("explicit_tree_terrain_blocks_the_tree_tile_itself", () => {
    const map = createTestMap();
    map.terrain = [
      { x: 3, y: 3, terrain_type: "tree" }
    ];

    assert.equal(getTileProperties(map, { x: 3, y: 3 }).blocks_movement, true);
    assert.equal(getTileProperties(map, { x: 2, y: 3 }).blocks_movement, false);
  }, results);

  runTest("map_schema_rejects_overlapping_token_positions", () => {
    const map = createTestMap();
    map.tokens[1].position = { x: 0, y: 0 };

    const result = validateMapStateShape(map);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((entry) => entry.includes("overlaps another token")), true);
  }, results);

  runTest("player_token_builder_applies_visual_defaults", () => {
    const token = buildPlayerToken({
      token_id: "player-a",
      label: "P1",
      actor_id: "actor-a",
      position: { x: 2, y: 2 },
      badge_text: "1"
    });

    assert.equal(token.token_type, "player");
    assert.equal(token.color, "#1e88e5");
    assert.equal(token.badge_text, "1");
    assert.equal(token.image_border_color, "#d4af37");
    assert.equal(token.badge_color, "#4aa3ff");
    assert.equal(token.badge_text_color, "#ffffff");
    assert.equal(token.label_plate_color, "#111827");
  }, results);

  runTest("enemy_token_builder_applies_enemy_visual_defaults", () => {
    const token = buildEnemyToken({
      token_id: "enemy-a",
      label: "G1",
      position: { x: 3, y: 3 }
    });

    assert.equal(token.token_type, "enemy");
    assert.equal(token.color, "#c62828");
    assert.equal(token.image_border_color, "#ff3b30");
    assert.equal(token.badge_color, "#ffd6d1");
    assert.equal(token.badge_text_color, "#111827");
  }, results);

  runTest("weapon_profile_catalog_exposes_melee_reach_and_ranged_defaults", () => {
    const profiles = listWeaponProfiles();
    const glaive = findWeaponProfile("glaive");
    const longbow = findWeaponProfile("longbow");

    assert.equal(profiles.length > 0, true);
    assert.equal(glaive.reach_feet, 10);
    assert.equal(longbow.long_range_feet, 600);
  }, results);

  runTest("token_asset_path_builder_targets_map_token_library", () => {
    const assetPath = buildTokenAssetPath({
      category: "players",
      file_name: "knight.png"
    });

    assert.equal(assetPath, "apps/map-system/assets/tokens/players/knight.png");
  }, results);

  runTest("player_token_choice_builder_uses_catalog_asset_path", () => {
    const token = buildPlayerTokenFromChoice({
      catalog: [
        {
          token_choice_id: "male-tiefling-01",
          label: "Male Tiefling",
          category: "players",
          file_name: "male-tiefling-01.png",
          processed_file_name: "processed/male-tiefling-01.cleaned.png",
          shape: "circle"
        }
      ],
      token_choice_id: "male-tiefling-01",
      token_id: "player-a",
      label: "P1",
      actor_id: "actor-a",
      position: { x: 2, y: 2 }
    });

    assert.equal(token.asset_path, "apps/map-system/assets/tokens/players/processed/male-tiefling-01.cleaned.png");
  }, results);

  runTest("player_token_choices_list_returns_selection-friendly_entries", () => {
    const choices = listPlayerTokenChoices({
      catalog: [
        {
          token_choice_id: "male-tiefling-01",
          label: "Male Tiefling",
          category: "players",
          file_name: "male-tiefling-01.png",
          processed_file_name: "processed/male-tiefling-01.cleaned.png",
          notes: "Tiefling portrait"
        }
      ]
    });

    assert.equal(choices.length, 1);
    assert.equal(choices[0].token_choice_id, "male-tiefling-01");
    assert.equal(choices[0].asset_path, "apps/map-system/assets/tokens/players/processed/male-tiefling-01.cleaned.png");
  }, results);

  runTest("token_selection_choices_are_built_for_ui_consumption", () => {
    const choices = buildTokenSelectionChoices({
      catalog: [
        {
          token_choice_id: "male-tiefling-03",
          label: "Male Tiefling III",
          category: "players",
          file_name: "male-tiefling-03.png",
          processed_file_name: "processed/male-tiefling-03.cleaned.png",
          notes: "Preview token"
        }
      ]
    });

    assert.equal(choices.length, 1);
    assert.equal(choices[0].token_choice_id, "male-tiefling-03");
  }, results);

  runTest("apply_player_token_choice_returns_built_token", () => {
    const out = applyPlayerTokenChoice({
      catalog: [
        {
          token_choice_id: "male-tiefling-03",
          label: "Male Tiefling III",
          category: "players",
          file_name: "male-tiefling-03.png",
          processed_file_name: "processed/male-tiefling-03.cleaned.png",
          shape: "circle"
        }
      ],
      token_choice_id: "male-tiefling-03",
      token_id: "player-a",
      label: "P1",
      actor_id: "actor-a",
      position: { x: 5, y: 6 },
      badge_text: "1"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.token.asset_path, "apps/map-system/assets/tokens/players/processed/male-tiefling-03.cleaned.png");
  }, results);

  runTest("map_command_parser_supports_move_attack_and_spell_inputs", () => {
    const move = parseMapCommand("move 12,5");
    const attack = parseMapCommand("attack goblin-1");
    const spell = parseMapCommand("cast firebolt at 14,7");
    const target = parseMapCommand("target 3,2");

    assert.equal(move.ok, true);
    assert.deepEqual(move.target_position, { x: 12, y: 5 });
    assert.equal(attack.action, "attack");
    assert.equal(attack.target_token_ref, "goblin-1");
    assert.equal(spell.action, "spell");
    assert.deepEqual(spell.target_position, { x: 14, y: 7 });
    assert.equal(target.action, "target");
    assert.deepEqual(target.target_position, { x: 3, y: 2 });
  }, results);

  runTest("spell_targeting_profile_derives_single_target_enemy_spell", () => {
    const profile = buildSpellTargetingProfile({
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      range: "120 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "spell_attack" }
    });

    assert.equal(profile.shape, "single");
    assert.equal(profile.range_feet, 120);
    assert.equal(profile.target_affinity, "enemy");
  }, results);

  runTest("spell_targeting_profile_derives_self_and_area_shapes", () => {
    const burningHands = buildSpellTargetingProfile({
      spell_id: "burning_hands",
      name: "Burning Hands",
      range: "self",
      targeting: { type: "cone_15ft" }
    });
    const shield = buildSpellTargetingProfile({
      spell_id: "shield",
      name: "Shield",
      range: "self",
      targeting: { type: "self" }
    });

    assert.equal(burningHands.shape, "cone");
    assert.equal(burningHands.area_size_feet, 15);
    assert.equal(shield.shape, "self");
    assert.equal(shield.target_affinity, "self");
  }, results);

  runTest("spell_targeting_profile_derives_split_object_aura_and_line_shapes", () => {
    const bless = buildSpellTargetingProfile({
      spell_id: "bless",
      name: "Bless",
      range: "30 feet",
      targeting: { type: "up_to_three_allies" }
    });
    const acidSplash = buildSpellTargetingProfile({
      spell_id: "acid_splash",
      name: "Acid Splash",
      range: "60 feet",
      targeting: { type: "single_or_adjacent_pair" }
    });
    const light = buildSpellTargetingProfile({
      spell_id: "light",
      name: "Light",
      range: "touch",
      targeting: { type: "object" }
    });
    const spiritGuardians = buildSpellTargetingProfile({
      spell_id: "spirit_guardians",
      name: "Spirit Guardians",
      range: "self",
      targeting: { type: "aura_15ft" }
    });
    const lightningBolt = buildSpellTargetingProfile({
      spell_id: "lightning_bolt",
      name: "Lightning Bolt",
      range: "self",
      targeting: { type: "line_100ft_5ft" }
    });

    assert.equal(bless.shape, "split");
    assert.equal(bless.min_targets, 1);
    assert.equal(bless.max_targets, 3);
    assert.equal(bless.target_affinity, "ally");
    assert.equal(acidSplash.shape, "split");
    assert.equal(acidSplash.requires_adjacent_selection, true);
    assert.equal(acidSplash.max_targets, 2);
    assert.equal(light.shape, "single");
    assert.equal(light.target_affinity, "object");
    assert.equal(spiritGuardians.shape, "aura");
    assert.equal(spiritGuardians.area_size_feet, 15);
    assert.equal(spiritGuardians.self_centered_area, true);
    assert.equal(lightningBolt.shape, "line");
    assert.equal(lightningBolt.area_size_feet, 100);
    assert.equal(lightningBolt.line_width_feet, 5);
  }, results);

  runTest("valid_spell_targets_respect_range_affinity_and_los", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const profile = buildSpellTargetingProfile({
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      range: "120 feet",
      targeting: { type: "single_target" }
    });

    const targets = getValidSpellTargets({
      map,
      actor: map.tokens[0],
      profile
    });

    assert.equal(targets.length, 1);
    assert.equal(targets[0].token_id, "enemy-1");
  }, results);

  runTest("cover_between_tokens_reports_total_cover_when_line_of_sight_is_broken", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [
      { x: 1, y: 0, terrain_type: "wall" }
    ];
    map.terrain_zones = [];

    const cover = getCoverBetween(map, { x: 0, y: 0 }, { x: 2, y: 0 });
    assert.equal(cover.level, COVER_LEVELS.TOTAL);
  }, results);

  runTest("line_of_sight_and_targeting_respect_edge_walls", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [];
    map.terrain_zones = [];
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };
    map.edge_walls = [
      {
        x: 1,
        y: 0,
        side: "west",
        blocks_movement: true,
        blocks_sight: true
      }
    ];

    const profile = buildSpellTargetingProfile({
      spell_id: "fire_bolt",
      name: "Fire Bolt",
      range: "120 feet",
      targeting: { type: "single_target" }
    });

    const spellTargets = getValidSpellTargets({
      map,
      actor: map.tokens[0],
      profile
    });

    const attackTargets = getValidAttackTargets({
      map,
      attacker: map.tokens[0],
      attack_profile: {
        mode: ATTACK_MODES.RANGED_WEAPON,
        range_feet: 30,
        long_range_feet: 30
      }
    });

    assert.equal(hasLineOfSight(map, map.tokens[0].position, map.tokens[1].position), false);
    assert.equal(spellTargets.length, 0);
    assert.equal(attackTargets.length, 0);
  }, results);

  runTest("healing_spells_target_allies", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "heroes";
    map.tokens[1].position = { x: 1, y: 0 };

    const profile = buildSpellTargetingProfile({
      spell_id: "healing_word",
      name: "Healing Word",
      range: "60 feet",
      targeting: { type: "single_target" },
      healing: { dice: "1d4" }
    });

    const targets = getValidSpellTargets({
      map,
      actor: map.tokens[0],
      profile
    });

    assert.equal(targets.length, 2);
  }, results);

  runTest("defensive_buff_spells_target_allies", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "heroes";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "enemy-2",
      token_type: "enemy",
      label: "X",
      position: { x: 2, y: 0 },
      team: "monsters"
    });

    const mageArmor = buildSpellTargetingProfile({
      spell_id: "mage_armor",
      name: "Mage Armor",
      range: "touch",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_mage_armor_base_ac",
        base_ac_formula: "13 + dex_mod"
      }
    });
    const shieldOfFaith = buildSpellTargetingProfile({
      spell_id: "shield_of_faith",
      name: "Shield of Faith",
      range: "60 feet",
      targeting: { type: "single_target" },
      attack_or_save: { type: "none" },
      effect: {
        defense_ref: "spell_shield_of_faith_ac_bonus",
        ac_bonus: 2
      }
    });

    const mageArmorTargets = getValidSpellTargets({
      map,
      actor: map.tokens[0],
      profile: mageArmor
    });
    const shieldTargets = getValidSpellTargets({
      map,
      actor: map.tokens[0],
      profile: shieldOfFaith
    });

    assert.deepEqual(
      mageArmorTargets.map((entry) => entry.token_id).sort(),
      ["enemy-1", "hero-1"].sort()
    );
    assert.deepEqual(
      shieldTargets.map((entry) => entry.token_id).sort(),
      ["enemy-1", "hero-1"].sort()
    );
    assert.equal(shieldTargets.some((entry) => entry.token_id === "enemy-2"), false);
  }, results);

  runTest("spell_selection_validator_respects_target_limits", () => {
    const profile = buildSpellTargetingProfile({
      spell_id: "magic_missile",
      name: "Magic Missile",
      range: "120 feet",
      targeting: { type: "single_or_split_target" },
      effect: { projectiles: 3 }
    });

    const valid = validateSpellSelection({
      profile,
      selected_targets: ["a", "b", "c"]
    });
    const invalid = validateSpellSelection({
      profile,
      selected_targets: ["a", "b", "c", "d"]
    });

    assert.equal(valid.ok, true);
    assert.equal(invalid.ok, false);
  }, results);

  runTest("spell_area_overlay_spec_exposes_area_shape_and_size", () => {
    const profile = buildSpellTargetingProfile({
      spell_id: "burning_hands",
      name: "Burning Hands",
      range: "self",
      targeting: { type: "cone_15ft" }
    });

    const spec = getSpellAreaOverlaySpec(profile);
    assert.equal(spec.shape, "cone");
    assert.equal(spec.size_feet, 15);
  }, results);

  runTest("spell_area_tiles_build_cone_from_actor_direction", () => {
    const map = createTestMap();
    const profile = buildSpellTargetingProfile({
      spell_id: "burning_hands",
      name: "Burning Hands",
      range: "self",
      targeting: { type: "cone_15ft" }
    });

    const tiles = buildSpellAreaTiles({
      map,
      origin: { x: 1, y: 1 },
      profile,
      target_position: { x: 4, y: 1 }
    });
    const keys = tiles.map((tile) => `${tile.x},${tile.y}`);

    assert.equal(keys.includes("2,1"), true);
    assert.equal(keys.includes("3,0"), true);
    assert.equal(keys.includes("3,2"), true);
  }, results);

  runTest("spell_area_tiles_build_line_from_target_direction", () => {
    const map = createTestMap();
    const profile = buildSpellTargetingProfile({
      spell_id: "lightning_bolt",
      name: "Lightning Bolt",
      range: "self",
      targeting: { type: "line_15ft" }
    });

    const tiles = buildSpellAreaTiles({
      map,
      origin: { x: 0, y: 0 },
      profile,
      target_position: { x: 4, y: 0 }
    });

    assert.deepEqual(tiles, [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 }
    ]);
  }, results);

  runTest("spell_area_tiles_honor_line_width_when_present", () => {
    const map = createTestMap();
    const profile = buildSpellTargetingProfile({
      spell_id: "lightning_lance",
      name: "Lightning Lance",
      range: "self",
      targeting: { type: "line_15ft_10ft" }
    });

    const tiles = buildSpellAreaTiles({
      map,
      origin: { x: 0, y: 0 },
      profile,
      target_position: { x: 4, y: 0 }
    });

    assert.deepEqual(tiles, [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 0 },
      { x: 3, y: 1 }
    ]);
  }, results);

  runTest("spell_area_tiles_build_sphere_on_target_point", () => {
    const map = createTestMap();
    const profile = buildSpellTargetingProfile({
      spell_id: "shatter",
      name: "Shatter",
      range: "60 feet",
      targeting: { type: "sphere_10ft" }
    });

    const tiles = buildSpellAreaTiles({
      map,
      origin: { x: 0, y: 0 },
      profile,
      target_position: { x: 2, y: 2 }
    });
    const keys = tiles.map((tile) => `${tile.x},${tile.y}`);

    assert.equal(keys.includes("2,2"), true);
    assert.equal(keys.includes("2,0"), true);
    assert.equal(keys.includes("0,2"), true);
  }, results);

  runTest("spell_selection_lists_actor_known_spells", () => {
    const spells = [
      { spell_id: "fire_bolt", name: "Fire Bolt", level: 0, range: "120 feet", targeting: { type: "single_target" } },
      { spell_id: "shield", name: "Shield", level: 1, range: "self", targeting: { type: "self" } }
    ];
    const actor = {
      known_spell_ids: ["shield", "fire_bolt"]
    };

    const listed = listActorSpells({ actor, spells });
    assert.equal(listed.length, 2);
    assert.equal(listed[0].spell_id, "fire_bolt");
  }, results);

  runTest("combat_map_spell_support_includes_all_currently_interpretable_targeting_profiles", () => {
    const spells = [
      { spell_id: "fire_bolt", name: "Fire Bolt", level: 0, casting_time: "1 action", range: "120 feet", targeting: { type: "single_target" } },
      { spell_id: "bless", name: "Bless", level: 1, casting_time: "1 action", range: "30 feet", targeting: { type: "up_to_three_allies" } },
      { spell_id: "shield", name: "Shield", level: 1, casting_time: "1 reaction", range: "self", targeting: { type: "self" } },
      { spell_id: "light", name: "Light", level: 0, casting_time: "1 action", range: "touch", targeting: { type: "object" } },
      { spell_id: "lightning_bolt", name: "Lightning Bolt", level: 3, casting_time: "1 action", range: "self", targeting: { type: "line_15ft" } }
    ];
    const actor = {
      known_spell_ids: ["fire_bolt", "bless", "shield", "light", "lightning_bolt"]
    };

    const partition = listActorCombatMapSpells({ actor, spells });

    assert.deepEqual(partition.supported.map((entry) => entry.spell_id), ["fire_bolt", "light", "bless", "shield", "lightning_bolt"]);
    assert.equal(partition.unsupported.length, 0);
  }, results);

  runTest("combat_map_spell_support_reports_reasons_for_unsupported_spells", () => {
    const blessSupport = getCombatMapSpellSupport({
      spell_id: "bless",
      name: "Bless",
      casting_time: "1 action",
      targeting: { type: "up_to_three_allies" }
    });
    const shieldSupport = getCombatMapSpellSupport({
      spell_id: "shield",
      name: "Shield",
      casting_time: "1 reaction",
      targeting: { type: "self" }
    });
    const lineSupport = getCombatMapSpellSupport({
      spell_id: "lightning_bolt",
      name: "Lightning Bolt",
      casting_time: "1 action",
      targeting: { type: "line_15ft" }
    });
    const unsupportedSupport = getCombatMapSpellSupport({
      spell_id: "mystery_spell",
      name: "Mystery Spell",
      casting_time: "1 action",
      targeting: { type: "hexagon_30ft" }
    });
    const partition = partitionCombatMapSpells([
      { spell_id: "fire_bolt", name: "Fire Bolt", casting_time: "1 action", targeting: { type: "single_target" } },
      { spell_id: "shield", name: "Shield", casting_time: "1 reaction", targeting: { type: "self" } },
      { spell_id: "mystery_spell", name: "Mystery Spell", casting_time: "1 action", targeting: { type: "hexagon_30ft" } }
    ]);

    assert.equal(blessSupport.supported, true);
    assert.equal(shieldSupport.supported, true);
    assert.equal(lineSupport.supported, true);
    assert.equal(unsupportedSupport.supported, false);
    assert.equal(String(unsupportedSupport.reason).includes("does not understand yet"), true);
    assert.deepEqual(partition.supported.map((entry) => entry.spell_id), ["fire_bolt", "shield"]);
    assert.deepEqual(partition.unsupported.map((entry) => entry.spell_id), ["mystery_spell"]);
  }, results);

  runTest("spell_preview_state_returns_targets_and_area_spec", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const out = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ],
      spell_id: "fire_bolt"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.valid_targets.length, 1);
    assert.equal(out.payload.spell_name, "Fire Bolt");
    assert.equal(out.payload.overlays.length, 1);
  }, results);

  runTest("spell_preview_state_reports_invalid_target_reasons_and_tile_summaries", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [
      { x: 1, y: 0, terrain_type: "tree", blocks_sight: true }
    ];
    map.terrain_zones = [];
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 0, y: 0 };
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 0, y: 2 };
    map.tokens.push({
      token_id: "ally-1",
      token_type: "player",
      label: "A",
      team: "heroes",
      position: { x: 0, y: 1 }
    });
    map.tokens.push({
      token_id: "enemy-hidden",
      token_type: "enemy",
      label: "X",
      team: "monsters",
      position: { x: 2, y: 0 }
    });

    const fireBolt = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ],
      spell_id: "fire_bolt"
    });

    const shatter = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "10 feet",
          targeting: { type: "sphere_10ft" }
        }
      ],
      spell_id: "shatter"
    });

    assert.equal(
      fireBolt.payload.invalid_targets.some((entry) => entry.token_id === "ally-1" && entry.reason_summary === "enemy only"),
      true
    );
    assert.equal(
      fireBolt.payload.invalid_targets.some((entry) => entry.token_id === "enemy-hidden" && entry.reason_summary === "line of sight blocked"),
      true
    );
    assert.equal(
      shatter.payload.invalid_target_tile_summary.some((entry) => entry.label === "out of range" && entry.count > 0),
      true
    );
  }, results);

  runTest("spell_preview_state_supports_multi_target_ally_spells", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "heroes";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "ally-2",
      token_type: "player",
      label: "B",
      team: "heroes",
      position: { x: 0, y: 1 }
    });
    const out = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "bless",
          name: "Bless",
          casting_time: "1 action",
          range: "30 feet",
          targeting: { type: "up_to_three_allies" }
        }
      ],
      spell_id: "bless"
    });

    assert.equal(out.ok, true);
    assert.deepEqual(
      out.payload.valid_targets.map((entry) => entry.token_id).sort(),
      ["ally-2", "enemy-1", "hero-1"].sort()
    );
    assert.equal(out.payload.profile.max_targets, 3);
  }, results);

  runTest("spell_preview_state_builds_area_overlay_tiles_for_targeted_aoe", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };

    const out = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ],
      spell_id: "shatter",
      target_position: { x: 3, y: 2 }
      });

      assert.equal(out.ok, true);
      assert.equal(out.payload.overlays.length, 3);
      assert.equal(out.payload.overlays.some((overlay) => overlay.kind === "spell_area"), true);
      assert.equal(out.payload.overlays.some((overlay) => overlay.kind === "selection"), true);
      assert.equal(out.payload.overlays.find((overlay) => overlay.kind === "spell_area").tiles.length > 0, true);
    }, results);

  runTest("direct_spell_preview_rejects_illegal_target_token", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "heroes";
    map.tokens[1].position = { x: 1, y: 0 };

    const out = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ],
      spell_id: "fire_bolt",
      target_token_ref: "enemy-1"
    });

    assert.equal(out.ok, false);
  }, results);

  runTest("spell_target_selection_accepts_valid_token_targets", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const out = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ],
      spell_id: "fire_bolt",
      target_token_ref: "enemy-1"
    });

    assert.equal(out.ok, true);
    assert.deepEqual(out.payload.selected_targets, ["enemy-1"]);
    assert.equal(out.payload.target_token_id, "enemy-1");
  }, results);

  runTest("spell_target_selection_accepts_valid_target_tiles", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };

    const out = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ],
      spell_id: "shatter",
      target_position: { x: 3, y: 2 }
    });

    assert.equal(out.ok, true);
    assert.deepEqual(out.payload.target_position, { x: 3, y: 2 });
    assert.equal(out.payload.confirmed_area_tiles.length > 0, true);
  }, results);

  runTest("line_spell_preview_and_confirmation_preserve_line_width_tiles", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 0, y: 0 };

    const spells = [
      {
        spell_id: "lightning_lance",
        name: "Lightning Lance",
        range: "self",
        targeting: { type: "line_15ft_10ft" }
      }
    ];

    const preview = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "lightning_lance",
      target_position: { x: 4, y: 0 }
    });
    const confirmation = confirmSpellSelection({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "lightning_lance",
      target_position: preview.ok ? preview.payload.target_position : null,
      confirmed_area_tiles: preview.ok ? preview.payload.confirmed_area_tiles : []
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.payload.confirmed_area_tiles.some((tile) => tile.x === 1 && tile.y === 1), true);
    assert.equal(preview.payload.confirmed_area_tiles.some((tile) => tile.x === 3 && tile.y === 1), true);
    assert.equal(preview.payload.area_overlay.width_feet, 10);
    assert.equal(confirmation.ok, true);
    assert.equal(confirmation.payload.confirmed_area_tiles.some((tile) => tile.x === 2 && tile.y === 1), true);
  }, results);

  runTest("split_target_spells_accumulate_multiple_target_selections", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "enemy-2",
      token_type: "enemy",
      position: { x: 2, y: 0 },
      team: "monsters"
    });

    const first = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "magic_missile",
          name: "Magic Missile",
          range: "120 feet",
          targeting: { type: "single_or_split_target" },
          effect: { projectiles: 3 }
        }
      ],
      spell_id: "magic_missile",
      target_token_ref: "enemy-1"
    });
    const second = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "magic_missile",
          name: "Magic Missile",
          range: "120 feet",
          targeting: { type: "single_or_split_target" },
          effect: { projectiles: 3 }
        }
      ],
      spell_id: "magic_missile",
      target_token_ref: "enemy-1",
      existing_selected_targets: first.payload.selected_targets
    });
    const third = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "magic_missile",
          name: "Magic Missile",
          range: "120 feet",
          targeting: { type: "single_or_split_target" },
          effect: { projectiles: 3 }
        }
      ],
      spell_id: "magic_missile",
      target_token_ref: "enemy-2",
      existing_selected_targets: second.payload.selected_targets
    });

    assert.deepEqual(first.payload.selected_targets, ["enemy-1"]);
    assert.deepEqual(second.payload.selected_targets, ["enemy-1", "enemy-1"]);
    assert.deepEqual(third.payload.selected_targets, ["enemy-1", "enemy-1", "enemy-2"]);
  }, results);

  runTest("ally_split_target_spells_allow_up_to_three_unique_targets", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "heroes";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "ally-2",
      token_type: "player",
      position: { x: 0, y: 1 },
      team: "heroes"
    });
    map.tokens.push({
      token_id: "ally-3",
      token_type: "player",
      position: { x: 1, y: 2 },
      team: "heroes"
    });

    const spells = [
      {
        spell_id: "bless",
        name: "Bless",
        range: "30 feet",
        targeting: { type: "up_to_three_allies" }
      }
    ];

    const first = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "bless",
      target_token_ref: "enemy-1"
    });
    const second = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "bless",
      target_token_ref: "ally-2",
      existing_selected_targets: first.payload.selected_targets
    });
    const duplicate = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "bless",
      target_token_ref: "enemy-1",
      existing_selected_targets: second.payload.selected_targets
    });
    const third = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "bless",
      target_token_ref: "ally-3",
      existing_selected_targets: second.payload.selected_targets
    });
    const overflow = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "bless",
      target_token_ref: "hero-1",
      existing_selected_targets: third.payload.selected_targets
    });

    assert.equal(first.ok, true);
    assert.deepEqual(first.payload.selected_targets, ["enemy-1"]);
    assert.equal(second.ok, true);
    assert.deepEqual(second.payload.selected_targets, ["enemy-1", "ally-2"]);
    assert.equal(duplicate.ok, true);
    assert.deepEqual(duplicate.payload.selected_targets, ["enemy-1", "ally-2"]);
    assert.equal(third.ok, true);
    assert.deepEqual(third.payload.selected_targets, ["enemy-1", "ally-2", "ally-3"]);
    assert.equal(overflow.ok, false);
    assert.equal(String(overflow.error).includes("maximum spell targets"), true);
  }, results);

  runTest("adjacent_pair_spells_require_adjacent_second_target", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "enemy-2",
      token_type: "enemy",
      position: { x: 1, y: 1 },
      team: "monsters"
    });
    map.tokens.push({
      token_id: "enemy-3",
      token_type: "enemy",
      position: { x: 4, y: 4 },
      team: "monsters"
    });

    const spells = [
      {
        spell_id: "acid_splash",
        name: "Acid Splash",
        range: "60 feet",
        targeting: { type: "single_or_adjacent_pair" }
      }
    ];

    const first = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "acid_splash",
      target_token_ref: "enemy-1"
    });
    const adjacent = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "acid_splash",
      target_token_ref: "enemy-2",
      existing_selected_targets: first.payload.selected_targets
    });
    const distant = selectSpellTarget({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "acid_splash",
      target_token_ref: "enemy-3",
      existing_selected_targets: first.payload.selected_targets
    });

    assert.equal(first.ok, true);
    assert.deepEqual(first.payload.selected_targets, ["enemy-1"]);
    assert.equal(adjacent.ok, true);
    assert.deepEqual(adjacent.payload.selected_targets, ["enemy-1", "enemy-2"]);
    assert.equal(distant.ok, false);
    assert.equal(String(distant.error).includes("adjacent"), true);
  }, results);

  runTest("self_centered_area_spells_preview_and_confirm_without_manual_tile_selection", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 2, y: 1 };

    const spells = [
      {
        spell_id: "spirit_guardians",
        name: "Spirit Guardians",
        range: "self",
        targeting: { type: "aura_15ft" }
      }
    ];

    const preview = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "spirit_guardians"
    });
    const confirmation = confirmSpellSelection({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "spirit_guardians",
      selected_targets: preview.ok ? preview.payload.selected_targets : [],
      target_position: preview.ok ? preview.payload.target_position : null,
      confirmed_area_tiles: preview.ok ? preview.payload.confirmed_area_tiles : []
    });

    assert.equal(preview.ok, true);
    assert.deepEqual(preview.payload.target_position, { x: 1, y: 1 });
    assert.equal(preview.payload.confirmed_area_tiles.length > 0, true);
    assert.equal(confirmation.ok, true);
    assert.deepEqual(confirmation.payload.target_position, { x: 1, y: 1 });
  }, results);

  runTest("object_target_spells_only_offer_object_tokens", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";
    map.tokens.push({
      token_id: "torch-1",
      token_type: "object",
      label: "T",
      position: { x: 1, y: 0 },
      team: ""
    });

    const preview = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells: [
        {
          spell_id: "light",
          name: "Light",
          range: "touch",
          targeting: { type: "object" }
        }
      ],
      spell_id: "light"
    });

    assert.equal(preview.ok, true);
    assert.deepEqual(preview.payload.valid_targets.map((entry) => entry.token_id), ["torch-1"]);
    assert.equal(
      preview.payload.invalid_targets.some((entry) => entry.token_id === "hero-1" && entry.reason_summary === "object only"),
      true
    );
  }, results);

  runTest("utility_spells_preview_and_confirm_without_targets", () => {
    const map = createTestMap();
    map.tokens[0].team = "heroes";

    const spells = [
      {
        spell_id: "detect_magic",
        name: "Detect Magic",
        range: "self",
        targeting: { type: "utility" }
      }
    ];

    const preview = buildSpellPreviewState({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "detect_magic"
    });
    const confirmation = confirmSpellSelection({
      map,
      actor: map.tokens[0],
      spells,
      spell_id: "detect_magic"
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.payload.valid_targets.length, 0);
    assert.equal(preview.payload.valid_target_tiles.length, 0);
    assert.equal(confirmation.ok, true);
  }, results);

  runTest("spell_confirmation_validates_selection_count", () => {
    const spells = [
      {
        spell_id: "magic_missile",
        name: "Magic Missile",
        range: "120 feet",
        targeting: { type: "single_or_split_target" },
        effect: { projectiles: 3 }
      }
    ];

    const good = confirmSpellSelection({
      spells,
      spell_id: "magic_missile",
      selected_targets: ["a", "b", "c"]
    });
    const bad = confirmSpellSelection({
      spells,
      spell_id: "magic_missile",
      selected_targets: ["a", "b", "c", "d"]
    });

    assert.equal(good.ok, true);
    assert.equal(bad.ok, false);
  }, results);

  runTest("token_image_helpers_compute_color_distance_and_bounds", () => {
    const distance = colorDistance(
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 250, b: 0 }
    );
    const bitmap = {
      width: 3,
      height: 3,
      data: Buffer.from([
        0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0,
        0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0,
        0, 0, 0, 0,   0, 0, 0, 0,   0, 0, 0, 0
      ])
    };
    const bounds = findOpaqueBounds(bitmap, 8);

    assert.equal(distance > 0, true);
    assert.deepEqual(bounds, { x: 1, y: 1, width: 1, height: 1 });
  }, results);

  runTest("map_button_custom_ids_round_trip_cleanly", () => {
    const customId = buildMapButtonCustomId({
      action: "move",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    });
    const parsed = parseMapButtonCustomId(customId);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, "move");
    assert.equal(parsed.instance_id, "combat-1");
    assert.equal(parsed.actor_id, "actor-1");
  }, results);

  runTest("map_message_edit_payload_contains_buttons_for_message_updates", () => {
    const payload = buildMapMessageEditPayload({
      message_id: "message-1",
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      content: "Your turn",
      turn_label: "P1",
      mode_label: "Ready",
      files: ["forest-road.demo.svg"]
    });

    assert.equal(payload.message_id, "message-1");
    assert.equal(payload.components.length, 2);
    assert.equal(payload.components[0].components.length, 4);
    assert.equal(payload.components[1].components.some((button) => button.label === "Terrain"), true);
    assert.equal(payload.content.includes("Turn: P1"), true);
    assert.equal(payload.content.includes("Mode: Ready"), true);
  }, results);

  runTest("token_selection_message_payload_contains_choice_buttons", () => {
    const payload = buildTokenSelectionMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      choices: [
        { token_choice_id: "male-tiefling-03", label: "Male Tiefling III" },
        { token_choice_id: "orc-male-01", label: "Orc Male 01" }
      ]
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components.length, 2);
    assert.equal(payload.components[1].components[0].label, "Back");
    assert.equal(payload.components[2].components.some((button) => button.label === "Coords"), true);
  }, results);

  runTest("token_selection_message_payload_pages_large_choice_sets", () => {
    const choices = Array.from({ length: 25 }, (_, index) => ({
      token_choice_id: `token-${index + 1}`,
      label: `Token ${index + 1}`
    }));
    const payload = buildTokenSelectionMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      choices
    });

    assert.equal(payload.components.length, 5);
    assert.equal(payload.components.some((row) => row.components.some((button) => button.label === "Next")), true);
  }, results);

  runTest("spell_selection_message_payload_contains_spell_buttons", () => {
    const payload = buildSpellSelectionMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spells: [
        { spell_id: "fire_bolt", name: "Fire Bolt" },
        { spell_id: "shield", name: "Shield" }
      ]
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components.length, 2);
    assert.equal(payload.components[1].components[0].label, "Back");
    assert.equal(payload.components[2].components.some((button) => button.label === "Walls"), true);
  }, results);

  runTest("move_preview_message_payload_contains_destination_buttons_and_confirm", () => {
    const payload = buildMovePreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      movement_speed_feet: 30,
      reachable_tiles: [
        { x: 1, y: 0, movement_cost_feet: 5, remaining_movement_feet: 25 },
        { x: 1, y: 1, movement_cost_feet: 10, remaining_movement_feet: 20 }
      ],
      selected_target_position: { x: 1, y: 1 },
      selected_target: { x: 1, y: 1, movement_cost_feet: 10, remaining_movement_feet: 20 }
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components[0].label, "1,0 (5ft)");
    assert.equal(payload.components[1].components[0].label, "Confirm Move");
    assert.equal(payload.components[2].components.some((button) => button.label === "Terrain"), true);
    assert.equal(String(payload.content).includes("Speed: 30 ft"), true);
    assert.equal(String(payload.content).includes("Cost 10 ft"), true);
  }, results);

  runTest("attack_and_spell_preview_messages_surface_invalid_reason_summaries", () => {
    const attackPayload = buildAttackPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      valid_targets: [{ token_id: "enemy-1", name: "Goblin 1" }],
      invalid_targets: [{ token_id: "ally-1", name: "Bramble", reason_summary: "not a valid attack target" }],
      selected_target_id: "enemy-1"
    });
    const spellPayload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "shatter",
      spell_name: "Shatter",
      valid_target_tiles: [{ x: 1, y: 1 }],
      invalid_target_tile_summary: [{ label: "out of range", count: 8 }],
      can_confirm: false
    });

    assert.equal(String(attackPayload.content).includes("Unavailable: Bramble (not a valid attack target)"), true);
    assert.equal(String(spellPayload.content).includes("Unavailable points: 8 out of range"), true);
  }, results);

  runTest("spell_preview_message_payload_describes_self_centered_and_utility_spells", () => {
    const selfCenteredPayload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "spirit_guardians",
      spell_name: "Spirit Guardians",
      range_feet: 0,
      spell_shape: "aura",
      area_size_feet: 15,
      self_centered_area: true,
      target_position: { x: 1, y: 1 },
      can_confirm: true
    });
    const utilityPayload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "detect_magic",
      spell_name: "Detect Magic",
      range_feet: 0,
      spell_shape: "utility",
      can_confirm: true
    });
    const linePayload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "lightning_bolt",
      spell_name: "Lightning Bolt",
      range_feet: 0,
      spell_shape: "line",
      area_size_feet: 100,
      line_width_feet: 5,
      valid_target_tiles: [{ x: 2, y: 1 }],
      can_confirm: false
    });

    assert.equal(String(selfCenteredPayload.content).includes("This spell is centered on you"), true);
    assert.equal(String(utilityPayload.content).includes("No target selection is required"), true);
    assert.equal(String(linePayload.content).includes("100 ft x 5 ft line"), true);
  }, results);

  runTest("spell_preview_message_payload_contains_confirm_button", () => {
    const payload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "fire_bolt",
      spell_name: "Fire Bolt",
      valid_targets: [{ token_id: "enemy-1", name: "Goblin 1" }],
      selected_targets: ["enemy-1"],
      can_confirm: true
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components[0].label, "Goblin 1");
    assert.equal(payload.components[1].components[0].label, "Confirm Spell");
    assert.equal(payload.components[2].components.some((button) => button.label === "Cover"), true);
  }, results);

  runTest("spell_preview_message_payload_uses_tile_buttons_for_area_targeting", () => {
    const payload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "shatter",
      spell_name: "Shatter",
      range_feet: 60,
      spell_shape: "sphere",
      area_size_feet: 10,
      valid_target_tiles: [
        { x: 3, y: 2, distance_feet: 15, line_of_sight: true },
        { x: 4, y: 2, distance_feet: 20, line_of_sight: true }
      ],
      target_position: { x: 3, y: 2 },
      target_position_details: { x: 3, y: 2, distance_feet: 15, line_of_sight: true },
      affected_units: ["Goblin 1"],
      can_confirm: true
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components[0].label, "3,2");
    assert.equal(String(payload.content).includes("Affected units: Goblin 1"), true);
    assert.equal(String(payload.content).includes("Blue tiles = spell range"), true);
    assert.equal(payload.components[2].components.some((button) => button.label === "Walls"), true);
  }, results);

  runTest("spell_preview_message_payload_pages_large_target_sets", () => {
    const validTargets = Array.from({ length: 25 }, (_, index) => ({
      token_id: `enemy-${index + 1}`
    }));
    const payload = buildSpellPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      spell_id: "fire_bolt",
      spell_name: "Fire Bolt",
      valid_targets: validTargets,
      can_confirm: false
    });

    assert.equal(payload.components.length, 5);
    assert.equal(payload.components.some((row) => row.components.some((button) => button.label === "Next")), true);
  }, results);

  runTest("attack_preview_message_payload_contains_confirm_button", () => {
    const payload = buildAttackPreviewMessagePayload({
      actor_id: "actor-1",
      instance_type: "combat",
      instance_id: "combat-1",
      valid_targets: [{ token_id: "enemy-1", name: "Goblin 1" }],
      selected_target_id: "enemy-1"
    });

    assert.equal(payload.components.length, 3);
    assert.equal(payload.components[0].components[0].label, "Goblin 1");
    assert.equal(payload.components[1].components[0].label, "Confirm Attack");
    assert.equal(payload.components[2].components.some((button) => button.label === "Terrain"), true);
  }, results);

  runTest("interaction_controller_enters_move_mode_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const customId = buildMapButtonCustomId({
      action: "move",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    });

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, customId);

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.MOVE);
    assert.equal(Array.isArray(out.preview.overlays), true);
  }, results);

  runTest("interaction_controller_move_preview_uses_actor_speed_overrides", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].movement_speed_feet = 15;

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, buildMapButtonCustomId({
      action: "move",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(out.ok, true);
    assert.equal(out.preview.overlays[0].metadata.max_cost_feet, 15);
    assert.equal(out.payload.content.includes("Speed: 15 ft"), true);
  }, results);

  runTest("interaction_controller_selects_move_destination_from_button_before_confirm", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const first = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, buildMapButtonCustomId({
      action: "move",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    const second = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: first.state
    }, buildMapButtonCustomId({
      action: "move_target,1,0",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(second.ok, true);
    assert.equal(second.state.mode, INTERACTION_MODES.MOVE);
    assert.deepEqual(second.preview.selected_target_position, { x: 1, y: 0 });
    assert.equal(second.payload.content.includes("Cost 5 ft"), true);
    assert.equal(second.preview.overlays.some((overlay) => overlay.kind === "selection"), true);
  }, results);

  runTest("interaction_controller_confirms_move_after_button_selection", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const selected = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: {
        mode: INTERACTION_MODES.MOVE,
        actor_id: "actor-1",
        instance_id: "combat-1",
        instance_type: "combat",
        pending: {
          preview: {
            movement_speed_feet: 30,
            reachable_tiles: [
              { x: 1, y: 0, movement_cost_feet: 5, remaining_movement_feet: 25 }
            ],
            selected_target_position: { x: 1, y: 0 },
            selected_target: { x: 1, y: 0, movement_cost_feet: 5, remaining_movement_feet: 25 },
            overlays: []
          }
        }
      }
    }, buildMapButtonCustomId({
      action: "move_confirm",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(selected.ok, true);
    assert.equal(selected.action_contract.action_type, MAP_ACTION_TYPES.MOVE_TO_COORDINATE);
    assert.deepEqual(selected.action_contract.payload.target_position, { x: 1, y: 0 });
  }, results);

  runTest("actor_movement_overlay_reads_enemy_speed_from_shared_reader", () => {
    const map = createTestMap();
    const enemyOverlay = buildActorMovementOverlay({
      map,
      actor: {
        token_id: "enemy-1",
        token_type: "enemy",
        position: { x: 4, y: 4 },
        speed: { walk_feet: 15 }
      },
      ignore_token_id: "enemy-1",
      allow_diagonal: true
    });

    assert.equal(enemyOverlay.metadata.max_cost_feet, 15);
  }, results);

  runTest("interaction_controller_enters_token_mode_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const customId = buildMapButtonCustomId({
      action: "token",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    });

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      token_catalog: [
        {
          token_choice_id: "male-tiefling-03",
          label: "Male Tiefling III",
          category: "players",
          file_name: "male-tiefling-03.png",
          processed_file_name: "processed/male-tiefling-03.cleaned.png"
        }
      ]
    }, customId);

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.TOKEN_LIST);
  }, results);

  runTest("interaction_controller_applies_token_selection_without_gameplay_mutation", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const customId = buildMapButtonCustomId({
      action: "token_select,male-tiefling-03",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    });

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      token_catalog: [
        {
          token_choice_id: "male-tiefling-03",
          label: "Male Tiefling III",
          category: "players",
          file_name: "male-tiefling-03.png",
          processed_file_name: "processed/male-tiefling-03.cleaned.png"
        }
      ]
    }, customId);

    assert.equal(out.ok, true);
    assert.equal(out.action_intent.intent_type, "select_token");
    assert.equal(out.map.tokens[0].asset_path, "apps/map-system/assets/tokens/players/processed/male-tiefling-03.cleaned.png");
    assert.equal(out.action_contract.action_type, MAP_ACTION_TYPES.SELECT_TOKEN);
  }, results);

  runTest("interaction_controller_previews_spell_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].known_spell_ids = ["fire_bolt"];
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const customId = buildMapButtonCustomId({
      action: "spell,fire_bolt",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    });

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ]
    }, customId);

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.SPELL_PREVIEW);
    assert.equal(out.preview.valid_targets.length, 1);
    assert.equal(out.preview.overlays.length >= 1, true);
  }, results);

  runTest("interaction_controller_uses_text_spell_target_coordinates_for_aoe_preview", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };

    const out = handleTextCommand({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ]
    }, "cast shatter at 3,2");

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.SPELL_PREVIEW);
    assert.deepEqual(out.preview.target_position, { x: 3, y: 2 });
    assert.equal(out.preview.overlays.some((overlay) => overlay.kind === "spell_area"), true);
  }, results);

  runTest("interaction_controller_applies_spell_target_tile_selection_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 3, y: 2 };

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ]
    }, buildMapButtonCustomId({
      action: "spell_target_tile,shatter,3,2",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.SPELL_PREVIEW);
    assert.deepEqual(out.preview.target_position, { x: 3, y: 2 });
    assert.equal(out.preview.valid_target_tiles.length > 0, true);
    assert.equal(out.preview.overlays.some((overlay) => overlay.kind === "spell_area"), true);
    assert.equal(out.payload.content.includes("Affected units: enemy-1"), true);
  }, results);

  runTest("interaction_controller_applies_spell_target_token_selection_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ]
    }, buildMapButtonCustomId({
      action: "spell_target_token,fire_bolt,enemy-1",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.SPELL_PREVIEW);
    assert.deepEqual(out.preview.selected_targets, ["enemy-1"]);
    assert.equal(out.preview.overlays.some((overlay) => overlay.kind === "selection"), true);
  }, results);

  runTest("interaction_controller_pages_token_selection_without_losing_state", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    const first = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      token_catalog: Array.from({ length: 25 }, (_, index) => ({
        token_choice_id: `token-${index + 1}`,
        label: `Token ${index + 1}`,
        category: "players",
        file_name: `token-${index + 1}.png`
      }))
    }, buildMapButtonCustomId({
      action: "token",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    const second = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      state: first.state
    }, buildMapButtonCustomId({
      action: "token_page,2",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(second.ok, true);
    assert.equal(second.state.pending.page, 2);
  }, results);

  runTest("interaction_controller_toggles_debug_overlays_without_losing_preview_state", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";

    const first = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, buildMapButtonCustomId({
      action: "move",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    const second = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: first.state
    }, buildMapButtonCustomId({
      action: "debug_toggle,coords",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(second.ok, true);
    assert.equal(second.state.mode, INTERACTION_MODES.MOVE);
    assert.equal(second.state.debug_flags.coords, true);
    assert.equal(Boolean(second.state.pending && second.state.pending.preview), true);
    assert.equal(String(second.payload.content).includes("Debug overlays: Coords"), true);
  }, results);

  runTest("interaction_controller_accumulates_split_spell_targets_until_confirmable", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };
    map.tokens.push({
      token_id: "enemy-2",
      token_type: "enemy",
      position: { x: 2, y: 0 },
      team: "monsters"
    });

    const spellData = [
      {
        spell_id: "magic_missile",
        name: "Magic Missile",
        range: "120 feet",
        targeting: { type: "single_or_split_target" },
        effect: { projectiles: 3 }
      }
    ];

    const first = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: spellData
    }, buildMapButtonCustomId({
      action: "spell_target_token,magic_missile,enemy-1",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));
    const second = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: spellData,
      state: first.state
    }, buildMapButtonCustomId({
      action: "spell_target_token,magic_missile,enemy-1",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));
    const third = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: spellData,
      state: second.state
    }, buildMapButtonCustomId({
      action: "spell_target_token,magic_missile,enemy-2",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.deepEqual(first.preview.selected_targets, ["enemy-1"]);
    assert.deepEqual(second.preview.selected_targets, ["enemy-1", "enemy-1"]);
    assert.deepEqual(third.preview.selected_targets, ["enemy-1", "enemy-1", "enemy-2"]);
  }, results);

  runTest("interaction_controller_confirms_spell_with_exact_confirmed_area_tiles", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[0].position = { x: 1, y: 1 };

    const preview = handleTextCommand({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ]
    }, "cast shatter at 3,2");

    const confirmed = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: preview.state,
      spells: [
        {
          spell_id: "shatter",
          name: "Shatter",
          range: "60 feet",
          targeting: { type: "sphere_10ft" }
        }
      ]
    }, buildMapButtonCustomId({
      action: "spell_confirm,shatter",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.action_contract.action_type, MAP_ACTION_TYPES.CAST_SPELL);
    assert.deepEqual(confirmed.action_contract.payload.target_position, { x: 3, y: 2 });
    assert.equal(confirmed.action_contract.payload.confirmed_area_tiles.length > 0, true);
  }, results);

  runTest("interaction_controller_returns_preview_maps_for_attack_and_spell_modes", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[0].team = "heroes";
    map.tokens[1].team = "monsters";
    map.tokens[1].position = { x: 1, y: 0 };

    const attackPreview = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat"
    }, buildMapButtonCustomId({
      action: "attack",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    const spellPreview = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      spells: [
        {
          spell_id: "fire_bolt",
          name: "Fire Bolt",
          range: "120 feet",
          targeting: { type: "single_target" }
        }
      ]
    }, buildMapButtonCustomId({
      action: "spell,fire_bolt",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(Array.isArray(attackPreview.preview_map.overlays), true);
    assert.equal(Array.isArray(spellPreview.preview_map.overlays), true);
  }, results);

  runTest("interaction_controller_normalizes_text_commands_to_intents", () => {
    const out = handleTextCommand({
      map: {
        map_id: "map-1",
        grid: { width: 20, height: 20, tile_size: 70 },
        blocked_tiles: [],
        terrain: [],
        terrain_zones: [],
        overlays: [],
        tokens: [
          { token_id: "actor-1", actor_id: "actor-1", token_type: "player", position: { x: 0, y: 0 } }
        ]
      },
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, "move 3,2");

    assert.equal(out.ok, true);
    assert.equal(out.action_intent.intent_type, "move_to_coordinate");
    assert.deepEqual(out.action_intent.payload, { x: 3, y: 2 });
    assert.equal(out.action_contract.action_type, MAP_ACTION_TYPES.MOVE_TO_COORDINATE);
  }, results);

  runTest("interaction_controller_rejects_illegal_text_move_targets", () => {
    const out = handleTextCommand({
      map: {
        map_id: "map-1",
        grid: { width: 5, height: 5, tile_size: 70 },
        blocked_tiles: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
        terrain: [],
        terrain_zones: [],
        overlays: [],
        tokens: [
          { token_id: "actor-1", actor_id: "actor-1", token_type: "player", position: { x: 0, y: 0 } }
        ]
      },
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, "move 1,1");

    assert.equal(out.ok, false);
    assert.equal(out.error, "target position is not a legal move destination");
  }, results);

  runTest("interaction_controller_enters_attack_mode_from_button", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[1].position = { x: 1, y: 0 };

    const out = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, buildMapButtonCustomId({
      action: "attack",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(out.ok, true);
    assert.equal(out.state.mode, INTERACTION_MODES.ATTACK);
    assert.equal(out.preview.valid_targets.length, 1);
  }, results);

  runTest("interaction_controller_selects_attack_target_before_confirming", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[1].position = { x: 1, y: 0 };

    const selected = handleTextCommand({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, "attack enemy-1");

    assert.equal(selected.ok, true);
    assert.equal(selected.state.mode, INTERACTION_MODES.ATTACK);
    assert.equal(selected.preview.selected_target_id, "enemy-1");
  }, results);

  runTest("interaction_controller_confirms_attack_after_selection", () => {
    const map = createTestMap();
    map.tokens[0].actor_id = "actor-1";
    map.tokens[1].position = { x: 1, y: 0 };

    const selected = handleTextCommand({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, "attack enemy-1");

    const confirmed = handleButtonAction({
      map,
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: selected.state
    }, buildMapButtonCustomId({
      action: "attack_confirm",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.action_contract.action_type, MAP_ACTION_TYPES.ATTACK_TARGET_TOKEN);
    assert.equal(confirmed.action_contract.payload.target_token_id, "enemy-1");
  }, results);

  runTest("interaction_controller_emits_attack_and_spell_action_contracts", () => {
    const attackSelected = handleTextCommand({
      map: {
        map_id: "map-1",
        grid: { width: 5, height: 5, tile_size: 70 },
        tokens: [
          { token_id: "actor-1", actor_id: "actor-1", token_type: "player", position: { x: 0, y: 0 } },
          { token_id: "goblin-1", token_type: "enemy", position: { x: 1, y: 0 } }
        ]
      },
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1"
    }, "attack goblin-1");
    const attack = handleButtonAction({
      map: {
        map_id: "map-1",
        grid: { width: 5, height: 5, tile_size: 70 },
        tokens: [
          { token_id: "actor-1", actor_id: "actor-1", token_type: "player", position: { x: 0, y: 0 } },
          { token_id: "goblin-1", token_type: "enemy", position: { x: 1, y: 0 } }
        ]
      },
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      message_id: "message-1",
      state: attackSelected.state
    }, buildMapButtonCustomId({
      action: "attack_confirm",
      instance_type: "combat",
      instance_id: "combat-1",
      actor_id: "actor-1"
    }));

    const spell = confirmSpell({
      spells: [
        {
          spell_id: "magic_missile",
          name: "Magic Missile",
          range: "120 feet",
          targeting: { type: "single_or_split_target" },
          effect: { projectiles: 3 }
        }
      ],
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      map: {
        map_id: "map-1",
        grid: { width: 5, height: 5, tile_size: 70 },
        tokens: [
          { token_id: "actor-1", actor_id: "actor-1", token_type: "player", position: { x: 0, y: 0 }, team: "heroes" },
          { token_id: "enemy-1", token_type: "enemy", position: { x: 1, y: 0 }, team: "monsters" }
        ]
      }
    }, "magic_missile", ["enemy-1", "enemy-1", "enemy-1"]);

    assert.equal(attack.action_contract.action_type, MAP_ACTION_TYPES.ATTACK_TARGET_TOKEN);
    assert.equal(spell.action_contract.action_type, MAP_ACTION_TYPES.CAST_SPELL);
  }, results);

  runTest("map_action_adapter_builds_canonical_combat_events_without_mutating_state", () => {
    const moveResult = adaptMapActionToCanonicalEvent(createMoveToCoordinateAction({
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      map_id: "map-1"
    }, { x: 3, y: 4 }), {
      player_id: "player-1"
    });
    const attackResult = adaptMapActionToCanonicalEvent(createAttackTargetTokenAction({
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      map_id: "map-1"
    }, "enemy-1", {
      selected_target_position: { x: 1, y: 0 },
      attack_profile: { weapon_profile_id: "longsword" }
    }), {
      player_id: "player-1"
    });
    const spellResult = adaptMapActionToCanonicalEvent(createCastSpellAction({
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      map_id: "map-1"
    }, {
      spell_id: "fire_bolt",
      selected_targets: [{ token_id: "enemy-1" }],
      target_position: { x: 1, y: 0 }
    }), {
      player_id: "player-1"
    });

    assert.equal(moveResult.ok, true);
    assert.equal(moveResult.payload.event.event_type, "player_move");
    assert.equal(moveResult.payload.event.payload.target_x, 3);
    assert.equal(attackResult.payload.event.event_type, "player_attack");
    assert.equal(attackResult.payload.event.payload.target_id, "enemy-1");
    assert.equal(spellResult.payload.event.event_type, "player_cast_spell");
    assert.equal(spellResult.payload.event.payload.spell_id, "fire_bolt");
  }, results);

  runTest("map_action_adapter_keeps_non_gameplay_token_selection_local", () => {
    const result = adaptMapActionToCanonicalEvent(createSelectTokenAction({
      actor_id: "actor-1",
      instance_id: "combat-1",
      instance_type: "combat",
      map_id: "map-1"
    }, {
      token_choice_id: "male-tiefling-03"
    }), {
      player_id: "player-1"
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload.dispatch_required, false);
    assert.equal(result.payload.event, null);
  }, results);

  runTest("dungeon_map_action_adapter_dispatches_move_direction_as_canonical_session_event", () => {
    const result = adaptDungeonMapActionToCanonicalEvent(createDungeonMapMoveDirectionAction({
      actor_id: "leader-1",
      instance_id: "session-1",
      instance_type: "dungeon",
      map_id: "dungeon-map-1"
    }, "east"), {
      player_id: "player-1"
    });

    assert.equal(result.ok, true);
    assert.equal(result.payload.dispatch_required, true);
    assert.equal(result.payload.event.event_type, "player_move");
    assert.equal(result.payload.event.target_system, "session_system");
    assert.equal(result.payload.event.payload.direction, "east");
    assert.equal(result.payload.event.session_id, "session-1");
  }, results);

  runTest("dungeon_map_action_adapter_keeps_preview_and_back_local", () => {
    const preview = adaptDungeonMapActionToCanonicalEvent(createDungeonMapPreviewMoveAction({
      actor_id: "leader-1",
      instance_id: "session-1",
      instance_type: "dungeon",
      map_id: "dungeon-map-1"
    }), {
      player_id: "player-1"
    });
    const back = adaptDungeonMapActionToCanonicalEvent(createDungeonMapBackAction({
      actor_id: "leader-1",
      instance_id: "session-1",
      instance_type: "dungeon",
      map_id: "dungeon-map-1"
    }), {
      player_id: "player-1"
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.payload.dispatch_required, false);
    assert.equal(preview.payload.event, null);
    assert.equal(preview.payload.action.action_type, DUNGEON_MAP_ACTION_TYPES.PREVIEW_MOVE);
    assert.equal(back.ok, true);
    assert.equal(back.payload.dispatch_required, false);
    assert.equal(back.payload.event, null);
    assert.equal(back.payload.action.action_type, DUNGEON_MAP_ACTION_TYPES.BACK);
  }, results);

  runTest("map_render_request_builder_normalizes_output_path_for_worker_use", () => {
    const request = buildRenderRequest({
      map: createTestMap(),
      output_path: "apps/map-system/output/test-render.png",
      show_grid: false
    });

    assert.equal(Boolean(request.map), true);
    assert.equal(path.isAbsolute(request.render_options.output_path), true);
    assert.equal(request.render_options.show_grid, false);
  }, results);

  runTest("svg_renderer_writes_snapshot", () => {
    const map = createTestMap();
    map.overlays = [
      buildMovementOverlay({
        map,
        origin: { x: 0, y: 0 },
        max_cost: 2,
        ignore_token_id: "hero-1"
      })
    ];

    const outputPath = path.resolve(process.cwd(), "apps/map-system/output/test-map.svg");
    const svg = renderMapSvg(map, { output_path: outputPath });
    assert.equal(svg.includes("<svg"), true);
    assert.equal(svg.includes("../assets/base-maps/test-map.png"), true);
    assert.equal(fs.existsSync(outputPath), true);
  }, results);

  runTest("svg_renderer_hides_runtime_grid_when_asset_has_embedded_grid", () => {
    const map = createTestMap();
    map.asset.has_embedded_grid = true;

    const svg = renderMapSvg(map, {});
    assert.equal(svg.includes('stroke="rgba(0,0,0,0.18)"'), false);
  }, results);

  runTest("svg_renderer_draws_selection_markers_above_tokens", () => {
    const map = createTestMap();
    map.overlays = [
      buildSelectionOverlay({
        tiles: [{ x: 4, y: 4, label: "ATK" }]
      })
    ];

    const svg = renderMapSvg(map, {});
    assert.equal(svg.includes('>ATK</text>'), true);
    assert.equal(svg.includes('stroke="#ffd60a"'), true);
  }, results);

  runTest("svg_renderer_applies_enemy_image_defaults_to_raw_profile_tokens", () => {
    const map = createTestMap();
    map.tokens = [
      {
        token_id: "enemy-portrait",
        token_type: "enemy",
        label: "G1",
        badge_text: "G1",
        position: { x: 1, y: 1 },
        asset_path: "apps/map-system/assets/tokens/enemies/processed/goblin-01.cleaned.png"
      }
    ];

    const svg = renderMapSvg(map, {});
    assert.equal(svg.includes('stroke="#ff3b30"'), true);
    assert.equal(svg.includes('fill="#ffd6d1"'), true);
    assert.equal(svg.includes('>G1</text>'), true);
  }, results);

  runTest("svg_renderer_draws_hp_chip_and_active_token_ring", () => {
    const map = createTestMap();
    map.tokens = [
      {
        token_id: "hero-status",
        token_type: "player",
        label: "H1",
        badge_text: "9/12",
        badge_color: "#111827",
        badge_text_color: "#ffffff",
        active_tile_color: "#ffd166",
        position: { x: 0, y: 0 }
      }
    ];

    const svg = renderMapSvg(map, {});
    assert.equal(svg.includes('stroke="#ffd166"'), true);
    assert.equal(svg.includes('>H1</text>'), true);
    assert.equal(svg.includes('>9/12</text>'), true);
  }, results);

  runTest("svg_renderer_draws_debug_overlays_when_enabled", () => {
    const map = createTestMap();
    map.blocked_tiles = [];
    map.terrain = [
      { x: 1, y: 1, terrain_type: "brush", movement_cost: 2, cover_level: "half" }
    ];
    map.edge_walls = [
      { x: 1, y: 1, side: "north", blocks_movement: true, blocks_sight: true }
    ];
    map.render_debug = {
      terrain: true,
      cover: true,
      walls: true,
      coords: true
    };

    const svg = renderMapSvg(map, {});
    assert.equal(svg.includes(">1,1</text>"), true);
    assert.equal(svg.includes(">MV2</text>"), true);
    assert.equal(svg.includes(">+2</text>"), true);
    assert.equal(svg.includes('stroke="#06b6d4"'), true);
  }, results);

  runTest("svg_renderer_centers_image_tokens_inside_rectangular_grid_cells", () => {
    const map = {
      map_id: "rectangular-render-map",
      map_type: "combat",
      name: "Rectangular Render Map",
      grid: {
        width: 2,
        height: 2,
        tile_size: 70
      },
      asset: {
        render_width_px: 100,
        render_height_px: 120,
        grid_origin_x: 2,
        grid_origin_y: 1,
        grid_width_px: 96,
        grid_height_px: 118
      },
      blocked_tiles: [],
      terrain: [],
      terrain_zones: [],
      tokens: [
        {
          token_id: "player-portrait",
          token_type: "player",
          label: "P1",
          badge_text: "1",
          position: { x: 0, y: 0 },
          asset_path: "apps/map-system/assets/tokens/players/processed/male-tiefling-03.cleaned.png"
        }
      ],
      overlays: []
    };

    const svg = renderMapSvg(map, {});
    const match = svg.match(/<image[^>]+x=\"([^\"]+)\" y=\"([^\"]+)\" width=\"([^\"]+)\" height=\"([^\"]+)\"/);
    assert.equal(Boolean(match), true);

    const tokenX = Number(match[1]);
    const tokenY = Number(match[2]);
    const tokenWidth = Number(match[3]);
    const tokenHeight = Number(match[4]);

    assert.equal(Math.abs(tokenX - 4) < 0.001, true);
    assert.equal(Math.abs(tokenY - 8.5) < 0.001, true);
    assert.equal(Math.abs(tokenWidth - 44) < 0.001, true);
    assert.equal(Math.abs(tokenHeight - 44) < 0.001, true);
  }, results);

  runTest("svg_renderer_resolves_common_double_extension_asset_names", () => {
    const assetDirectory = path.resolve(process.cwd(), "apps/map-system/assets/base-maps");
    const doubledAssetPath = path.join(assetDirectory, "double-ext-test.png.png");
    fs.writeFileSync(doubledAssetPath, "placeholder", "utf8");

    const map = createTestMap();
    map.asset.base_image_path = "apps/map-system/assets/base-maps/double-ext-test.png";

    const outputPath = path.resolve(process.cwd(), "apps/map-system/output/double-ext-test.svg");
    const svg = renderMapSvg(map, { output_path: outputPath });

    assert.equal(svg.includes("../assets/base-maps/double-ext-test.png.png"), true);
    assert.equal(fs.existsSync(outputPath), true);

    fs.unlinkSync(doubledAssetPath);
  }, results);

  runTest("asset_library_manifest_discovers_expected_groups", () => {
    const manifest = buildAssetLibraryManifest(path.resolve(process.cwd(), "apps/map-system/assets"));
    assert.equal(Array.isArray(manifest.groups.base_maps), true);
    assert.equal(Array.isArray(manifest.groups.tokens), true);
    assert.equal(Array.isArray(manifest.tile_metadata), true);
  }, results);

  const passed = results.filter((entry) => entry.ok).length;
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
  const summary = runMapSystemTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runMapSystemTests
};

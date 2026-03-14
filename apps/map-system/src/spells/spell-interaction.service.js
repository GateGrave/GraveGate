"use strict";

const { SPELL_TARGETING_SHAPES } = require("../constants");
const {
  buildSpellTargetingProfile,
  inspectSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec
} = require("./spell-targeting");
const {
  getCombatMapSpellSupport,
  partitionCombatMapSpells
} = require("./spell-support");
const {
  buildSpellRangeOverlay,
  buildSpellAreaOverlay,
  buildSelectionOverlay
} = require("../logic/overlay-builders");
const { getDistance } = require("../coordinates/grid");
const { hasLineOfSight } = require("../logic/range");

function listActorSpells(options) {
  const actor = options.actor || {};
  const spells = Array.isArray(options.spells) ? options.spells : [];
  const knownSpellIds = Array.isArray(actor.known_spell_ids)
    ? new Set(actor.known_spell_ids.map((entry) => String(entry)))
    : null;

  return spells
    .filter((spell) => !knownSpellIds || knownSpellIds.has(String(spell.spell_id || spell.id)))
    .map((spell) => ({
      spell_id: String(spell.spell_id || spell.id || ""),
      name: String(spell.name || ""),
      level: Number(spell.level || 0),
      casting_time: String(spell.casting_time || ""),
      range: String(spell.range || ""),
      targeting: spell && spell.targeting && typeof spell.targeting === "object"
        ? { type: String(spell.targeting.type || "") }
        : null,
      targeting_type: String(spell.targeting && spell.targeting.type || ""),
      attack_or_save_type: String(spell.attack_or_save && spell.attack_or_save.type || "none")
    }))
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
}

function listActorCombatMapSpells(options) {
  const listed = listActorSpells(options);
  return partitionCombatMapSpells(listed);
}

function findSpellById(spells, spellId) {
  return (spells || []).find((spell) => String(spell.spell_id || spell.id) === String(spellId || "")) || null;
}

function findTargetToken(map, tokenId) {
  return (map && map.tokens || []).find((token) => String(token.token_id) === String(tokenId || "")) || null;
}

function getTargetDistanceFeet(origin, point) {
  return getDistance(origin, point, "chebyshev") * 5;
}

function isAreaTargetSelectionProfile(profile) {
  return Boolean(
    profile &&
    [
      SPELL_TARGETING_SHAPES.CONE,
      SPELL_TARGETING_SHAPES.CUBE,
      SPELL_TARGETING_SHAPES.SPHERE,
      SPELL_TARGETING_SHAPES.LINE
    ].includes(profile.shape)
  );
}

function isSelfCenteredAreaProfile(profile) {
  return Boolean(profile && profile.self_centered_area === true);
}

function normalizeSelectedTargetsForProfile(profile, selectedTargets) {
  const safeTargets = Array.isArray(selectedTargets)
    ? selectedTargets.map((entry) => String(entry))
    : [];
  if (profile && profile.allows_duplicate_targets === true) {
    return safeTargets;
  }

  const seen = new Set();
  return safeTargets.filter((entry) => {
    if (!entry || seen.has(entry)) {
      return false;
    }
    seen.add(entry);
    return true;
  });
}

function areSelectedTargetsAdjacent(map, selectedTargets) {
  const safeTargets = Array.isArray(selectedTargets)
    ? Array.from(new Set(selectedTargets.map((entry) => String(entry))))
    : [];
  if (safeTargets.length <= 1) {
    return true;
  }

  const tokens = safeTargets
    .map((tokenId) => findTargetToken(map, tokenId))
    .filter((token) => token && token.position);
  if (tokens.length !== safeTargets.length) {
    return false;
  }

  return tokens.every((token, index) => (
    index === 0 || getDistance(tokens[0].position, token.position, "chebyshev") <= 1
  ));
}

function applyTokenSelectionToTargets(map, profile, selectedTargets, targetTokenId) {
  if (!profile || !targetTokenId) {
    return { ok: false, error: "missing spell target selection" };
  }

  if (profile.shape !== SPELL_TARGETING_SHAPES.SPLIT) {
    return {
      ok: true,
      selected_targets: [String(targetTokenId)]
    };
  }

  const currentTargets = normalizeSelectedTargetsForProfile(profile, selectedTargets);
  if (profile.allows_duplicate_targets === true) {
    if (Number.isFinite(profile.max_targets) && currentTargets.length >= profile.max_targets) {
      return {
        ok: false,
        error: `maximum spell targets already selected (${profile.max_targets})`
      };
    }
    return {
      ok: true,
      selected_targets: currentTargets.concat([String(targetTokenId)])
    };
  }

  if (currentTargets.includes(String(targetTokenId))) {
    return {
      ok: true,
      selected_targets: currentTargets
    };
  }

  if (Number.isFinite(profile.max_targets) && currentTargets.length >= profile.max_targets) {
    return {
      ok: false,
      error: `maximum spell targets already selected (${profile.max_targets})`
    };
  }

  const nextTargets = currentTargets.concat([String(targetTokenId)]);
  if (profile.requires_adjacent_selection === true && !areSelectedTargetsAdjacent(map, nextTargets)) {
    return {
      ok: false,
      error: "selected targets must be adjacent to each other"
    };
  }

  return {
    ok: true,
    selected_targets: nextTargets
  };
}

function filterValidTargetsForSelection(map, profile, validTargets, selectedTargets) {
  const safeTargets = Array.isArray(validTargets) ? validTargets : [];
  const currentTargets = normalizeSelectedTargetsForProfile(profile, selectedTargets);
  if (!profile || currentTargets.length === 0) {
    return safeTargets;
  }

  if (
    profile.requires_adjacent_selection === true &&
    currentTargets.length === 1
  ) {
    const anchor = findTargetToken(map, currentTargets[0]);
    if (!anchor || !anchor.position) {
      return safeTargets;
    }
    const selectedSet = new Set(currentTargets);
    return safeTargets.filter((entry) => (
      selectedSet.has(String(entry.token_id)) ||
      getDistance(anchor.position, entry, "chebyshev") <= 1
    ));
  }

  if (
    profile.allows_duplicate_targets !== true &&
    Number.isFinite(profile.max_targets) &&
    currentTargets.length >= profile.max_targets
  ) {
    const selectedSet = new Set(currentTargets);
    return safeTargets.filter((entry) => selectedSet.has(String(entry.token_id)));
  }

  return safeTargets;
}

function shouldRenderAreaOverlay(profile, options) {
  if (!profile) {
    return false;
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF || isSelfCenteredAreaProfile(profile)) {
    return true;
  }

  if (!isAreaTargetSelectionProfile(profile)) {
    return false;
  }

  if (options.target_position || options.target_token) {
    return true;
  }

  return profile.range_feet <= 0 &&
    [SPELL_TARGETING_SHAPES.CUBE, SPELL_TARGETING_SHAPES.SPHERE].includes(profile.shape);
}

function buildSpellTargetTileOptions(options) {
  return inspectSpellTargetTileOptions(options).valid_target_tiles;
}

function summarizeInvalidTargetTiles(entries) {
  const counts = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const label = String(entry && entry.reason_summary || "").trim();
    if (!label) {
      return;
    }
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function getSpellTargetPositionValidationDetails(options) {
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;
  const targetPosition = options.target_position;

  if (!map || !map.grid || !actor || !actor.position || !targetPosition || !profile) {
    return {
      ok: false,
      error: "invalid spell target position",
      reason_codes: ["invalid_target_position"],
      reason_summary: "invalid target position"
    };
  }

  if (
    targetPosition.x < 0 ||
    targetPosition.y < 0 ||
    targetPosition.x >= map.grid.width ||
    targetPosition.y >= map.grid.height
  ) {
    return {
      ok: false,
      error: "target position is out of bounds",
      reason_codes: ["out_of_bounds"],
      reason_summary: "out of bounds"
    };
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
    return actor.position.x === targetPosition.x && actor.position.y === targetPosition.y
      ? { ok: true, reason_codes: [], reason_summary: "" }
      : {
        ok: false,
        error: "self spells must target the caster tile",
        reason_codes: ["self_tile_only"],
        reason_summary: "self tile only"
      };
  }

  if (isSelfCenteredAreaProfile(profile)) {
    return actor.position.x === targetPosition.x && actor.position.y === targetPosition.y
      ? { ok: true, reason_codes: [], reason_summary: "" }
      : {
        ok: false,
        error: "this spell is centered on the caster",
        reason_codes: ["self_centered_only"],
        reason_summary: "caster centered"
      };
  }

  if ([SPELL_TARGETING_SHAPES.SINGLE, SPELL_TARGETING_SHAPES.SPLIT].includes(profile.shape)) {
    return {
      ok: false,
      error: "this spell requires a token target, not an empty tile",
      reason_codes: ["token_target_required"],
      reason_summary: "token target required"
    };
  }

  const distanceFeet = getTargetDistanceFeet(actor.position, targetPosition);
  if (distanceFeet > profile.range_feet && profile.range_feet > 0) {
    return {
      ok: false,
      error: "target position is out of spell range",
      reason_codes: ["out_of_range"],
      reason_summary: "out of range"
    };
  }

  if (profile.requires_line_of_sight && !hasLineOfSight(map, actor.position, targetPosition)) {
    return {
      ok: false,
      error: "target position is blocked by line of sight",
      reason_codes: ["line_of_sight_blocked"],
      reason_summary: "line of sight blocked"
    };
  }

  return { ok: true, reason_codes: [], reason_summary: "" };
}

function inspectSpellTargetTileOptions(options) {
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;

  if (!map || !map.grid || !actor || !actor.position || !isAreaTargetSelectionProfile(profile)) {
    return {
      valid_target_tiles: [],
      invalid_target_tiles: [],
      invalid_target_tile_summary: []
    };
  }

  const valid = [];
  const invalid = [];
  const addCandidate = (point) => {
    const validation = getSpellTargetPositionValidationDetails({
      map,
      actor,
      profile,
      target_position: point
    });
    const entry = {
      x: point.x,
      y: point.y,
      distance_feet: getTargetDistanceFeet(actor.position, point),
      line_of_sight: profile.requires_line_of_sight ? hasLineOfSight(map, actor.position, point) : true,
      reason_codes: validation.reason_codes || [],
      reason_summary: validation.reason_summary || ""
    };

    if (validation.ok) {
      valid.push(entry);
      return;
    }

    invalid.push(entry);
  };

  if (profile.range_feet <= 0) {
    if ([SPELL_TARGETING_SHAPES.CONE, SPELL_TARGETING_SHAPES.LINE].includes(profile.shape)) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const point = {
            x: actor.position.x + dx,
            y: actor.position.y + dy
          };
          if (
            point.x < 0 ||
            point.y < 0 ||
            point.x >= map.grid.width ||
            point.y >= map.grid.height
          ) {
            continue;
          }
          addCandidate(point);
        }
      }
    } else {
      addCandidate({
        x: actor.position.x,
        y: actor.position.y
      });
    }
  } else {
    for (let y = 0; y < map.grid.height; y += 1) {
      for (let x = 0; x < map.grid.width; x += 1) {
        addCandidate({ x, y });
      }
    }
  }

  const sortEntries = (left, right) => (
    left.distance_feet - right.distance_feet ||
    left.y - right.y ||
    left.x - right.x
  );

  return {
    valid_target_tiles: valid.sort(sortEntries),
    invalid_target_tiles: invalid.sort(sortEntries),
    invalid_target_tile_summary: summarizeInvalidTargetTiles(invalid)
  };
}

function buildSelectedTargetDetails(validTargets, targetTokenId) {
  const selected = (Array.isArray(validTargets) ? validTargets : []).find((entry) => (
    String(entry && entry.token_id || "") === String(targetTokenId || "")
  ));
  if (!selected) {
    return null;
  }

  return {
    name: String(selected.name || selected.token_id || ""),
    token_id: String(selected.token_id || ""),
    distance_feet: Number.isFinite(Number(selected.distance_feet)) ? Number(selected.distance_feet) : null,
    cover: selected.cover || null,
    line_of_sight: true
  };
}

function getTokenDisplayLabel(token) {
  if (!token || typeof token !== "object") {
    return "";
  }
  return String(token.name || token.display_name || token.token_id || token.label || "").trim();
}

function buildTargetPositionDetails(map, actor, profile, targetPosition) {
  if (!map || !actor || !actor.position || !profile || !targetPosition) {
    return null;
  }

  return {
    x: Number(targetPosition.x),
    y: Number(targetPosition.y),
    distance_feet: getTargetDistanceFeet(actor.position, targetPosition),
    line_of_sight: profile.requires_line_of_sight ? hasLineOfSight(map, actor.position, targetPosition) : true
  };
}

function buildAffectedUnits(map, areaTiles) {
  const safeTiles = Array.isArray(areaTiles) ? areaTiles : [];
  if (!map || safeTiles.length === 0) {
    return [];
  }

  const tileSet = new Set(safeTiles.map((tile) => `${Number(tile.x)},${Number(tile.y)}`));
  return (Array.isArray(map.tokens) ? map.tokens : [])
    .filter((token) => token && token.position && tileSet.has(`${Number(token.position.x)},${Number(token.position.y)}`))
    .map((token) => getTokenDisplayLabel(token))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function canSelectSpellTargetPosition(options) {
  const validation = getSpellTargetPositionValidationDetails(options);
  return validation.ok
    ? { ok: true }
    : { ok: false, error: validation.error };
}

function buildSpellPreviewOverlays(options) {
  const overlays = [];
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;

  if (!map || !actor || !actor.position || !profile) {
    return overlays;
  }

  if (profile.range_feet > 0 && profile.shape !== SPELL_TARGETING_SHAPES.SELF) {
    overlays.push(buildSpellRangeOverlay({
      map,
      origin: actor.position,
      range: Math.max(1, Math.ceil(profile.range_feet / 5)),
      include_origin: false,
      require_line_of_sight: profile.requires_line_of_sight
    }));
  }

  if (shouldRenderAreaOverlay(profile, options)) {
    const areaOverlay = buildSpellAreaOverlay({
      map,
      origin: actor.position,
      profile,
      target_position: options.target_position,
      target_token: options.target_token,
      valid_targets: options.valid_targets
    });

    if (areaOverlay.tiles.length > 0) {
      overlays.push(areaOverlay);
    }
  }

  return overlays;
}

function buildSpellSelectionOverlay(options) {
  const map = options.map;
  const selectedTargets = Array.isArray(options.selected_targets) ? options.selected_targets : [];
  const selectionCounts = selectedTargets.reduce((accumulator, tokenId) => {
    const safeTokenId = String(tokenId);
    accumulator[safeTokenId] = (accumulator[safeTokenId] || 0) + 1;
    return accumulator;
  }, {});
  const tiles = [];

  Object.keys(selectionCounts).forEach((tokenId) => {
    const token = findTargetToken(map, tokenId);
    if (!token) {
      return;
    }

    tiles.push({
      x: token.position.x,
      y: token.position.y,
      label: selectionCounts[tokenId] > 1 ? String(selectionCounts[tokenId]) : ""
    });
  });

  if (options.target_position && tiles.length === 0 && options.show_target_position_marker !== false) {
    tiles.push({
      x: options.target_position.x,
      y: options.target_position.y,
      label: "X"
    });
  }

  if (tiles.length === 0) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "spell-selection-overlay",
    color: "#ffd60a",
    marker_style: "target",
    tiles
  });
}

function buildValidatedSpellSelection(options) {
  const spell = findSpellById(options.spells, options.spell_id);
  if (!spell) {
    return {
      ok: false,
      error: "unknown spell"
    };
  }

  const profile = buildSpellTargetingProfile(spell);
  const targetInspection = inspectSpellTargets({
    map: options.map,
    actor: options.actor,
    profile
  });
  const validTargets = targetInspection.valid_targets;
  const invalidTargets = targetInspection.invalid_targets;
  const tileInspection = inspectSpellTargetTileOptions({
    map: options.map,
    actor: options.actor,
    profile
  });
  const validTargetIds = new Set(validTargets.map((entry) => String(entry.token_id)));

  let selectedTargets = normalizeSelectedTargetsForProfile(profile, options.existing_selected_targets);
  let targetToken = null;
  let targetPosition = options.target_position || null;

  if (options.reset_selected_targets === true) {
    selectedTargets = [];
  }

  if (options.target_token_ref) {
    targetToken = findTargetToken(options.map, options.target_token_ref);
    if (!targetToken) {
      return {
        ok: false,
        error: "unknown spell target token"
      };
    }

    if (!validTargetIds.has(String(targetToken.token_id))) {
      const invalidTarget = invalidTargets.find((entry) => String(entry.token_id) === String(targetToken.token_id));
      return {
        ok: false,
        error: invalidTarget ? invalidTarget.reason_summary : "target token is not a legal spell target"
      };
    }

    const nextSelection = applyTokenSelectionToTargets(
      options.map,
      profile,
      selectedTargets,
      String(targetToken.token_id)
    );
    if (!nextSelection.ok) {
      return nextSelection;
    }
    selectedTargets = nextSelection.selected_targets;

    targetPosition = {
      x: targetToken.position.x,
      y: targetToken.position.y
    };
  }

  if (isSelfCenteredAreaProfile(profile) && !targetPosition) {
    targetPosition = {
      x: options.actor.position.x,
      y: options.actor.position.y
    };
  }

  if (targetPosition && !targetToken) {
    const validTargetPosition = canSelectSpellTargetPosition({
      map: options.map,
      actor: options.actor,
      profile,
      target_position: targetPosition
    });
    if (!validTargetPosition.ok) {
      return validTargetPosition;
    }

    if (profile.shape !== SPELL_TARGETING_SHAPES.SPLIT) {
      selectedTargets = [];
    }
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF && selectedTargets.length === 0) {
    selectedTargets = [String(options.actor.token_id)];
    targetPosition = {
      x: options.actor.position.x,
      y: options.actor.position.y
    };
  }

  const validTargetTiles = tileInspection.valid_target_tiles;
  const displayedValidTargets = filterValidTargetsForSelection(
    options.map,
    profile,
    validTargets,
    selectedTargets
  );

  const overlays = buildSpellPreviewOverlays({
    map: options.map,
    actor: options.actor,
    profile,
    valid_targets: displayedValidTargets,
    target_position: targetPosition,
    target_token: targetToken
  });
  const selectionOverlay = buildSpellSelectionOverlay({
    map: options.map,
    selected_targets: selectedTargets,
    target_position: targetPosition,
    show_target_position_marker: !isSelfCenteredAreaProfile(profile)
  });
  if (selectionOverlay) {
    overlays.push(selectionOverlay);
  }
  const areaOverlay = overlays.find((overlay) => overlay.kind === "spell_area") || null;
  const selectedTargetDetails = buildSelectedTargetDetails(
    validTargets,
    targetToken && targetToken.token_id
      ? targetToken.token_id
      : (selectedTargets.length === 1 ? selectedTargets[0] : "")
  );
  const targetPositionDetails = buildTargetPositionDetails(options.map, options.actor, profile, targetPosition);
  const affectedUnits = buildAffectedUnits(options.map, areaOverlay ? areaOverlay.tiles : []);

  return {
    ok: true,
    payload: {
      spell_id: String(spell.spell_id || spell.id),
      spell_name: String(spell.name || ""),
      profile,
      valid_targets: displayedValidTargets,
      invalid_targets: invalidTargets,
      selected_targets: selectedTargets,
      target_position: targetPosition,
      target_token_id: targetToken ? String(targetToken.token_id) : "",
      valid_target_tiles: validTargetTiles,
      invalid_target_tile_summary: tileInspection.invalid_target_tile_summary,
      selected_target_details: selectedTargetDetails,
      target_position_details: targetPositionDetails,
      affected_units: affectedUnits,
      overlays,
      confirmed_area_tiles: areaOverlay ? areaOverlay.tiles : []
    }
  };
}

function buildSpellPreviewState(options) {
  const spell = findSpellById(options.spells, options.spell_id);
  if (!spell) {
    return {
      ok: false,
      error: "unknown spell"
    };
  }

  const support = getCombatMapSpellSupport(spell);
  if (!support.supported) {
    return {
      ok: false,
      error: support.reason
    };
  }

  const profile = buildSpellTargetingProfile(spell);
  if (
    options.target_token_ref ||
    options.target_position ||
    profile.shape === SPELL_TARGETING_SHAPES.SELF ||
    isSelfCenteredAreaProfile(profile)
  ) {
    const selected = buildValidatedSpellSelection({
      map: options.map,
      actor: options.actor,
      spells: options.spells,
      spell_id: options.spell_id,
      target_token_ref: options.target_token_ref,
      target_position: options.target_position
    });

    if (!selected.ok) {
      return selected;
    }

    return {
      ok: true,
      event_type: "spell_preview_ready",
      payload: {
        ...selected.payload,
        area_overlay: getSpellAreaOverlaySpec(selected.payload.profile)
      }
    };
  }

  const targetInspection = inspectSpellTargets({
    map: options.map,
    actor: options.actor,
    profile
  });
  const validTargets = targetInspection.valid_targets;
  const tileInspection = inspectSpellTargetTileOptions({
    map: options.map,
    actor: options.actor,
    profile
  });
  const validTargetTiles = tileInspection.valid_target_tiles;
  const targetToken = options.target_token_ref
    ? findTargetToken(options.map, options.target_token_ref)
    : null;
  const overlays = buildSpellPreviewOverlays({
    map: options.map,
    actor: options.actor,
    profile,
    valid_targets: validTargets,
    target_position: options.target_position,
    target_token: targetToken
  });
  const selectionOverlay = buildSpellSelectionOverlay({
    map: options.map,
    selected_targets: targetToken
      ? [String(targetToken.token_id)]
      : (profile.shape === SPELL_TARGETING_SHAPES.SELF ? [String(options.actor.token_id)] : []),
    target_position: options.target_position || (profile.shape === SPELL_TARGETING_SHAPES.SELF ? {
      x: options.actor.position.x,
      y: options.actor.position.y
    } : null),
    show_target_position_marker: !isSelfCenteredAreaProfile(profile)
  });
  if (selectionOverlay) {
    overlays.push(selectionOverlay);
  }
  const areaOverlay = overlays.find((overlay) => overlay.kind === "spell_area") || null;
  const selectedTargetDetails = buildSelectedTargetDetails(validTargets, targetToken && targetToken.token_id);
  const targetPositionDetails = buildTargetPositionDetails(options.map, options.actor, profile, options.target_position || (targetToken && targetToken.position ? targetToken.position : null));
  const affectedUnits = buildAffectedUnits(options.map, areaOverlay ? areaOverlay.tiles : []);

  return {
    ok: true,
    event_type: "spell_preview_ready",
    payload: {
      spell_id: String(spell.spell_id || spell.id),
      spell_name: String(spell.name || ""),
      profile,
      valid_targets: validTargets,
      invalid_targets: targetInspection.invalid_targets,
      valid_target_tiles: validTargetTiles,
      invalid_target_tile_summary: tileInspection.invalid_target_tile_summary,
      area_overlay: getSpellAreaOverlaySpec(profile),
      overlays,
      selected_targets: targetToken
        ? [targetToken.token_id]
        : (profile.shape === SPELL_TARGETING_SHAPES.SELF ? [options.actor.token_id] : []),
      confirmed_area_tiles: (() => {
        const areaOverlay = overlays.find((overlay) => overlay.kind === "spell_area");
        return areaOverlay ? areaOverlay.tiles : [];
      })(),
      selected_target_details: selectedTargetDetails,
      target_position_details: targetPositionDetails,
      affected_units: affectedUnits,
      target_position: options.target_position || (targetToken && targetToken.position ? {
        x: targetToken.position.x,
        y: targetToken.position.y
      } : (profile.shape === SPELL_TARGETING_SHAPES.SELF ? {
        x: options.actor.position.x,
        y: options.actor.position.y
      } : null)),
      target_token_id: targetToken ? targetToken.token_id : ""
    }
  };
}

function selectSpellTarget(options) {
  const spell = findSpellById(options.spells, options.spell_id);
  if (!spell) {
    return {
      ok: false,
      error: "unknown spell"
    };
  }

  const support = getCombatMapSpellSupport(spell);
  if (!support.supported) {
    return {
      ok: false,
      error: support.reason
    };
  }

  const selected = buildValidatedSpellSelection(options);
  if (!selected.ok) {
    return selected;
  }

  return {
    ok: true,
    event_type: "spell_target_selected",
    payload: {
      ...selected.payload
    }
  };
}

function confirmSpellSelection(options) {
  const spell = findSpellById(options.spells, options.spell_id);
  if (!spell) {
    return {
      ok: false,
      error: "unknown spell"
    };
  }

  const support = getCombatMapSpellSupport(spell);
  if (!support.supported) {
    return {
      ok: false,
      error: support.reason
    };
  }

  const profile = buildSpellTargetingProfile(spell);
  const selectedTargets = normalizeSelectedTargetsForProfile(profile, options.selected_targets);
  const targetPosition = options.target_position || null;
  const finalTargetPosition = targetPosition || (
    isSelfCenteredAreaProfile(profile) && options.actor && options.actor.position
      ? {
        x: options.actor.position.x,
        y: options.actor.position.y
      }
      : null
  );
  if (options.map && options.actor) {
    const selected = buildValidatedSpellSelection({
      map: options.map,
      actor: options.actor,
      spells: options.spells,
      spell_id: options.spell_id,
      existing_selected_targets: [],
      reset_selected_targets: true,
      target_token_ref: "",
      target_position: null
    });

    if (!selected.ok) {
      return selected;
    }

    const validTargetIds = new Set(selected.payload.valid_targets.map((entry) => String(entry.token_id)));
    if (selectedTargets.some((tokenId) => !validTargetIds.has(String(tokenId)))) {
      return {
        ok: false,
        error: "one or more selected spell targets are no longer legal"
      };
    }

    if (finalTargetPosition && selectedTargets.length === 0 && !isSelfCenteredAreaProfile(profile)) {
      const positionValidation = canSelectSpellTargetPosition({
        map: options.map,
        actor: options.actor,
        profile,
        target_position: finalTargetPosition
      });
      if (!positionValidation.ok) {
        return positionValidation;
      }
    }

    const selectedTargetEntries = selectedTargets
      .map((tokenId) => selected.payload.valid_targets.find((entry) => String(entry.token_id) === String(tokenId)))
      .filter(Boolean);
    const validation = validateSpellSelection({
      profile,
      selected_targets: selectedTargets,
      selected_target_entries: selectedTargetEntries
    });

    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error
      };
    }
  }

  const validation = validateSpellSelection({
    profile,
    selected_targets: selectedTargets
  });

  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error
    };
  }

  return {
    ok: true,
    event_type: "spell_selection_confirmed",
    payload: {
      spell_id: String(spell.spell_id || spell.id),
      spell_name: String(spell.name || ""),
      selected_targets: selectedTargets,
      target_position: finalTargetPosition,
      confirmed_area_tiles: Array.isArray(options.confirmed_area_tiles) ? options.confirmed_area_tiles : [],
      profile
    }
  };
}

module.exports = {
  listActorSpells,
  listActorCombatMapSpells,
  findSpellById,
  buildSpellPreviewOverlays,
  canSelectSpellTargetPosition,
  buildValidatedSpellSelection,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection
};

"use strict";

const { SPELL_TARGETING_SHAPES } = require("../constants");
const {
  buildSpellTargetingProfile,
  getValidSpellTargets,
  validateSpellSelection,
  getSpellAreaOverlaySpec
} = require("./spell-targeting");
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
      range: String(spell.range || ""),
      targeting_type: String(spell.targeting && spell.targeting.type || ""),
      attack_or_save_type: String(spell.attack_or_save && spell.attack_or_save.type || "none")
    }))
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
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

function canSelectSpellTargetPosition(options) {
  const map = options.map;
  const actor = options.actor;
  const profile = options.profile;
  const targetPosition = options.target_position;

  if (!map || !map.grid || !actor || !actor.position || !targetPosition || !profile) {
    return { ok: false, error: "invalid spell target position" };
  }

  if (
    targetPosition.x < 0 ||
    targetPosition.y < 0 ||
    targetPosition.x >= map.grid.width ||
    targetPosition.y >= map.grid.height
  ) {
    return { ok: false, error: "target position is out of bounds" };
  }

  if (profile.shape === SPELL_TARGETING_SHAPES.SELF) {
    return actor.position.x === targetPosition.x && actor.position.y === targetPosition.y
      ? { ok: true }
      : { ok: false, error: "self spells must target the caster tile" };
  }

  if ([SPELL_TARGETING_SHAPES.SINGLE, SPELL_TARGETING_SHAPES.SPLIT].includes(profile.shape)) {
    return {
      ok: false,
      error: "this spell requires a token target, not an empty tile"
    };
  }

  const distanceFeet = getTargetDistanceFeet(actor.position, targetPosition);
  if (distanceFeet > profile.range_feet && profile.range_feet > 0) {
    return { ok: false, error: "target position is out of spell range" };
  }

  if (profile.requires_line_of_sight && !hasLineOfSight(map, actor.position, targetPosition)) {
    return { ok: false, error: "target position is blocked by line of sight" };
  }

  return { ok: true };
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

  if ([SPELL_TARGETING_SHAPES.CONE, SPELL_TARGETING_SHAPES.CUBE, SPELL_TARGETING_SHAPES.SPHERE, SPELL_TARGETING_SHAPES.LINE, SPELL_TARGETING_SHAPES.SELF].includes(profile.shape)) {
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

  if (options.target_position && tiles.length === 0) {
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
  const validTargets = getValidSpellTargets({
    map: options.map,
    actor: options.actor,
    profile
  });
  const validTargetIds = new Set(validTargets.map((entry) => String(entry.token_id)));

  let selectedTargets = Array.isArray(options.existing_selected_targets)
    ? options.existing_selected_targets.map((entry) => String(entry))
    : [];
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
      return {
        ok: false,
        error: "target token is not a legal spell target"
      };
    }

    if (profile.shape === SPELL_TARGETING_SHAPES.SPLIT) {
      if (Number.isFinite(profile.max_targets) && selectedTargets.length >= profile.max_targets) {
        return {
          ok: false,
          error: `maximum split targets already selected (${profile.max_targets})`
        };
      }
      selectedTargets = selectedTargets.concat([String(targetToken.token_id)]);
    } else {
      selectedTargets = [String(targetToken.token_id)];
    }

    targetPosition = {
      x: targetToken.position.x,
      y: targetToken.position.y
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

  const overlays = buildSpellPreviewOverlays({
    map: options.map,
    actor: options.actor,
    profile,
    valid_targets: validTargets,
    target_position: targetPosition,
    target_token: targetToken
  });
  const selectionOverlay = buildSpellSelectionOverlay({
    map: options.map,
    selected_targets: selectedTargets,
    target_position: targetPosition
  });
  if (selectionOverlay) {
    overlays.push(selectionOverlay);
  }
  const areaOverlay = overlays.find((overlay) => overlay.kind === "spell_area") || null;

  return {
    ok: true,
    payload: {
      spell_id: String(spell.spell_id || spell.id),
      spell_name: String(spell.name || ""),
      profile,
      valid_targets: validTargets,
      selected_targets: selectedTargets,
      target_position: targetPosition,
      target_token_id: targetToken ? String(targetToken.token_id) : "",
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

  const profile = buildSpellTargetingProfile(spell);
  if (
    options.target_token_ref ||
    options.target_position ||
    profile.shape === SPELL_TARGETING_SHAPES.SELF
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

  const validTargets = getValidSpellTargets({
    map: options.map,
    actor: options.actor,
    profile
  });
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
    } : null)
  });
  if (selectionOverlay) {
    overlays.push(selectionOverlay);
  }

  return {
    ok: true,
    event_type: "spell_preview_ready",
    payload: {
      spell_id: String(spell.spell_id || spell.id),
      spell_name: String(spell.name || ""),
      profile,
      valid_targets: validTargets,
      area_overlay: getSpellAreaOverlaySpec(profile),
      overlays,
      selected_targets: targetToken
        ? [targetToken.token_id]
        : (profile.shape === SPELL_TARGETING_SHAPES.SELF ? [options.actor.token_id] : []),
      confirmed_area_tiles: (() => {
        const areaOverlay = overlays.find((overlay) => overlay.kind === "spell_area");
        return areaOverlay ? areaOverlay.tiles : [];
      })(),
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

  const profile = buildSpellTargetingProfile(spell);
  const selectedTargets = Array.isArray(options.selected_targets) ? options.selected_targets : [];
  const targetPosition = options.target_position || null;
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

    if (targetPosition && selectedTargets.length === 0) {
      const positionValidation = canSelectSpellTargetPosition({
        map: options.map,
        actor: options.actor,
        profile,
        target_position: targetPosition
      });
      if (!positionValidation.ok) {
        return positionValidation;
      }
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
      target_position: targetPosition,
      confirmed_area_tiles: Array.isArray(options.confirmed_area_tiles) ? options.confirmed_area_tiles : [],
      profile
    }
  };
}

module.exports = {
  listActorSpells,
  findSpellById,
  buildSpellPreviewOverlays,
  canSelectSpellTargetPosition,
  buildValidatedSpellSelection,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection
};

"use strict";

const { ATTACK_MODES } = require("../constants");
const {
  buildAttackProfile,
  inspectAttackTargets
} = require("../logic/attacks");
const {
  buildPhysicalRangeOverlay,
  buildSelectionOverlay
} = require("../logic/overlay-builders");

function findTargetToken(map, tokenId) {
  return (map && map.tokens || []).find((token) => String(token.token_id) === String(tokenId || "")) || null;
}

function buildActorAttackProfile(options) {
  const actor = options.actor || {};
  const profile = options.attack_profile || actor.attack_profile || actor.weapon_profile || {};
  return buildAttackProfile({
    weapon_profile_id: profile.weapon_profile_id || actor.weapon_profile_id || "",
    weapon_profile: profile.weapon_profile || actor.weapon_profile || null,
    weapon_name: profile.weapon_name || actor.weapon_name || "",
    weapon_category: profile.weapon_category || actor.weapon_category || "",
    mode: profile.mode || ATTACK_MODES.MELEE,
    range_feet: profile.range_feet,
    long_range_feet: profile.long_range_feet,
    reach_feet: profile.reach_feet,
    requires_line_of_sight: profile.requires_line_of_sight,
    metric: profile.metric,
    target_token_types: profile.target_token_types
  });
}

function buildAttackSelectionOverlay(target) {
  if (!target) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "attack-selection-overlay",
    color: "#ff453a",
    marker_style: "target",
    tiles: [{
      x: target.x,
      y: target.y,
      label: "ATK"
    }]
  });
}

function buildAttackPreviewState(options) {
  const actor = options.actor;
  const profile = buildActorAttackProfile(options);
  const targeting = inspectAttackTargets({
    map: options.map,
    attacker: actor,
    attack_profile: profile
  });
  const validTargets = targeting.valid_targets;
  const overlay = buildPhysicalRangeOverlay({
    map: options.map,
    attacker: actor,
    attack_profile: profile
  });

  return {
    ok: true,
    event_type: "attack_preview_ready",
    payload: {
      attack_profile: profile,
      valid_targets: validTargets,
      invalid_targets: targeting.invalid_targets,
      selected_target_id: "",
      selected_target_position: null,
      selected_target_range_band: "",
      overlays: [overlay]
    }
  };
}

function selectAttackTarget(options) {
  const actor = options.actor;
  const profile = buildActorAttackProfile(options);
  const targeting = inspectAttackTargets({
    map: options.map,
    attacker: actor,
    attack_profile: profile
  });
  const validTargets = targeting.valid_targets;
  const invalidTargets = targeting.invalid_targets;

  if (options.target_token_ref) {
    const targetToken = findTargetToken(options.map, options.target_token_ref);
    if (!targetToken) {
      return { ok: false, error: "unknown attack target token" };
    }

    const isValid = validTargets.some((entry) => String(entry.token_id) === String(targetToken.token_id));
    if (!isValid) {
      const invalidTarget = invalidTargets.find((entry) => String(entry.token_id) === String(targetToken.token_id));
      return { ok: false, error: invalidTarget ? invalidTarget.reason_summary : "target token is not a legal attack target" };
    }

    const overlay = buildPhysicalRangeOverlay({
      map: options.map,
      attacker: actor,
      attack_profile: profile
    });
    const selectedTarget = validTargets.find((entry) => String(entry.token_id) === String(targetToken.token_id));
    const selectionOverlay = buildAttackSelectionOverlay(selectedTarget);

    return {
      ok: true,
      event_type: "attack_target_selected",
      payload: {
        attack_profile: profile,
        valid_targets: validTargets,
        invalid_targets: invalidTargets,
        selected_target_id: targetToken.token_id,
        selected_target_position: {
          x: targetToken.position.x,
          y: targetToken.position.y
        },
        selected_target_range_band: selectedTarget ? selectedTarget.range_band : "",
        overlays: [overlay].concat(selectionOverlay ? [selectionOverlay] : [])
      }
    };
  }

  if (options.target_position) {
    const selected = validTargets.find((entry) => (
      Number(entry.x) === Number(options.target_position.x) &&
      Number(entry.y) === Number(options.target_position.y)
    ));

    if (!selected) {
      const tokenAtTile = (options.map && options.map.tokens || []).find((token) => (
        token && token.position &&
        Number(token.position.x) === Number(options.target_position.x) &&
        Number(token.position.y) === Number(options.target_position.y)
      ));
      const invalidTarget = tokenAtTile
        ? invalidTargets.find((entry) => String(entry.token_id) === String(tokenAtTile.token_id))
        : null;
      return { ok: false, error: invalidTarget ? invalidTarget.reason_summary : "target tile does not contain a legal attack target" };
    }

    const overlay = buildPhysicalRangeOverlay({
      map: options.map,
      attacker: actor,
      attack_profile: profile
    });
    const selectionOverlay = buildAttackSelectionOverlay(selected);

    return {
      ok: true,
      event_type: "attack_target_selected",
      payload: {
        attack_profile: profile,
        valid_targets: validTargets,
        invalid_targets: invalidTargets,
        selected_target_id: selected.token_id,
        selected_target_position: {
          x: selected.x,
          y: selected.y
        },
        selected_target_range_band: selected.range_band || "",
        overlays: [overlay].concat(selectionOverlay ? [selectionOverlay] : [])
      }
    };
  }

  return { ok: false, error: "no attack target selected" };
}

module.exports = {
  buildActorAttackProfile,
  buildAttackPreviewState,
  selectAttackTarget
};

"use strict";

const { MAP_BUTTON_ACTIONS, parseMapButtonCustomId } = require("../discord/map-ui.contract");
const {
  createMoveToCoordinateAction,
  createAttackTargetTokenAction,
  createAttackTargetCoordinateAction,
  createCastSpellAction,
  createSelectTokenAction
} = require("../contracts/map-action.contract");
const {
  buildMapMessageEditPayload,
  buildMovePreviewMessagePayload,
  buildAttackPreviewMessagePayload,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionMessagePayload,
  buildSpellPreviewMessagePayload
} = require("../discord/map-message-builder");
const { buildActorMovementOverlay, buildSelectionOverlay } = require("../logic/overlay-builders");
const { resolveActorMovementSpeedFeet } = require("../logic/actor-movement");
const {
  normalizeDebugFlags,
  toggleDebugFlag
} = require("./debug-flags");
const {
  buildAttackPreviewState,
  selectAttackTarget
} = require("../attacks/attack-interaction.service");
const { buildTokenSelectionChoices, applyPlayerTokenChoice } = require("../tokens/token-selection.service");
const {
  listActorCombatMapSpells,
  buildSpellPreviewState,
  selectSpellTarget,
  confirmSpellSelection
} = require("../spells/spell-interaction.service");
const { parseMapCommand } = require("../commands/map-command-parser");
const { SPELL_TARGETING_SHAPES } = require("../constants");

const INTERACTION_MODES = Object.freeze({
  IDLE: "idle",
  MOVE: "move",
  ATTACK: "attack",
  SPELL_LIST: "spell_list",
  SPELL_PREVIEW: "spell_preview",
  TOKEN_LIST: "token_list",
  CONFIRM: "confirm"
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createIdleState(context) {
  return {
    mode: INTERACTION_MODES.IDLE,
    actor_id: context.actor_id || "unknown",
    instance_id: context.instance_id || "unknown",
    instance_type: context.instance_type || "combat",
    map_id: context.map && context.map.map_id ? context.map.map_id : "",
    debug_flags: normalizeDebugFlags(context.state && context.state.debug_flags),
    pending: null
  };
}

function findActorToken(map, actorId) {
  return (map.tokens || []).find((token) => String(token.actor_id || token.token_id) === String(actorId || "")) || null;
}

function getTurnLabel(context) {
  const actorToken = context.map ? findActorToken(context.map, context.actor_id) : null;
  return actorToken && actorToken.label
    ? actorToken.label
    : String(context.actor_id || "unknown");
}

function replaceToken(map, token) {
  const nextMap = clone(map);
  nextMap.tokens = (nextMap.tokens || []).map((entry) => (
    String(entry.token_id) === String(token.token_id) ? token : entry
  ));
  return nextMap;
}

function mergePreviewMap(map, preview) {
  const nextMap = clone(map);
  nextMap.overlays = [].concat(
    Array.isArray(map.overlays) ? map.overlays : [],
    preview && Array.isArray(preview.overlays) ? preview.overlays : []
  );
  return nextMap;
}

function buildIdlePayload(context, content) {
  return buildMapMessageEditPayload({
    message_id: context.message_id,
    actor_id: context.actor_id,
    instance_id: context.instance_id,
    instance_type: context.instance_type,
    turn_label: getTurnLabel(context),
    mode_label: "Ready",
    content: content || "Map ready.",
    debug_flags: context.state && context.state.debug_flags,
    files: context.files || []
  });
}

function buildActionContext(context) {
  return {
    actor_id: context.actor_id,
    instance_id: context.instance_id,
    instance_type: context.instance_type,
    map_id: context.map && context.map.map_id ? context.map.map_id : "",
    source: "map_system"
  };
}

function canConfirmSpellPreview(preview) {
  if (!preview || !preview.profile) {
    return false;
  }

  if (
    [SPELL_TARGETING_SHAPES.SELF, SPELL_TARGETING_SHAPES.UTILITY].includes(preview.profile.shape) ||
    preview.profile.self_centered_area === true
  ) {
    return true;
  }

  if (
    preview.profile.requires_exact_target_count === true &&
    Number.isFinite(preview.profile.max_targets)
  ) {
    return Array.isArray(preview.selected_targets) && preview.selected_targets.length === preview.profile.max_targets;
  }

  if (
    Array.isArray(preview.selected_targets) &&
    preview.selected_targets.length >= Math.max(1, Number(preview.profile.min_targets || 0))
  ) {
    return true;
  }

  return Boolean(preview.target_position);
}

function buildContextWithDebugFlags(context, debugFlags) {
  return {
    ...context,
    state: {
      ...(context.state && typeof context.state === "object" ? context.state : createIdleState(context)),
      debug_flags: normalizeDebugFlags(debugFlags)
    }
  };
}

function rerenderCurrentMode(context, nextContext) {
  const activeContext = nextContext || context;
  const mode = activeContext.state && activeContext.state.mode
    ? activeContext.state.mode
    : INTERACTION_MODES.IDLE;
  const pending = activeContext.state && activeContext.state.pending
    ? activeContext.state.pending
    : null;

  if (mode === INTERACTION_MODES.MOVE && pending && pending.preview) {
    return renderMovePreview(activeContext, pending.preview, pending.page || 1);
  }

  if (mode === INTERACTION_MODES.ATTACK && pending && pending.preview) {
    return renderAttackPreview(activeContext, pending.preview, pending.page || 1);
  }

  if (mode === INTERACTION_MODES.SPELL_LIST && pending && pending.spells) {
    return renderSpellMode(activeContext, pending.spells, pending.unsupported_spells, pending.page || 1);
  }

  if (mode === INTERACTION_MODES.SPELL_PREVIEW && pending && pending.preview) {
    return renderSpellPreview(activeContext, pending.spell_id || "", pending.preview, pending.page || 1);
  }

  if (mode === INTERACTION_MODES.TOKEN_LIST && pending && pending.token_choices) {
    return renderTokenMode(activeContext, pending.token_choices, pending.page || 1);
  }

  return {
    ok: true,
    state: createIdleState(activeContext),
    payload: buildIdlePayload(activeContext, "Map ready.")
  };
}

function toggleDebugOverlay(context, debugKey) {
  const nextContext = buildContextWithDebugFlags(
    context,
    toggleDebugFlag(context.state && context.state.debug_flags, debugKey)
  );
  return rerenderCurrentMode(context, nextContext);
}

function renderTokenMode(context, choices, page) {
  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.TOKEN_LIST,
      pending: {
        token_choices: choices,
        page: page || 1
      }
    },
    payload: buildTokenSelectionMessagePayload({
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      debug_flags: context.state && context.state.debug_flags,
      choices,
      page: page || 1
    })
  };
}

function renderSpellMode(context, spells, unsupportedSpells, page) {
  const unsupported = Array.isArray(unsupportedSpells) ? unsupportedSpells : [];
  const supported = Array.isArray(spells) ? spells : [];
  const unsupportedNames = unsupported.slice(0, 5).map((entry) => entry.name).filter(Boolean);
  const content = supported.length > 0
    ? null
    : buildSpellSelectionMessagePayload({
        actor_id: context.actor_id,
        instance_id: context.instance_id,
        instance_type: context.instance_type,
        turn_label: getTurnLabel(context),
        debug_flags: context.state && context.state.debug_flags,
        spells: supported,
        page: page || 1,
        unsupported_spells: unsupported,
        content: [
          "No map-interpretable spells are available right now.",
          unsupportedNames.length > 0 ? `Unsupported here: ${unsupportedNames.join(", ")}` : "",
          "This view only hides spells whose targeting profile is not yet understood by the map-system interpreter."
        ].filter(Boolean).join("\n")
      }).content;

  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.SPELL_LIST,
      pending: {
        spells,
        unsupported_spells: unsupported,
        page: page || 1
      }
    },
    payload: buildSpellSelectionMessagePayload({
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      debug_flags: context.state && context.state.debug_flags,
      spells,
      unsupported_spells: unsupported,
      page: page || 1,
      content
    })
  };
}

function renderAttackPreview(context, preview, page) {
  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.ATTACK,
      pending: {
        preview,
        page: page || 1
      }
    },
    payload: buildAttackPreviewMessagePayload({
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      debug_flags: context.state && context.state.debug_flags,
      valid_targets: preview.valid_targets,
      invalid_targets: preview.invalid_targets || [],
      selected_target_id: preview.selected_target_id,
      attack_profile: preview.attack_profile,
      files: context.files || [],
      page: page || 1
    }),
    preview,
    preview_map: mergePreviewMap(context.map, preview)
  };
}

function buildMoveSelectionOverlay(target) {
  if (!target) {
    return null;
  }

  return buildSelectionOverlay({
    overlay_id: "move-selection-overlay",
    color: "#ffd60a",
    marker_style: "move",
    tiles: [{
      x: target.x,
      y: target.y
    }]
  });
}

function renderMovePreview(context, preview, page) {
  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.MOVE,
      pending: {
        preview,
        page: page || 1
      }
    },
    payload: buildMovePreviewMessagePayload({
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      debug_flags: context.state && context.state.debug_flags,
      reachable_tiles: preview.reachable_tiles || [],
      selected_target_position: preview.selected_target_position || null,
      selected_target: preview.selected_target || null,
      movement_speed_feet: preview.movement_speed_feet || 0,
      files: context.files || [],
      page: page || 1
    }),
    preview,
    preview_map: mergePreviewMap(context.map, preview)
  };
}

function renderSpellPreview(context, spellId, preview, page) {
  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.SPELL_PREVIEW,
      pending: {
        spell_id: spellId,
        preview,
        page: page || 1
      }
    },
    payload: buildSpellPreviewMessagePayload({
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      debug_flags: context.state && context.state.debug_flags,
      spell_id: spellId,
      spell_name: preview.spell_name,
      range_feet: preview.profile && preview.profile.range_feet,
      spell_shape: preview.profile && preview.profile.shape,
      area_size_feet: preview.profile && preview.profile.area_size_feet,
      valid_targets: preview.valid_targets,
      invalid_targets: preview.invalid_targets || [],
      valid_target_tiles: preview.valid_target_tiles || [],
      invalid_target_tile_summary: preview.invalid_target_tile_summary || [],
      selected_targets: preview.selected_targets || [],
      selected_target_details: preview.selected_target_details || null,
      target_position: preview.target_position || null,
      target_position_details: preview.target_position_details || null,
      affected_units: preview.affected_units || [],
      can_confirm: canConfirmSpellPreview(preview),
      min_targets: preview.profile && preview.profile.min_targets,
      max_targets: preview.profile && preview.profile.max_targets,
      line_width_feet: preview.profile && preview.profile.line_width_feet,
      targeting_type: preview.profile && preview.profile.targeting_type,
      requires_exact_target_count: preview.profile && preview.profile.requires_exact_target_count,
      requires_adjacent_selection: preview.profile && preview.profile.requires_adjacent_selection,
      self_centered_area: preview.profile && preview.profile.self_centered_area,
      show_clear_button: preview.profile && preview.profile.shape === SPELL_TARGETING_SHAPES.SPLIT && (preview.selected_targets || []).length > 0,
      page: page || 1
    }),
    preview,
    preview_map: mergePreviewMap(context.map, preview)
  };
}

function enterMoveMode(context) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }
  const movementSpeedFeet = resolveActorMovementSpeedFeet({
    actor: actorToken,
    context
  });

  const movementOverlay = buildActorMovementOverlay({
    map: context.map,
    actor: actorToken,
    context,
    allow_diagonal: true
  });

  return renderMovePreview(context, {
    movement_speed_feet: movementSpeedFeet,
    reachable_tiles: movementOverlay && movementOverlay.metadata && Array.isArray(movementOverlay.metadata.reachable_tiles)
      ? movementOverlay.metadata.reachable_tiles
      : [],
    selected_target_position: null,
    selected_target: null,
    overlays: [movementOverlay]
  }, 1);
}

function applyMoveTargetSelection(context, selection) {
  const pendingPreview = context.state && context.state.pending && context.state.pending.preview
    ? context.state.pending.preview
    : null;
  if (!pendingPreview || !Array.isArray(pendingPreview.reachable_tiles)) {
    return { ok: false, error: "no active move preview to select from" };
  }

  const selected = pendingPreview.reachable_tiles.find((tile) => (
    Number(tile.x) === Number(selection && selection.target_position && selection.target_position.x) &&
    Number(tile.y) === Number(selection && selection.target_position && selection.target_position.y)
  ));
  if (!selected) {
    return { ok: false, error: "selected destination is not reachable" };
  }

  const movementOverlay = Array.isArray(pendingPreview.overlays)
    ? pendingPreview.overlays.find((overlay) => overlay && overlay.kind === "move") || pendingPreview.overlays[0]
    : null;
  const selectionOverlay = buildMoveSelectionOverlay(selected);

  return renderMovePreview(context, {
    movement_speed_feet: pendingPreview.movement_speed_feet || 0,
    reachable_tiles: pendingPreview.reachable_tiles,
    selected_target_position: {
      x: selected.x,
      y: selected.y
    },
    selected_target: selected,
    overlays: [movementOverlay].concat(selectionOverlay ? [selectionOverlay] : []).filter(Boolean)
  }, context.state && context.state.pending && context.state.pending.page || 1);
}

function confirmMove(context) {
  const pendingPreview = context.state && context.state.pending && context.state.pending.preview
    ? context.state.pending.preview
    : null;
  if (!pendingPreview || !pendingPreview.selected_target_position) {
    return { ok: false, error: "no move destination selected" };
  }

  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.CONFIRM,
      pending: {
        move_target: pendingPreview.selected_target_position
      }
    },
    payload: buildMapMessageEditPayload({
      message_id: context.message_id,
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      mode_label: "Move Confirmed",
      content: `Move confirmed: ${pendingPreview.selected_target_position.x},${pendingPreview.selected_target_position.y}`,
      debug_flags: context.state && context.state.debug_flags,
      files: context.files || []
    }),
    action_intent: {
      intent_type: "move_to_coordinate",
      payload: pendingPreview.selected_target_position
    },
    action_contract: createMoveToCoordinateAction(buildActionContext(context), pendingPreview.selected_target_position)
  };
}

function enterAttackMode(context) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }

  const preview = buildAttackPreviewState({
    map: context.map,
    actor: actorToken,
    attack_profile: context.attack_profile || actorToken.attack_profile || null
  });

  return renderAttackPreview(context, preview.payload, 1);
}

function applyAttackTargetSelection(context, selection) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }

  const selected = selectAttackTarget({
    map: context.map,
    actor: actorToken,
    attack_profile: context.attack_profile || actorToken.attack_profile || null,
    target_token_ref: selection.target_token_ref || "",
    target_position: selection.target_position || null
  });

  if (!selected.ok) {
    return selected;
  }

  return renderAttackPreview(context, selected.payload, context.state && context.state.pending && context.state.pending.page || 1);
}

function confirmAttack(context) {
  const pendingPreview = context.state && context.state.pending && context.state.pending.preview
    ? context.state.pending.preview
    : null;
  if (!pendingPreview || !pendingPreview.selected_target_id) {
    return { ok: false, error: "no attack target selected" };
  }

  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.CONFIRM,
      pending: {
        attack_confirmation: pendingPreview
      }
    },
    payload: buildMapMessageEditPayload({
      message_id: context.message_id,
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      mode_label: "Attack Confirmed",
      content: `Attack confirmed: ${pendingPreview.selected_target_id}`,
      debug_flags: context.state && context.state.debug_flags,
      files: context.files || []
    }),
    action_intent: {
      intent_type: "attack_target_token",
      payload: pendingPreview.selected_target_id
    },
    action_contract: createAttackTargetTokenAction(
      buildActionContext(context),
      pendingPreview.selected_target_id,
      pendingPreview
    )
  };
}

function enterTokenMode(context) {
  const choices = buildTokenSelectionChoices({
    catalog: context.token_catalog || []
  });
  return renderTokenMode(context, choices, 1);
}

function enterSpellMode(context) {
  const actorToken = findActorToken(context.map, context.actor_id);
  const spellPartition = listActorCombatMapSpells({
    actor: actorToken || {},
    spells: context.spells || []
  });

  return renderSpellMode(context, spellPartition.supported, spellPartition.unsupported, 1);
}

function previewSpell(context, spellId, previewTarget) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }

  const preview = buildSpellPreviewState({
    map: context.map,
    actor: actorToken,
    spells: context.spells || [],
    spell_id: spellId,
    target_position: previewTarget && previewTarget.target_position || null,
    target_token_ref: previewTarget && previewTarget.target_token_ref || ""
  });

  if (!preview.ok) {
    return preview;
  }

  return renderSpellPreview(context, spellId, preview.payload, 1);
}

function applySpellTargetSelection(context, spellId, selection) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }

  const selected = selectSpellTarget({
    map: context.map,
    actor: actorToken,
    spells: context.spells || [],
    spell_id: spellId,
    target_token_ref: selection.target_token_ref || "",
    target_position: selection.target_position || null,
    existing_selected_targets: context.state && context.state.pending && context.state.pending.preview
      ? context.state.pending.preview.selected_targets
      : [],
    reset_selected_targets: selection.reset_selected_targets === true
  });

  if (!selected.ok) {
    return selected;
  }

  return renderSpellPreview(
    context,
    spellId,
    selected.payload,
    context.state && context.state.pending && context.state.pending.page || 1
  );
}

function confirmSpell(context, spellId, selectedTargets) {
  const pendingPreview = context.state && context.state.pending && context.state.pending.preview
    ? context.state.pending.preview
    : null;
  const resolvedTargets = Array.isArray(selectedTargets) && selectedTargets.length > 0
    ? selectedTargets
    : (pendingPreview && Array.isArray(pendingPreview.selected_targets) ? pendingPreview.selected_targets : []);
  const resolvedTargetPosition = pendingPreview && pendingPreview.target_position
    ? pendingPreview.target_position
    : null;
  const resolvedAreaTiles = pendingPreview && Array.isArray(pendingPreview.confirmed_area_tiles)
    ? pendingPreview.confirmed_area_tiles
    : [];
  const confirmation = confirmSpellSelection({
    spells: context.spells || [],
    spell_id: spellId,
    selected_targets: resolvedTargets,
    target_position: resolvedTargetPosition,
    confirmed_area_tiles: resolvedAreaTiles,
    map: context.map,
    actor: findActorToken(context.map, context.actor_id)
  });

  if (!confirmation.ok) {
    return confirmation;
  }

  return {
    ok: true,
    state: {
      ...createIdleState(context),
      mode: INTERACTION_MODES.CONFIRM,
      pending: {
        spell_confirmation: confirmation.payload
      }
    },
    payload: buildMapMessageEditPayload({
      message_id: context.message_id,
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel(context),
      mode_label: "Spell Confirmed",
      content: `Spell confirmed: ${confirmation.payload.spell_name}`,
      debug_flags: context.state && context.state.debug_flags,
      files: context.files || []
      }),
    action_intent: {
      intent_type: "cast_spell",
      payload: confirmation.payload
    },
    action_contract: createCastSpellAction(buildActionContext(context), confirmation.payload)
  };
}

function applyTokenSelection(context, tokenChoiceId) {
  const actorToken = findActorToken(context.map, context.actor_id);
  if (!actorToken) {
    return { ok: false, error: "actor token not found" };
  }

  const selection = applyPlayerTokenChoice({
    catalog: context.token_catalog || [],
    token_choice_id: tokenChoiceId,
    token_id: actorToken.token_id,
    label: actorToken.label,
    actor_id: actorToken.actor_id || context.actor_id,
    character_id: actorToken.character_id || "",
    position: actorToken.position,
    badge_text: actorToken.badge_text,
    border_color: actorToken.border_color
  });

  if (!selection.ok) {
    return selection;
  }

  const nextMap = replaceToken(context.map, selection.payload.token);
  return {
    ok: true,
    state: createIdleState({
      ...context,
      map: nextMap
    }),
    payload: buildMapMessageEditPayload({
      message_id: context.message_id,
      actor_id: context.actor_id,
      instance_id: context.instance_id,
      instance_type: context.instance_type,
      turn_label: getTurnLabel({
        ...context,
        map: nextMap
      }),
      mode_label: "Token Selected",
      content: `Token selected: ${tokenChoiceId}`,
      debug_flags: context.state && context.state.debug_flags,
      files: context.files || []
    }),
    map: nextMap,
    action_intent: {
      intent_type: "select_token",
      payload: selection.payload
    },
    action_contract: createSelectTokenAction(buildActionContext(context), selection.payload)
  };
}

function handleButtonAction(context, customId) {
  const parsed = parseMapButtonCustomId(customId);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.DEBUG_TOGGLE},`)) {
    return toggleDebugOverlay(context, parsed.action.split(",")[1] || "");
  }
  if (parsed.action === MAP_BUTTON_ACTIONS.MOVE) return enterMoveMode(context);
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.MOVE_TARGET},`)) {
    return applyMoveTargetSelection(context, {
      target_position: {
        x: Number(parsed.action.split(",")[1]),
        y: Number(parsed.action.split(",")[2])
      }
    });
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.MOVE_PAGE},`)) {
    const page = Number(parsed.action.split(",")[1] || 1);
    const preview = context.state && context.state.pending && context.state.pending.preview;
    if (!preview) {
      return { ok: false, error: "no active move preview to page" };
    }
    return renderMovePreview(context, preview, page);
  }
  if (parsed.action === MAP_BUTTON_ACTIONS.MOVE_CONFIRM) return confirmMove(context);
  if (parsed.action === MAP_BUTTON_ACTIONS.ATTACK) return enterAttackMode(context);
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.ATTACK_TARGET},`)) {
    return applyAttackTargetSelection(context, {
      target_token_ref: parsed.action.split(",")[1] || ""
    });
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.ATTACK_PAGE},`)) {
    const page = Number(parsed.action.split(",")[1] || 1);
    const preview = context.state && context.state.pending && context.state.pending.preview;
    if (!preview) {
      return { ok: false, error: "no active attack preview to page" };
    }
    return renderAttackPreview(context, preview, page);
  }
  if (parsed.action === MAP_BUTTON_ACTIONS.ATTACK_CONFIRM) return confirmAttack(context);
  if (parsed.action === MAP_BUTTON_ACTIONS.TOKEN) return enterTokenMode(context);
  if (parsed.action === MAP_BUTTON_ACTIONS.SPELL) return enterSpellMode(context);
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.TOKEN_SELECT},`)) {
    return applyTokenSelection(context, parsed.action.split(",")[1] || "");
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.TOKEN_PAGE},`)) {
    const page = Number(parsed.action.split(",")[1] || 1);
    const choices = context.state && context.state.pending && context.state.pending.token_choices;
    if (!choices) {
      return { ok: false, error: "no active token selection to page" };
    }
    return renderTokenMode(context, choices, page);
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_TARGET_TOKEN},`)) {
    return applySpellTargetSelection(context, parsed.action.split(",")[1] || "", {
      target_token_ref: parsed.action.split(",")[2] || ""
    });
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_TARGET_TILE},`)) {
    return applySpellTargetSelection(context, parsed.action.split(",")[1] || "", {
      target_position: {
        x: Number(parsed.action.split(",")[2]),
        y: Number(parsed.action.split(",")[3])
      }
    });
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_TARGET_PAGE},`)) {
    const spellId = parsed.action.split(",")[1] || "";
    const page = Number(parsed.action.split(",")[2] || 1);
    const preview = context.state && context.state.pending && context.state.pending.preview;
    if (!preview) {
      return { ok: false, error: "no active spell preview to page" };
    }
    return renderSpellPreview(context, spellId, preview, page);
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_TARGET_TILE_PAGE},`)) {
    const spellId = parsed.action.split(",")[1] || "";
    const page = Number(parsed.action.split(",")[2] || 1);
    const preview = context.state && context.state.pending && context.state.pending.preview;
    if (!preview) {
      return { ok: false, error: "no active spell tile preview to page" };
    }
    return renderSpellPreview(context, spellId, preview, page);
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_CLEAR_TARGETS},`)) {
    return applySpellTargetSelection(context, parsed.action.split(",")[1] || "", {
      reset_selected_targets: true
    });
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_CONFIRM},`)) {
    return confirmSpell(context, parsed.action.split(",")[1] || "", context.selected_targets || []);
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL},`)) {
    return previewSpell(context, parsed.action.split(",")[1] || "");
  }
  if (parsed.action.startsWith(`${MAP_BUTTON_ACTIONS.SPELL_PAGE},`)) {
    const page = Number(parsed.action.split(",")[1] || 1);
    const spells = context.state && context.state.pending && context.state.pending.spells;
    const unsupportedSpells = context.state && context.state.pending && context.state.pending.unsupported_spells;
    if (!spells) {
      return { ok: false, error: "no active spell list to page" };
    }
    return renderSpellMode(context, spells, unsupportedSpells, page);
  }
  if (parsed.action === MAP_BUTTON_ACTIONS.BACK) {
    return {
      ok: true,
      state: createIdleState(context),
      payload: buildIdlePayload(context, "Returned to map actions.")
    };
  }

  return {
    ok: false,
    error: "unsupported button action"
  };
}

function handleTextCommand(context, text) {
  const parsed = parseMapCommand(text);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.action === "move") {
    const actorToken = findActorToken(context.map || { tokens: [] }, context.actor_id);
    if (!actorToken) {
      return { ok: false, error: "actor token not found" };
    }
    const movementSpeedFeet = resolveActorMovementSpeedFeet({
      actor: actorToken,
      context
    });

    const movementOverlay = buildActorMovementOverlay({
      map: context.map,
      actor: actorToken,
      context,
      allow_diagonal: true
    });
    const isLegalDestination = movementOverlay.tiles.some((tile) => (
      Number(tile.x) === Number(parsed.target_position.x) &&
      Number(tile.y) === Number(parsed.target_position.y)
    ));

    if (!isLegalDestination) {
      return { ok: false, error: "target position is not a legal move destination" };
    }

    return {
      ok: true,
      state: {
        ...createIdleState(context),
        mode: INTERACTION_MODES.CONFIRM,
        pending: {
          move_target: parsed.target_position
        }
      },
      payload: buildMapMessageEditPayload({
        message_id: context.message_id,
        actor_id: context.actor_id,
        instance_id: context.instance_id,
        instance_type: context.instance_type,
        turn_label: getTurnLabel(context),
        mode_label: "Move Selected",
        content: `Move selected: ${parsed.target_position.x},${parsed.target_position.y} (${movementSpeedFeet} foot speed preview)`,
        debug_flags: context.state && context.state.debug_flags,
        files: context.files || []
      }),
      action_intent: {
        intent_type: "move_to_coordinate",
        payload: parsed.target_position
      },
      action_contract: createMoveToCoordinateAction(buildActionContext(context), parsed.target_position)
    };
  }

  if (parsed.action === "attack") {
    return applyAttackTargetSelection(context, {
      target_token_ref: parsed.target_token_ref,
      target_position: parsed.target_position
    });
  }

  if (parsed.action === "spell") {
    return previewSpell(context, parsed.spell_ref, {
      target_position: parsed.target_position,
      target_token_ref: parsed.target_token_ref
    });
  }

  if (parsed.action === "target") {
    const activeSpellId = context.state && context.state.pending && context.state.pending.spell_id;
    if (!activeSpellId) {
      return {
        ok: false,
        error: "no active spell preview for target selection"
      };
    }

    return applySpellTargetSelection(context, activeSpellId, {
      target_token_ref: parsed.target_token_ref,
      target_position: parsed.target_position
    });
  }

  return {
    ok: false,
    error: "unsupported text action"
  };
}

module.exports = {
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
};

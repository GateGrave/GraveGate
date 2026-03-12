"use strict";

const MAP_ACTION_TYPES = Object.freeze({
  MOVE_TO_COORDINATE: "move_to_coordinate",
  ATTACK_TARGET_TOKEN: "attack_target_token",
  ATTACK_TARGET_COORDINATE: "attack_target_coordinate",
  CAST_SPELL: "cast_spell",
  SELECT_TOKEN: "select_token"
});

function createMapAction(type, payload, context) {
  const safePayload = payload || {};
  const safeContext = context || {};

  return {
    action_id: safeContext.action_id || `map-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action_type: type,
    actor_id: safeContext.actor_id || "unknown",
    instance_id: safeContext.instance_id || "unknown",
    instance_type: safeContext.instance_type || "combat",
    map_id: safeContext.map_id || "",
    source: safeContext.source || "map_system",
    payload: safePayload
  };
}

function createMoveToCoordinateAction(context, targetPosition) {
  return createMapAction(MAP_ACTION_TYPES.MOVE_TO_COORDINATE, {
    target_position: targetPosition
  }, context);
}

function createAttackTargetTokenAction(context, targetTokenId, attackSelection) {
  return createMapAction(MAP_ACTION_TYPES.ATTACK_TARGET_TOKEN, {
    target_token_id: targetTokenId,
    target_position: attackSelection && attackSelection.selected_target_position
      ? attackSelection.selected_target_position
      : null,
    attack_profile: attackSelection && attackSelection.attack_profile
      ? attackSelection.attack_profile
      : null
  }, context);
}

function createAttackTargetCoordinateAction(context, targetPosition, attackSelection) {
  return createMapAction(MAP_ACTION_TYPES.ATTACK_TARGET_COORDINATE, {
    target_position: targetPosition,
    attack_profile: attackSelection && attackSelection.attack_profile
      ? attackSelection.attack_profile
      : null
  }, context);
}

function createCastSpellAction(context, spellSelection) {
  return createMapAction(MAP_ACTION_TYPES.CAST_SPELL, {
    spell_id: spellSelection.spell_id,
    spell_name: spellSelection.spell_name,
    selected_targets: spellSelection.selected_targets || [],
    target_position: spellSelection.target_position || null,
    confirmed_area_tiles: spellSelection.confirmed_area_tiles || [],
    profile: spellSelection.profile || null
  }, context);
}

function createSelectTokenAction(context, tokenSelection) {
  return createMapAction(MAP_ACTION_TYPES.SELECT_TOKEN, {
    token_choice_id: tokenSelection.token_choice_id,
    token: tokenSelection.token || null
  }, context);
}

module.exports = {
  MAP_ACTION_TYPES,
  createMapAction,
  createMoveToCoordinateAction,
  createAttackTargetTokenAction,
  createAttackTargetCoordinateAction,
  createCastSpellAction,
  createSelectTokenAction
};

"use strict";

const HEAVILY_OBSCURED_UTILITY_REFS = new Set([
  "spell_fog_cloud_heavily_obscured",
  "spell_darkness_heavily_obscured"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function positionMatchesTile(position, tile) {
  return Number(position && position.x) === Number(tile && tile.x) &&
    Number(position && position.y) === Number(tile && tile.y);
}

function enumerateLineTiles(fromPosition, toPosition) {
  if (!fromPosition || !toPosition) {
    return [];
  }
  const fromX = Number(fromPosition.x);
  const fromY = Number(fromPosition.y);
  const toX = Number(toPosition.x);
  const toY = Number(toPosition.y);
  if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) {
    return [];
  }
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  if (steps <= 0) {
    return [{
      x: Math.round(fromX),
      y: Math.round(fromY)
    }];
  }
  const tiles = [];
  const seen = new Set();
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const tile = {
      x: Math.round(fromX + (toX - fromX) * t),
      y: Math.round(fromY + (toY - fromY) * t)
    };
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tiles.push(tile);
  }
  return tiles;
}

function getAreaEffectTiles(effect) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  return Array.isArray(modifiers.area_tiles) ? modifiers.area_tiles : [];
}

function dedupeTiles(tiles) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(tiles) ? tiles : [];
  for (let index = 0; index < list.length; index += 1) {
    const tile = list[index];
    const normalized = {
      x: Number(tile && tile.x),
      y: Number(tile && tile.y)
    };
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) {
      continue;
    }
    const key = `${normalized.x},${normalized.y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function getEffectTriggerTiles(effect, triggerKeys) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
  const keys = Array.isArray(triggerKeys) ? triggerKeys.filter(Boolean) : [];
  if (keys.length <= 0) {
    return getAreaEffectTiles(effect);
  }

  const explicitTiles = [];
  for (let index = 0; index < keys.length; index += 1) {
    const triggerConfig = zoneBehavior[keys[index]] && typeof zoneBehavior[keys[index]] === "object"
      ? zoneBehavior[keys[index]]
      : null;
    if (!triggerConfig || !Array.isArray(triggerConfig.area_tiles)) {
      continue;
    }
    explicitTiles.push.apply(explicitTiles, triggerConfig.area_tiles);
  }

  if (explicitTiles.length > 0) {
    return dedupeTiles(explicitTiles);
  }
  return getAreaEffectTiles(effect);
}

function getActiveAreaEffectsAtPosition(combat, position, options) {
  const effects = Array.isArray(combat && combat.active_effects) ? combat.active_effects : [];
  if (!position || typeof position !== "object") {
    return [];
  }
  const config = options && typeof options === "object" ? options : {};
  const triggerKeys = Array.isArray(config.trigger_keys) ? config.trigger_keys : [];
  return effects.filter((effect) => getEffectTriggerTiles(effect, triggerKeys).some((tile) => positionMatchesTile(position, tile)));
}

function getActiveAreaEffectsCrossingLine(combat, fromPosition, toPosition) {
  const effects = Array.isArray(combat && combat.active_effects) ? combat.active_effects : [];
  const lineTiles = enumerateLineTiles(fromPosition, toPosition);
  if (lineTiles.length <= 0) {
    return [];
  }
  return effects.filter((effect) => {
    const areaTiles = getAreaEffectTiles(effect);
    return lineTiles.some((tile) => areaTiles.some((areaTile) => positionMatchesTile(tile, areaTile)));
  });
}

function getCurrentTurnKey(combat) {
  const round = Number.isFinite(Number(combat && combat.round)) ? Number(combat.round) : 1;
  const initiativeOrder = Array.isArray(combat && combat.initiative_order) ? combat.initiative_order : [];
  const turnIndex = Number.isFinite(Number(combat && combat.turn_index)) ? Number(combat.turn_index) : 0;
  const actorId = String(
    combat && combat.active_turn_participant_id ||
    initiativeOrder[turnIndex] ||
    ""
  ).trim();
  return `${round}:${actorId}`;
}

function areaEffectHasTriggeredForParticipantThisTurn(effect, participantId, combat) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object" ? modifiers.zone_behavior : {};
  if (zoneBehavior.trigger_once_per_turn !== true) {
    return false;
  }
  const tracker = zoneBehavior.triggered_turns && typeof zoneBehavior.triggered_turns === "object"
    ? zoneBehavior.triggered_turns
    : {};
  return String(tracker[String(participantId || "")] || "") === getCurrentTurnKey(combat);
}

function markAreaEffectTriggeredForParticipant(combat, effectId, participantId) {
  const nextCombat = clone(combat);
  const effectIndex = Array.isArray(nextCombat.active_effects)
    ? nextCombat.active_effects.findIndex((effect) => String(effect && effect.effect_id || "") === String(effectId || ""))
    : -1;
  if (effectIndex === -1) {
    return {
      combat: nextCombat,
      updated: false
    };
  }
  const effect = nextCombat.active_effects[effectIndex];
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? clone(effect.modifiers) : {};
  const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object"
    ? clone(modifiers.zone_behavior)
    : {};
  const tracker = zoneBehavior.triggered_turns && typeof zoneBehavior.triggered_turns === "object"
    ? clone(zoneBehavior.triggered_turns)
    : {};
  tracker[String(participantId || "")] = getCurrentTurnKey(nextCombat);
  zoneBehavior.triggered_turns = tracker;
  modifiers.zone_behavior = zoneBehavior;
  nextCombat.active_effects[effectIndex] = Object.assign({}, effect, {
    modifiers
  });
  return {
    combat: nextCombat,
    updated: true
  };
}

function consumeAreaEffectDamagePool(combat, effectId, damageAmount) {
  const nextCombat = clone(combat);
  const effectIndex = Array.isArray(nextCombat.active_effects)
    ? nextCombat.active_effects.findIndex((effect) => String(effect && effect.effect_id || "") === String(effectId || ""))
    : -1;
  if (effectIndex === -1) {
    return {
      combat: nextCombat,
      updated: false,
      effect_expired: false,
      remaining_damage_pool: null
    };
  }
  const effect = nextCombat.active_effects[effectIndex];
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? clone(effect.modifiers) : {};
  const zoneBehavior = modifiers.zone_behavior && typeof modifiers.zone_behavior === "object"
    ? clone(modifiers.zone_behavior)
    : {};
  const remainingPool = Number(zoneBehavior.damage_pool_remaining);
  if (!Number.isFinite(remainingPool)) {
    return {
      combat: nextCombat,
      updated: false,
      effect_expired: false,
      remaining_damage_pool: null
    };
  }
  const consumedAmount = Math.max(0, Number(damageAmount) || 0);
  const nextRemainingPool = Math.max(0, remainingPool - consumedAmount);
  zoneBehavior.damage_pool_remaining = nextRemainingPool;
  modifiers.zone_behavior = zoneBehavior;
  if (nextRemainingPool <= 0 && zoneBehavior.expires_when_damage_pool_spent === true) {
    nextCombat.active_effects = nextCombat.active_effects.filter((entry) => String(entry && entry.effect_id || "") !== String(effectId || ""));
    return {
      combat: nextCombat,
      updated: true,
      effect_expired: true,
      remaining_damage_pool: 0
    };
  }
  nextCombat.active_effects[effectIndex] = Object.assign({}, effect, {
    modifiers
  });
  return {
    combat: nextCombat,
    updated: true,
    effect_expired: false,
    remaining_damage_pool: nextRemainingPool
  };
}

function participantIsHeavilyObscured(combat, participant) {
  if (!participant || !participant.position) {
    return false;
  }
  const areaEffects = getActiveAreaEffectsAtPosition(combat, participant.position);
  return areaEffects.some((effect) => {
    const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
    return HEAVILY_OBSCURED_UTILITY_REFS.has(String(modifiers.utility_ref || "").trim().toLowerCase());
  });
}

module.exports = {
  positionMatchesTile,
  enumerateLineTiles,
  getAreaEffectTiles,
  getEffectTriggerTiles,
  getActiveAreaEffectsAtPosition,
  getActiveAreaEffectsCrossingLine,
  getCurrentTurnKey,
  areaEffectHasTriggeredForParticipantThisTurn,
  markAreaEffectTriggeredForParticipant,
  consumeAreaEffectDamagePool,
  participantIsHeavilyObscured
};

"use strict";

const HEAVILY_OBSCURED_UTILITY_REFS = new Set([
  "spell_fog_cloud_heavily_obscured",
  "spell_darkness_heavily_obscured"
]);

function positionMatchesTile(position, tile) {
  return Number(position && position.x) === Number(tile && tile.x) &&
    Number(position && position.y) === Number(tile && tile.y);
}

function getAreaEffectTiles(effect) {
  const modifiers = effect && effect.modifiers && typeof effect.modifiers === "object" ? effect.modifiers : {};
  return Array.isArray(modifiers.area_tiles) ? modifiers.area_tiles : [];
}

function getActiveAreaEffectsAtPosition(combat, position) {
  const effects = Array.isArray(combat && combat.active_effects) ? combat.active_effects : [];
  if (!position || typeof position !== "object") {
    return [];
  }
  return effects.filter((effect) => getAreaEffectTiles(effect).some((tile) => positionMatchesTile(position, tile)));
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
  getAreaEffectTiles,
  getActiveAreaEffectsAtPosition,
  participantIsHeavilyObscured
};

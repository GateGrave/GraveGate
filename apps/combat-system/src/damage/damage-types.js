"use strict";

const DAMAGE_TYPES = {
  ACID: "acid",
  BLUDGEONING: "bludgeoning",
  COLD: "cold",
  FIRE: "fire",
  FORCE: "force",
  LIGHTNING: "lightning",
  NECROTIC: "necrotic",
  PIERCING: "piercing",
  POISON: "poison",
  PSYCHIC: "psychic",
  RADIANT: "radiant",
  SLASHING: "slashing",
  THUNDER: "thunder"
};

function normalizeDamageType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function isSupportedDamageType(value) {
  const normalized = normalizeDamageType(value);
  return Object.values(DAMAGE_TYPES).includes(normalized);
}

module.exports = {
  DAMAGE_TYPES,
  normalizeDamageType,
  isSupportedDamageType
};

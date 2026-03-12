"use strict";

function toSafeNumber(value, fallback) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Number(value);
}

function clampD20(value) {
  const asInt = Math.floor(Number(value));
  if (!Number.isFinite(asInt)) return null;
  if (asInt < 1) return 1;
  if (asInt > 20) return 20;
  return asInt;
}

function getCraftCheckModifiers(craftContext) {
  const ctx = craftContext || {};
  const playerModifier = toSafeNumber(ctx.player_modifier, 0);
  const toolModifier = toSafeNumber(ctx.tool_modifier, 0);
  const professionModifier = toSafeNumber(ctx.profession_modifier, 0);
  const miscModifier = toSafeNumber(ctx.misc_modifier, 0);
  const totalModifier = playerModifier + toolModifier + professionModifier + miscModifier;

  return {
    player_modifier: playerModifier,
    tool_modifier: toolModifier,
    profession_modifier: professionModifier,
    misc_modifier: miscModifier,
    total_modifier: totalModifier
  };
}

function resolveCraftCheck(craftContext) {
  const ctx = craftContext || {};
  const target = toSafeNumber(ctx.difficulty_target, NaN);

  if (!Number.isFinite(target)) {
    return {
      ok: false,
      error: "difficulty_target must be a number"
    };
  }

  const modifiers = getCraftCheckModifiers(ctx);
  const mode = ctx.mode || "normal";

  // Deterministic test mode: provide forced_roll in context.
  let roll = null;
  if (ctx.forced_roll !== undefined) {
    roll = clampD20(ctx.forced_roll);
  } else if (typeof ctx.roll_fn === "function") {
    roll = clampD20(ctx.roll_fn());
  } else {
    roll = clampD20(Math.floor(Math.random() * 20) + 1);
  }

  if (!Number.isFinite(roll)) {
    return {
      ok: false,
      error: "Could not resolve a valid d20 roll"
    };
  }

  const finalTotal = roll + modifiers.total_modifier;
  const success = finalTotal >= target;

  return {
    ok: true,
    success,
    roll_breakdown: {
      mode,
      difficulty_target: target,
      d20_roll: roll,
      modifiers,
      final_total: finalTotal,
      margin: finalTotal - target
    }
  };
}

module.exports = {
  resolveCraftCheck,
  getCraftCheckModifiers
};


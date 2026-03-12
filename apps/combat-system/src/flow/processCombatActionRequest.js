"use strict";

const { performAttackAction } = require("../actions/attackAction");
const { performCastSpellAction } = require("../actions/castSpellAction");
const { performMoveAction } = require("../actions/moveAction");
const { useItemAction } = require("../actions/useItemAction");
const { createCombatSnapshot } = require("../snapshots/create-combat-snapshot");
const { renderCombatById } = require("./renderCombatState");
const { resolveOpportunityAttacksForMove } = require("./opportunityAttackFlow");
const { progressCombatAfterResolvedTurn } = require("./progressCombatState");
const {
  removeItemFromInventory,
  normalizeInventoryShape
} = require("../../../inventory-system/src/mutationHelpers");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function persistCombatSnapshot(context, combatState) {
  if (!context.combatPersistence || typeof context.combatPersistence.saveCombatSnapshot !== "function") {
    return success("combat_snapshot_skipped", {
      reason: "combatPersistence not available"
    });
  }

  let snapshot = null;
  let saved = null;
  try {
    snapshot = createCombatSnapshot(combatState);
    saved = context.combatPersistence.saveCombatSnapshot({ snapshot });
  } catch (error) {
    return failure("combat_action_failed", error.message || "failed to persist combat snapshot");
  }
  if (!saved.ok) {
    return failure("combat_action_failed", saved.error || "failed to persist combat snapshot");
  }

  return success("combat_snapshot_persisted", {
    snapshot: clone(saved.payload.snapshot)
  });
}

function renderCombatStateNonFatal(context, combatId) {
  if (!context || !context.combatManager) {
    return {
      ok: false,
      error: "combatManager is required for rendering"
    };
  }
  const renderOut = renderCombatById({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    options: context.renderOptions || {}
  });
  if (!renderOut.ok) {
    return {
      ok: false,
      error: renderOut.error || "combat render failed",
      payload: renderOut.payload || {}
    };
  }

  const renderPayload = renderOut.payload.render || {};
  return {
    ok: true,
    payload: {
      combat_id: renderPayload.combat_id || String(combatId),
      width_px: renderPayload.width_px || null,
      height_px: renderPayload.height_px || null,
      tile_size_px: renderPayload.tile_size_px || null,
      output_path: renderPayload.output_path || null,
      actor_count: Array.isArray(renderPayload.render_manifest && renderPayload.render_manifest.layers && renderPayload.render_manifest.layers.actors)
        ? renderPayload.render_manifest.layers.actors.length
        : 0,
      layer_order: renderPayload.render_manifest && Array.isArray(renderPayload.render_manifest.layer_order)
        ? clone(renderPayload.render_manifest.layer_order)
        : []
    }
  };
}

function resolveCombatTargetPosition(payload) {
  const x = Number(payload && payload.target_x);
  const y = Number(payload && payload.target_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: Math.floor(x), y: Math.floor(y) };
}

function loadPlayerInventory(context, playerId) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.listInventories !== "function") {
    return failure("combat_action_failed", "inventoryPersistence is required for combat item use");
  }

  let listed = null;
  try {
    listed = context.inventoryPersistence.listInventories();
  } catch (error) {
    return failure("combat_action_failed", error.message || "failed to list inventories");
  }
  if (!listed.ok) {
    return failure("combat_action_failed", listed.error || "failed to list inventories");
  }

  const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
  const found = inventories.find((inventory) => String(inventory.owner_id || "") === String(playerId || ""));
  if (!found) {
    return failure("combat_action_failed", "inventory not found for player", {
      player_id: String(playerId || "")
    });
  }

  const normalized = normalizeInventoryShape(found);
  if (!normalized.ok) {
    return failure("combat_action_failed", normalized.error || "invalid inventory shape");
  }

  return success("combat_inventory_loaded", {
    inventory: normalized.payload.inventory
  });
}

function getRawCombatState(context, combatId) {
  const manager = context && context.combatManager ? context.combatManager : null;
  if (!manager || !manager.combats || typeof manager.combats.get !== "function") {
    return null;
  }
  const combat = manager.combats.get(String(combatId));
  return combat ? clone(combat) : null;
}

function restoreRawCombatState(context, combatId, combatState) {
  const manager = context && context.combatManager ? context.combatManager : null;
  if (!manager || !manager.combats || typeof manager.combats.set !== "function") {
    return false;
  }
  try {
    manager.combats.set(String(combatId), clone(combatState));
    return true;
  } catch (error) {
    return false;
  }
}

function finalizeCombatMutation(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = String(data.combat_id || "");
  const combatBeforeMutation = data.combat_before_mutation || null;
  const responseEventType = String(data.response_event_type || "combat_action_failed");
  const progression = progressCombatAfterResolvedTurn({
    combatManager: context.combatManager,
    combat_id: combatId,
    ai_attack_roll_fn: context.aiMonsterAttackRollFn,
    ai_damage_roll_fn: context.aiMonsterDamageRollFn,
    opportunity_attack_roll_fn: context.opportunityAttackAttackRollFn,
    opportunity_damage_roll_fn: context.opportunityAttackDamageRollFn
  });
  if (!progression.ok) {
    if (combatBeforeMutation) {
      restoreRawCombatState(context, combatId, combatBeforeMutation);
    }
    return failure(responseEventType, progression.error || "failed to finalize combat progression", progression.payload);
  }

  const loaded = context.combatManager.getCombatById(combatId);
  if (!loaded.ok) {
    if (combatBeforeMutation) {
      restoreRawCombatState(context, combatId, combatBeforeMutation);
    }
    return failure(responseEventType, loaded.error || "failed to reload finalized combat", {
      combat_id: combatId
    });
  }

  const persisted = persistCombatSnapshot(context, loaded.payload.combat);
  if (!persisted.ok) {
    if (combatBeforeMutation) {
      restoreRawCombatState(context, combatId, combatBeforeMutation);
    }
    return failure(responseEventType, persisted.error || "failed to persist combat snapshot");
  }
  const rendered = renderCombatStateNonFatal(context, combatId);

  return success("combat_mutation_finalized", {
    combat: clone(loaded.payload.combat),
    progression: clone(progression.payload),
    snapshot: persisted.payload.snapshot || null,
    render: rendered.ok ? rendered.payload : null,
    render_error: rendered.ok ? null : rendered.error
  });
}

function findConsumableItem(inventory, itemId, playerId) {
  const list = Array.isArray(inventory.stackable_items) ? inventory.stackable_items : [];
  const entry = list.find((candidate) => String(candidate.item_id || "") === String(itemId || ""));
  if (!entry) {
    return null;
  }

  const entryOwner = entry.owner_player_id ? String(entry.owner_player_id) : null;
  const inventoryOwner = inventory.owner_id ? String(inventory.owner_id) : null;
  if (entryOwner && entryOwner !== String(playerId || "")) {
    return null;
  }
  if (!entryOwner && inventoryOwner && inventoryOwner !== String(playerId || "")) {
    return null;
  }

  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const itemType = entry.item_type || "consumable";
  const healAmount = Number(metadata.heal_amount);

  return {
    item_id: String(entry.item_id),
    item_type: itemType,
    heal_amount: Number.isFinite(healAmount) && healAmount > 0 ? healAmount : 1
  };
}

function saveInventory(context, inventory) {
  if (!context.inventoryPersistence || typeof context.inventoryPersistence.saveInventory !== "function") {
    return failure("combat_action_failed", "inventoryPersistence.saveInventory is required");
  }

  let saved = null;
  try {
    saved = context.inventoryPersistence.saveInventory(inventory);
  } catch (error) {
    return failure("combat_action_failed", error.message || "failed to persist inventory after item use");
  }
  if (!saved.ok) {
    return failure("combat_action_failed", saved.error || "failed to persist inventory after item use");
  }

  return success("combat_inventory_saved", {
    inventory: clone(saved.payload.inventory)
  });
}

function findParticipantById(combat, participantId) {
  const list = combat && Array.isArray(combat.participants) ? combat.participants : [];
  return list.find((entry) => String(entry.participant_id || "") === String(participantId || "")) || null;
}

function loadSpellDefinitionFromContext(context, spellId) {
  const normalizedSpellId = String(spellId || "").trim().toLowerCase();
  if (!normalizedSpellId) {
    return failure("combat_action_failed", "spell_id is required");
  }

  const provider = context && typeof context.spellContentProvider === "function"
    ? context.spellContentProvider
    : (context && typeof context.loadContentBundle === "function"
      ? context.loadContentBundle
      : null);
  if (!provider) {
    return failure("combat_action_failed", "spell content provider is required");
  }

  let loaded = null;
  try {
    loaded = provider();
  } catch (error) {
    return failure("combat_action_failed", error.message || "failed to load spell content");
  }
  if (!loaded || loaded.ok !== true) {
    return failure("combat_action_failed", loaded && loaded.error ? loaded.error : "failed to load spell content");
  }

  let spells = [];
  if (loaded.payload && Array.isArray(loaded.payload.spells)) {
    spells = loaded.payload.spells;
  } else if (loaded.payload && loaded.payload.content && Array.isArray(loaded.payload.content.spells)) {
    spells = loaded.payload.content.spells;
  } else if (loaded.payload && Array.isArray(loaded.payload.entries)) {
    spells = loaded.payload.entries;
  }

  const found = spells.find((entry) => {
    const id = entry && (entry.spell_id || entry.id);
    return String(id || "").trim().toLowerCase() === normalizedSpellId;
  });
  if (!found) {
    return failure("combat_action_failed", "spell data not found", {
      spell_id: normalizedSpellId
    });
  }

  return success("combat_spell_loaded", {
    spell: clone(found)
  });
}

function resolveControlledParticipant(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = String(data.combat_id || "").trim();
  const playerId = String(data.player_id || "").trim();
  const payload = isPlainObject(data.payload) ? data.payload : {};
  const requestedActorId = payload.actor_id ? String(payload.actor_id).trim() : "";

  if (!playerId) {
    return failure("combat_action_failed", "player_id is required");
  }
  if (!combatId) {
    return failure("combat_action_failed", "combat_id is required");
  }
  if (!context.combatManager || typeof context.combatManager.getCombatById !== "function") {
    return failure("combat_action_failed", "combatManager is required");
  }

  const loaded = context.combatManager.getCombatById(combatId);
  if (!loaded.ok) {
    return failure("combat_action_failed", loaded.error || "combat not found", {
      combat_id: combatId
    });
  }

  const combat = loaded.payload.combat || {};
  const participantId = requestedActorId || playerId;
  const participant = findParticipantById(combat, participantId);
  if (!participant) {
    return failure("combat_action_failed", "participant not found in combat", {
      combat_id: combatId,
      participant_id: participantId
    });
  }

  const metadata = participant.metadata && typeof participant.metadata === "object" ? participant.metadata : {};
  const ownerPlayerId = metadata.owner_player_id ? String(metadata.owner_player_id) : null;
  const validDirect = String(participant.participant_id || "") === playerId;
  const validOwner = ownerPlayerId === playerId;
  if (!validDirect && !validOwner) {
    return failure("combat_action_failed", "player is not authorized to control this combat participant", {
      combat_id: combatId,
      participant_id: participantId,
      player_id: playerId
    });
  }

  return success("combat_actor_authorized", {
    participant_id: participantId,
    combat
  });
}

function processCombatAttackRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_attack_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_attack_failed", "payload must be an object");
  }
  if (!context.combatManager || typeof context.combatManager.getCombatById !== "function") {
    return failure("player_attack_failed", "combatManager is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_attack_failed", controlled.error, controlled.payload);
  }
  const combatBeforeAttack = getRawCombatState(context, combatId);

  const out = performAttackAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    attacker_id: controlled.payload.participant_id,
    target_id: payload.target_id
  });
  if (!out.ok) {
    return failure("player_attack_failed", out.error || "attack action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeAttack,
    response_event_type: "player_attack_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_attack_processed", {
    attack: clone(out.payload),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatMoveRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_move_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_move_failed", "payload must be an object");
  }

  const targetPosition = resolveCombatTargetPosition(payload);
  if (!targetPosition) {
    return failure("player_move_failed", "combat move requires target_x and target_y");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_move_failed", controlled.error, controlled.payload);
  }
  const combatBeforeMove = getRawCombatState(context, combatId);

  const out = performMoveAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id,
    target_position: targetPosition
  });
  if (!out.ok) {
    return failure("player_move_failed", out.error || "combat move action failed", out.payload);
  }

  const opportunityAttacks = resolveOpportunityAttacksForMove({
    combat: out.payload.combat,
    mover_id: controlled.payload.participant_id,
    from_position: out.payload.from_position,
    to_position: out.payload.to_position,
    voluntary_movement: true,
    attack_roll_fn: context.opportunityAttackAttackRollFn,
    damage_roll_fn: context.opportunityAttackDamageRollFn
  });
  if (!opportunityAttacks.ok) {
    return failure("player_move_failed", opportunityAttacks.error || "opportunity attack resolution failed", opportunityAttacks.payload);
  }
  context.combatManager.combats.set(String(combatId), clone(opportunityAttacks.payload.combat));
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeMove,
    response_event_type: "player_move_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_move_processed", {
    move: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    reactions: {
      opportunity_attacks: clone(opportunityAttacks.payload.triggered_attacks)
    },
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatUseItemRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;
  if (!isPlainObject(payload)) {
    return failure("player_use_item_failed", "payload must be an object");
  }
  const itemId = payload.item_id;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_use_item_failed", "combat_id is required");
  }
  if (!itemId || String(itemId).trim() === "") {
    return failure("player_use_item_failed", "item_id is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_use_item_failed", controlled.error, controlled.payload);
  }

  const loadedInventory = loadPlayerInventory(context, playerId);
  if (!loadedInventory.ok) {
    return failure("player_use_item_failed", loadedInventory.error);
  }

  const inventory = loadedInventory.payload.inventory;
  const originalInventory = clone(inventory);
  const combatBeforeUse = getRawCombatState(context, combatId);
  const combatItem = findConsumableItem(inventory, itemId, playerId);
  if (!combatItem) {
    return failure("player_use_item_failed", "invalid item for combat use", {
      item_id: String(itemId)
    });
  }

  const removed = removeItemFromInventory(inventory, String(itemId), 1, {
    canRemoveEntry(entry) {
      const owner = entry && entry.owner_player_id ? String(entry.owner_player_id) : null;
      const inventoryOwner = inventory && inventory.owner_id ? String(inventory.owner_id) : null;
      if (owner) {
        return owner === String(playerId || "");
      }
      if (inventoryOwner) {
        return inventoryOwner === String(playerId || "");
      }
      return false;
    }
  });
  if (!removed.ok) {
    return failure("player_use_item_failed", removed.error || "failed to consume used item", removed.payload);
  }

  const inventorySaved = saveInventory(context, removed.payload.inventory);
  if (!inventorySaved.ok) {
    return failure("player_use_item_failed", inventorySaved.error);
  }

  let used = null;
  try {
    used = useItemAction({
      combatManager: context.combatManager,
      combat_id: String(combatId),
      participant_id: controlled.payload.participant_id,
      item: combatItem
    });
  } catch (error) {
    const rollbackInventoryOut = saveInventory(context, originalInventory);
    if (!rollbackInventoryOut.ok) {
      return failure("player_use_item_failed", "combat item use threw and inventory rollback failed", {
        combat_error: error.message || "combat item use threw",
        rollback_error: rollbackInventoryOut.error || "inventory rollback failed",
        partial_commit: true
      });
    }
    return failure("player_use_item_failed", error.message || "combat item use failed");
  }
  if (!used.ok) {
    // Roll back inventory if combat action could not be applied.
    const rollbackInventoryOut = saveInventory(context, originalInventory);
    if (!rollbackInventoryOut.ok) {
      return failure("player_use_item_failed", "combat item use failed and inventory rollback failed", {
        combat_error: used.error || "combat item use failed",
        rollback_error: rollbackInventoryOut.error || "inventory rollback failed"
      });
    }
    return failure("player_use_item_failed", used.error || "combat item use failed", used.payload);
  }

  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeUse,
    response_event_type: "player_use_item_failed"
  });
  if (!finalized.ok) {
    const rollbackInventoryOut = saveInventory(context, originalInventory);
    if (!rollbackInventoryOut.ok) {
      return failure("player_use_item_failed", "combat finalize failed and inventory rollback failed", {
        combat_error: finalized.error || "combat finalize failed",
        rollback_error: rollbackInventoryOut.error || "inventory rollback failed",
        partial_commit: true
      });
    }
    return finalized;
  }

  return success("player_use_item_processed", {
    use_item: Object.assign({}, clone(used.payload), {
      combat: clone(finalized.payload.combat)
    }),
    inventory: clone(inventorySaved.payload.inventory),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatCastSpellRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_cast_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_cast_failed", "payload must be an object");
  }

  const spellId = payload.spell_id || payload.ability_id;
  if (!spellId || String(spellId).trim() === "") {
    return failure("player_cast_failed", "spell_id is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_cast_failed", controlled.error, controlled.payload);
  }
  const combatBeforeCast = getRawCombatState(context, combatId);

  const loadedSpell = loadSpellDefinitionFromContext(context, spellId);
  if (!loadedSpell.ok) {
    return failure("player_cast_failed", loadedSpell.error, loadedSpell.payload);
  }

  const out = performCastSpellAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    caster_id: controlled.payload.participant_id,
    target_id: payload.target_id || null,
    spell: loadedSpell.payload.spell,
    attack_roll_fn: context.spellAttackRollFn,
    attack_roll_rng: context.spellAttackRollRng,
    saving_throw_fn: context.spellSavingThrowFn,
    damage_rng: context.spellDamageRng,
    healing_rng: context.spellHealingRng
  });
  if (!out.ok) {
    return failure("player_cast_failed", out.error || "cast spell action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeCast,
    response_event_type: "player_cast_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_cast_processed", {
    cast_spell: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

module.exports = {
  processCombatAttackRequest,
  processCombatCastSpellRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest
};

"use strict";

const { performAttackAction } = require("../actions/attackAction");
const { performCastSpellAction } = require("../actions/castSpellAction");
const { performHelpAction } = require("../actions/helpAction");
const { performReadyAction } = require("../actions/readyAction");
const { performDisengageAction } = require("../actions/disengageAction");
const { performDodgeAction } = require("../actions/dodgeAction");
const { performDashAction } = require("../actions/dashAction");
const { performGrappleAction } = require("../actions/grappleAction");
const { performEscapeGrappleAction } = require("../actions/escapeGrappleAction");
const { performShoveAction } = require("../actions/shoveAction");
const { performMoveAction } = require("../actions/moveAction");
const { useItemAction } = require("../actions/useItemAction");
const { createCombatSnapshot } = require("../snapshots/create-combat-snapshot");
const { renderCombatById } = require("./renderCombatState");
const { resolveOpportunityAttacksForMove } = require("./opportunityAttackFlow");
const { resolveReadiedAttacksForMove } = require("./readyActionFlow");
const { progressCombatAfterResolvedTurn } = require("./progressCombatState");
const { normalizeCombatControlConditions } = require("../conditions/conditionHelpers");
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

  const normalizedConditions = normalizeCombatControlConditions(loaded.payload.combat);
  if (!normalizedConditions.ok) {
    if (combatBeforeMutation) {
      restoreRawCombatState(context, combatId, combatBeforeMutation);
    }
    return failure(responseEventType, normalizedConditions.error || "failed to normalize combat conditions", {
      combat_id: combatId
    });
  }
  const normalizedCombat = clone(normalizedConditions.next_state);
  context.combatManager.combats.set(String(combatId), normalizedCombat);

  const persisted = persistCombatSnapshot(context, normalizedCombat);
  if (!persisted.ok) {
    if (combatBeforeMutation) {
      restoreRawCombatState(context, combatId, combatBeforeMutation);
    }
    return failure(responseEventType, persisted.error || "failed to persist combat snapshot");
  }
  const rendered = renderCombatStateNonFatal(context, combatId);

  return success("combat_mutation_finalized", {
    combat: clone(normalizedCombat),
    progression: clone(progression.payload),
    snapshot: persisted.payload.snapshot || null,
    render: rendered.ok ? rendered.payload : null,
    render_error: rendered.ok ? null : rendered.error
  });
}

function canUseInventoryEntry(entry, inventory, playerId) {
  const entryOwner = entry && entry.owner_player_id ? String(entry.owner_player_id) : null;
  const inventoryOwner = inventory && inventory.owner_id ? String(inventory.owner_id) : null;
  if (entryOwner && entryOwner !== String(playerId || "")) {
    return false;
  }
  if (!entryOwner && inventoryOwner && inventoryOwner !== String(playerId || "")) {
    return false;
  }
  return true;
}

function resolveCombatUsePayload(entry) {
  const metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const useEffect = metadata.use_effect && typeof metadata.use_effect === "object" ? metadata.use_effect : {};
  const healAmount = Number(useEffect.heal_amount !== undefined ? useEffect.heal_amount : metadata.heal_amount);
  const temporaryHitPoints = Number(
    useEffect.temporary_hitpoints !== undefined
      ? useEffect.temporary_hitpoints
      : (useEffect.temp_hp !== undefined ? useEffect.temp_hp : (
        metadata.temporary_hitpoints !== undefined ? metadata.temporary_hitpoints : metadata.temp_hp
      ))
  );
  const appliedConditions = Array.isArray(useEffect.applied_conditions)
    ? clone(useEffect.applied_conditions)
    : (Array.isArray(metadata.applied_conditions) ? clone(metadata.applied_conditions) : []);
  const removedConditions = Array.isArray(useEffect.remove_conditions)
    ? clone(useEffect.remove_conditions)
    : (Array.isArray(metadata.remove_conditions) ? clone(metadata.remove_conditions) : []);
  const hitpointMaxBonus = Number(useEffect.hitpoint_max_bonus !== undefined ? useEffect.hitpoint_max_bonus : entry && entry.hitpoint_max_bonus);
  const charges = Number(metadata.charges);
  const chargesRemaining = metadata.charges_remaining !== undefined ? Number(metadata.charges_remaining) : charges;
  const hasCharges = Number.isFinite(charges) && charges > 0;
  return {
    item_id: String(entry.item_id || ""),
    item_type: entry.item_type || null,
    heal_amount: Number.isFinite(healAmount) ? Math.max(0, Math.floor(healAmount)) : 0,
    temporary_hitpoints: Number.isFinite(temporaryHitPoints) ? Math.max(0, Math.floor(temporaryHitPoints)) : 0,
    hitpoint_max_bonus: Number.isFinite(hitpointMaxBonus) ? Math.max(0, Math.floor(hitpointMaxBonus)) : 0,
    applied_conditions: appliedConditions,
    removed_conditions: removedConditions,
    metadata: clone(metadata),
    use_status: hasCharges ? "charged_activation" : "consumed",
    charges: hasCharges ? Math.floor(charges) : 0,
    charges_remaining: hasCharges && Number.isFinite(chargesRemaining) ? Math.max(0, Math.floor(chargesRemaining)) : 0
  };
}

function findCombatUsableItem(inventory, itemId, playerId) {
  const buckets = ["stackable_items", "equipment_items", "quest_items"];
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const list = Array.isArray(inventory[bucket]) ? inventory[bucket] : [];
    const entry = list.find((candidate) => String(candidate && candidate.item_id || "") === String(itemId || ""));
    if (!entry) {
      continue;
    }
    if (!canUseInventoryEntry(entry, inventory, playerId)) {
      return null;
    }
    const combatItem = resolveCombatUsePayload(entry);
    if (combatItem.heal_amount <= 0 &&
      combatItem.temporary_hitpoints <= 0 &&
      combatItem.hitpoint_max_bonus <= 0 &&
      combatItem.applied_conditions.length === 0 &&
      combatItem.removed_conditions.length === 0) {
      return null;
    }
    return {
      bucket,
      entry: clone(entry),
      combat_item: combatItem
    };
  }
  return null;
}

function consumeCombatInventoryItem(inventory, resolvedItem, playerId) {
  if (!resolvedItem || !resolvedItem.entry || !resolvedItem.combat_item) {
    return failure("combat_action_failed", "combat usable item is required");
  }

  if (resolvedItem.combat_item.use_status === "charged_activation") {
    if (resolvedItem.combat_item.charges_remaining <= 0) {
      return failure("combat_action_failed", "item has no charges remaining", {
        item_id: resolvedItem.combat_item.item_id
      });
    }
    const nextInventory = clone(inventory);
    const list = Array.isArray(nextInventory[resolvedItem.bucket]) ? nextInventory[resolvedItem.bucket] : [];
    const targetIndex = list.findIndex((candidate) => {
      return String(candidate && candidate.item_id || "") === String(resolvedItem.entry.item_id || "") &&
        canUseInventoryEntry(candidate, inventory, playerId);
    });
    if (targetIndex === -1) {
      return failure("combat_action_failed", "failed to locate charged item in inventory", {
        item_id: resolvedItem.combat_item.item_id
      });
    }
    const nextEntry = clone(list[targetIndex]);
    nextEntry.metadata = nextEntry.metadata && typeof nextEntry.metadata === "object" ? clone(nextEntry.metadata) : {};
    nextEntry.metadata.charges_remaining = resolvedItem.combat_item.charges_remaining - 1;
    list[targetIndex] = nextEntry;
    nextInventory[resolvedItem.bucket] = list;
    return success("combat_inventory_item_charged", {
      inventory: nextInventory,
      use_status: "charged_activation",
      charges_before: resolvedItem.combat_item.charges_remaining,
      charges_after: resolvedItem.combat_item.charges_remaining - 1
    });
  }

  const removed = removeItemFromInventory(inventory, String(resolvedItem.entry.item_id || ""), 1, {
    canRemoveEntry(entry) {
      return canUseInventoryEntry(entry, inventory, playerId);
    }
  });
  if (!removed.ok) {
    return failure("combat_action_failed", removed.error || "failed to consume used item", removed.payload);
  }
  return success("combat_inventory_item_consumed", {
    inventory: removed.payload.inventory,
    use_status: "consumed",
    charges_before: null,
    charges_after: null
  });
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
    target_id: payload.target_id,
    attack_roll_fn: context.attackRollFn,
    targeting_save_fn: context.targetingSaveFn,
    targeting_save_bonus_rng: context.targetingSaveBonusRng,
    concentration_save_rng: context.concentrationSaveRng
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
    combatManager: context.combatManager,
    combat_id: String(combatId),
    combat: out.payload.combat,
    mover_id: controlled.payload.participant_id,
    from_position: out.payload.from_position,
    to_position: out.payload.to_position,
    voluntary_movement: true,
    attack_roll_fn: context.opportunityAttackAttackRollFn,
    damage_roll_fn: context.opportunityAttackDamageRollFn,
    spell_attack_roll_fn: context.spellAttackRollFn,
    spell_saving_throw_fn: context.spellSavingThrowFn,
    concentration_save_rng: context.concentrationSaveRng,
    war_caster_spell_selector: context.warCasterOpportunitySpellSelector,
    load_spell_fn(spellId) {
      return loadSpellDefinitionFromContext(context, spellId);
    }
  });
  if (!opportunityAttacks.ok) {
    return failure("player_move_failed", opportunityAttacks.error || "opportunity attack resolution failed", opportunityAttacks.payload);
  }
  const readyReactions = resolveReadiedAttacksForMove({
    combat: opportunityAttacks.payload.combat,
    mover_id: controlled.payload.participant_id,
    from_position: out.payload.from_position,
    to_position: out.payload.to_position,
    attack_roll_fn: context.opportunityAttackAttackRollFn,
    damage_roll_fn: context.opportunityAttackDamageRollFn
  });
  if (!readyReactions.ok) {
    return failure("player_move_failed", readyReactions.error || "ready action resolution failed", readyReactions.payload);
  }
  context.combatManager.combats.set(String(combatId), clone(readyReactions.payload.combat));
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
      opportunity_attacks: clone(opportunityAttacks.payload.triggered_attacks),
      ready_attacks: clone(readyReactions.payload.triggered_ready_attacks)
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
  const resolvedItem = findCombatUsableItem(inventory, itemId, playerId);
  if (!resolvedItem) {
    return failure("player_use_item_failed", "invalid item for combat use", {
      item_id: String(itemId)
    });
  }

  const consumed = consumeCombatInventoryItem(inventory, resolvedItem, playerId);
  if (!consumed.ok) {
    return failure("player_use_item_failed", consumed.error || "failed to consume used item", consumed.payload);
  }

  const inventorySaved = saveInventory(context, consumed.payload.inventory);
  if (!inventorySaved.ok) {
    return failure("player_use_item_failed", inventorySaved.error);
  }

  let used = null;
  try {
    used = useItemAction({
      combatManager: context.combatManager,
      combat_id: String(combatId),
      participant_id: controlled.payload.participant_id,
      item: resolvedItem.combat_item
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
      use_status: consumed.payload.use_status || "consumed",
      charges_before: consumed.payload.charges_before,
      charges_after: consumed.payload.charges_after,
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
    target_ids: Array.isArray(payload.target_ids) ? payload.target_ids : null,
    reaction_mode: payload.reaction_mode === true,
    war_caster_reaction: payload.war_caster_reaction === true,
    spell: loadedSpell.payload.spell,
    attack_roll_fn: context.spellAttackRollFn,
    attack_roll_rng: context.spellAttackRollRng,
    saving_throw_fn: context.spellSavingThrowFn,
    targeting_save_fn: context.targetingSaveFn,
    targeting_save_bonus_rng: context.targetingSaveBonusRng,
    damage_rng: context.spellDamageRng,
    healing_rng: context.spellHealingRng,
    concentration_save_rng: context.concentrationSaveRng
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

function processCombatDodgeRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_dodge_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_dodge_failed", "payload must be an object");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_dodge_failed", controlled.error, controlled.payload);
  }
  const combatBeforeDodge = getRawCombatState(context, combatId);

  const out = performDodgeAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id
  });
  if (!out.ok) {
    return failure("player_dodge_failed", out.error || "dodge action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeDodge,
    response_event_type: "player_dodge_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_dodge_processed", {
    dodge: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatHelpRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_help_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_help_failed", "payload must be an object");
  }
  if (!payload.target_id || String(payload.target_id).trim() === "") {
    return failure("player_help_failed", "target_id is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_help_failed", controlled.error, controlled.payload);
  }
  const combatBeforeHelp = getRawCombatState(context, combatId);

  const out = performHelpAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    helper_id: controlled.payload.participant_id,
    target_id: payload.target_id
  });
  if (!out.ok) {
    return failure("player_help_failed", out.error || "help action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeHelp,
    response_event_type: "player_help_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_help_processed", {
    help: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatReadyRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_ready_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_ready_failed", "payload must be an object");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_ready_failed", controlled.error, controlled.payload);
  }
  const combatBeforeReady = getRawCombatState(context, combatId);

  const out = performReadyAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id,
    trigger_type: payload.trigger_type || null,
    readied_action_type: payload.readied_action_type || null,
    target_id: payload.target_id || null
  });
  if (!out.ok) {
    return failure("player_ready_failed", out.error || "ready action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeReady,
    response_event_type: "player_ready_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_ready_processed", {
    ready: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatDisengageRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_disengage_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_disengage_failed", "payload must be an object");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_disengage_failed", controlled.error, controlled.payload);
  }
  const combatBeforeDisengage = getRawCombatState(context, combatId);

  const out = performDisengageAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id
  });
  if (!out.ok) {
    return failure("player_disengage_failed", out.error || "disengage action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeDisengage,
    response_event_type: "player_disengage_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_disengage_processed", {
    disengage: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatDashRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_dash_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_dash_failed", "payload must be an object");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_dash_failed", controlled.error, controlled.payload);
  }
  const combatBeforeDash = getRawCombatState(context, combatId);

  const out = performDashAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id
  });
  if (!out.ok) {
    return failure("player_dash_failed", out.error || "dash action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeDash,
    response_event_type: "player_dash_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_dash_processed", {
    dash: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatGrappleRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_grapple_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_grapple_failed", "payload must be an object");
  }
  if (!payload.target_id || String(payload.target_id).trim() === "") {
    return failure("player_grapple_failed", "target_id is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_grapple_failed", controlled.error, controlled.payload);
  }
  const combatBeforeGrapple = getRawCombatState(context, combatId);

  const out = performGrappleAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    attacker_id: controlled.payload.participant_id,
    target_id: String(payload.target_id),
    contest_roll_fn: context.grappleContestRollFn
  });
  if (!out.ok) {
    return failure("player_grapple_failed", out.error || "grapple action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeGrapple,
    response_event_type: "player_grapple_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_grapple_processed", {
    grapple: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatEscapeGrappleRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_escape_grapple_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_escape_grapple_failed", "payload must be an object");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_escape_grapple_failed", controlled.error, controlled.payload);
  }
  const combatBeforeEscape = getRawCombatState(context, combatId);

  const out = performEscapeGrappleAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    participant_id: controlled.payload.participant_id,
    contest_roll_fn: context.grappleContestRollFn
  });
  if (!out.ok) {
    return failure("player_escape_grapple_failed", out.error || "escape grapple action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeEscape,
    response_event_type: "player_escape_grapple_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_escape_grapple_processed", {
    escape: Object.assign({}, clone(out.payload), {
      combat: clone(finalized.payload.combat)
    }),
    progression: clone(finalized.payload.progression),
    snapshot: finalized.payload.snapshot || null,
    render: finalized.payload.render,
    render_error: finalized.payload.render_error
  });
}

function processCombatShoveRequest(input) {
  const data = input || {};
  const context = data.context || {};
  const combatId = data.combat_id;
  const playerId = data.player_id;
  const payload = data.payload;

  if (!combatId || String(combatId).trim() === "") {
    return failure("player_shove_failed", "combat_id is required");
  }
  if (!isPlainObject(payload)) {
    return failure("player_shove_failed", "payload must be an object");
  }
  if (!payload.target_id || String(payload.target_id).trim() === "") {
    return failure("player_shove_failed", "target_id is required");
  }

  const controlled = resolveControlledParticipant({
    context,
    combat_id: String(combatId),
    player_id: String(playerId || ""),
    payload
  });
  if (!controlled.ok) {
    return failure("player_shove_failed", controlled.error, controlled.payload);
  }
  const combatBeforeShove = getRawCombatState(context, combatId);

  const out = performShoveAction({
    combatManager: context.combatManager,
    combat_id: String(combatId),
    attacker_id: controlled.payload.participant_id,
    target_id: String(payload.target_id),
    shove_mode: payload.shove_mode || "push",
    contest_roll_fn: context.grappleContestRollFn
  });
  if (!out.ok) {
    return failure("player_shove_failed", out.error || "shove action failed", out.payload);
  }
  const finalized = finalizeCombatMutation({
    context,
    combat_id: String(combatId),
    combat_before_mutation: combatBeforeShove,
    response_event_type: "player_shove_failed"
  });
  if (!finalized.ok) {
    return finalized;
  }

  return success("player_shove_processed", {
    shove: Object.assign({}, clone(out.payload), {
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
  processCombatHelpRequest,
  processCombatReadyRequest,
  processCombatDashRequest,
  processCombatGrappleRequest,
  processCombatEscapeGrappleRequest,
  processCombatShoveRequest,
  processCombatDisengageRequest,
  processCombatDodgeRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest
};

"use strict";

const { loadItemContent } = require("../../content/contentLoader");

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

function normalizeSlot(value) {
  return String(value || "").trim().toLowerCase();
}

function loadStarterItemIndex() {
  const out = loadItemContent();
  if (!out.ok) {
    return failure("item_rule_lookup_failed", out.error || "failed to load item content");
  }

  const entries = Array.isArray(out.payload.entries) ? out.payload.entries : [];
  const index = {};
  for (let i = 0; i < entries.length; i += 1) {
    const item = entries[i] || {};
    const itemId = String(item.item_id || "").trim();
    if (!itemId) {
      continue;
    }
    index[itemId] = item;
  }

  return success("item_rule_index_ready", {
    item_index: index
  });
}

function getStarterItemRule(itemId) {
  const safeId = String(itemId || "").trim();
  if (!safeId) {
    return failure("item_rule_lookup_failed", "item_id is required");
  }

  const indexed = loadStarterItemIndex();
  if (!indexed.ok) {
    return indexed;
  }

  const item = indexed.payload.item_index[safeId];
  if (!item) {
    return failure("item_rule_lookup_failed", "item definition not found", {
      item_id: safeId
    });
  }

  return success("item_rule_found", {
    item: clone(item)
  });
}

function isConsumableRule(item) {
  const safeItem = item || {};
  const metadata = safeItem.metadata && typeof safeItem.metadata === "object" ? safeItem.metadata : {};
  const itemType = String(safeItem.item_type || "").toLowerCase();
  const category = String(metadata.category || "").toLowerCase();
  return itemType === "consumable" || category === "consumable";
}

function isEquippableRule(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (isConsumableRule(item)) {
    return false;
  }

  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const itemType = String(item.item_type || "").toLowerCase();
  const category = String(metadata.category || "").toLowerCase();
  const equipSlot = normalizeSlot(item.equip_slot || metadata.equip_slot || metadata.slot);

  if (!equipSlot) {
    return false;
  }

  if (itemType === "equipment" || category === "weapon" || category === "armor" || category === "shield") {
    return true;
  }

  return false;
}

function validateEquipSlot(item, requestedSlot) {
  const safeItem = item || {};
  const metadata = safeItem.metadata && typeof safeItem.metadata === "object" ? safeItem.metadata : {};
  const expectedSlot = normalizeSlot(safeItem.equip_slot || metadata.equip_slot || metadata.slot);
  const safeRequestedSlot = normalizeSlot(requestedSlot);

  if (!safeRequestedSlot) {
    return failure("item_rule_slot_validation_failed", "slot is required");
  }

  if (!expectedSlot) {
    return success("item_rule_slot_validation_skipped", {
      expected_slot: null,
      requested_slot: safeRequestedSlot
    });
  }

  if (expectedSlot !== safeRequestedSlot) {
    return failure("item_rule_slot_validation_failed", "item cannot be equipped to requested slot", {
      expected_slot: expectedSlot,
      requested_slot: safeRequestedSlot
    });
  }

  return success("item_rule_slot_valid", {
    expected_slot: expectedSlot,
    requested_slot: safeRequestedSlot
  });
}

function buildEquippedItemProfile(item) {
  const safeItem = item || {};
  const metadata = safeItem.metadata && typeof safeItem.metadata === "object" ? safeItem.metadata : {};

  return {
    item_id: safeItem.item_id || null,
    name: safeItem.name || null,
    item_type: safeItem.item_type || null,
    category: metadata.category || null,
    equip_slot: safeItem.equip_slot || metadata.equip_slot || metadata.slot || null,
    weapon: metadata.weapon || null,
    armor: metadata.armor || null,
    shield_bonus: metadata.shield_bonus || null,
    source: metadata.source || null
  };
}

module.exports = {
  getStarterItemRule,
  isConsumableRule,
  isEquippableRule,
  validateEquipSlot,
  buildEquippedItemProfile
};

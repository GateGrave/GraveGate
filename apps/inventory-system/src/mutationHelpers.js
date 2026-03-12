"use strict";

const { createInventoryRecord } = require("./inventory.schema");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message, payload) {
  return {
    ok: false,
    payload: payload || {},
    error: message
  };
}

function ok(payload) {
  return {
    ok: true,
    payload: payload || {},
    error: null
  };
}

function toPositiveQuantity(value) {
  const parsed = Number.isFinite(value) ? Math.floor(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getBucketName(item) {
  if (item && (item.bucket === "stackable_items" || item.bucket === "equipment_items" || item.bucket === "quest_items")) {
    return item.bucket;
  }

  const type = item && item.item_type ? String(item.item_type) : "";
  if (item && item.stackable === true) return "stackable_items";
  if (type === "stackable" || type === "consumable" || type === "material") return "stackable_items";
  if (type === "quest") return "quest_items";
  return "equipment_items";
}

function normalizeInventoryShape(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    return fail("inventory must be an object");
  }

  const normalized = createInventoryRecord(clone(inventory));
  return ok({
    inventory: normalized
  });
}

function createEntryFromItem(item, quantity, bucket) {
  return {
    item_id: String(item.item_id),
    item_name: item.item_name ? String(item.item_name) : String(item.item_id),
    item_type: item.item_type ? String(item.item_type) : null,
    quantity,
    stackable: bucket === "stackable_items",
    owner_player_id: item.owner_player_id ? String(item.owner_player_id) : null,
    metadata: item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? clone(item.metadata) : {}
  };
}

function addItemToInventory(inventory, item) {
  const normalizedResult = normalizeInventoryShape(inventory);
  if (!normalizedResult.ok) return normalizedResult;

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return fail("item must be an object");
  }
  if (!item.item_id || String(item.item_id).trim() === "") {
    return fail("item.item_id is required");
  }

  const quantity = toPositiveQuantity(item.quantity === undefined ? 1 : item.quantity);
  if (!quantity) {
    return fail("item.quantity must be a positive number");
  }

  const next = normalizedResult.payload.inventory;
  const bucket = getBucketName(item);
  const entries = next[bucket];

  if (bucket === "stackable_items") {
    const existing = entries.find((entry) => entry && entry.item_id === String(item.item_id));
    if (existing) {
      const current = toPositiveQuantity(existing.quantity) || 1;
      existing.quantity = current + quantity;
      next.updated_at = new Date().toISOString();
      return ok({
        inventory: next,
        added: {
          item_id: String(item.item_id),
          quantity,
          bucket,
          stacked: true
        }
      });
    }
  }

  entries.push(createEntryFromItem(item, quantity, bucket));
  next.updated_at = new Date().toISOString();
  return ok({
    inventory: next,
    added: {
      item_id: String(item.item_id),
      quantity,
      bucket,
      stacked: false
    }
  });
}

function stackInventoryItem(inventory, item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return fail("item must be an object");
  }

  const forcedStackableItem = {
    ...item,
    stackable: true,
    bucket: "stackable_items"
  };

  return addItemToInventory(inventory, forcedStackableItem);
}

function removeItemFromInventory(inventory, item_id, quantity, options) {
  const normalizedResult = normalizeInventoryShape(inventory);
  if (!normalizedResult.ok) return normalizedResult;
  const config = options && typeof options === "object" ? options : {};
  const canRemoveEntry =
    typeof config.canRemoveEntry === "function" ? config.canRemoveEntry : function allowAny() {
      return true;
    };

  const itemId = item_id ? String(item_id) : "";
  if (!itemId) {
    return fail("item_id is required");
  }

  const qty = toPositiveQuantity(quantity);
  if (!qty) {
    return fail("quantity must be a positive number");
  }

  const next = normalizedResult.payload.inventory;
  const buckets = ["stackable_items", "equipment_items", "quest_items"];

  let totalOwned = 0;
  for (const bucket of buckets) {
    const list = next[bucket];
    for (const entry of list) {
      if (!entry || entry.item_id !== itemId) continue;
      if (!canRemoveEntry(entry)) continue;
      totalOwned += toPositiveQuantity(entry.quantity) || 1;
    }
  }

  if (totalOwned < qty) {
    return fail("insufficient_item_quantity", {
      item_id: itemId,
      quantity_requested: qty,
      quantity_owned: totalOwned
    });
  }

  let remaining = qty;
  for (const bucket of buckets) {
    const list = next[bucket];
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (!entry || entry.item_id !== itemId) continue;
      if (!canRemoveEntry(entry)) continue;
      if (remaining <= 0) break;

      const entryQty = toPositiveQuantity(entry.quantity) || 1;
      if (entryQty <= remaining) {
        remaining -= entryQty;
        list.splice(i, 1);
        i -= 1;
      } else {
        entry.quantity = entryQty - remaining;
        remaining = 0;
      }
    }
  }

  next.updated_at = new Date().toISOString();
  return ok({
    inventory: next,
    removed: {
      item_id: itemId,
      quantity: qty
    }
  });
}

module.exports = {
  addItemToInventory,
  removeItemFromInventory,
  stackInventoryItem,
  normalizeInventoryShape
};

"use strict";

// Player shop state model. This is listing/state scaffolding only.
// Purchase execution is handled in separate flow modules.
const PLAYER_SHOP_SCHEMA = {
  shop_id: "string",
  owner_player_id: "string",
  listings: "array",
  shop_active: "boolean",
  created_at: "string (ISO date)",
  updated_at: "string (ISO date)"
};

function normalizeListings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x === "object")
    .map((listing) => ({
      listing_id: listing.listing_id ? String(listing.listing_id) : `listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      item_id: listing.item_id ? String(listing.item_id) : null,
      quantity: Number.isFinite(listing.quantity) ? Math.max(0, Math.floor(listing.quantity)) : 0,
      price_gold: Number.isFinite(listing.price_gold) ? Math.max(0, Math.floor(listing.price_gold)) : 0,
      listing_active: listing.listing_active !== false
    }))
    .filter((x) => x.item_id !== null);
}

function createPlayerShopRecord(input) {
  const data = input || {};

  if (!data.shop_id || String(data.shop_id).trim() === "") {
    throw new Error("createPlayerShop requires shop_id");
  }
  if (!data.owner_player_id || String(data.owner_player_id).trim() === "") {
    throw new Error("createPlayerShop requires owner_player_id");
  }
  if (data.listings !== undefined && !Array.isArray(data.listings)) {
    throw new Error("createPlayerShop requires listings to be an array");
  }

  const now = new Date().toISOString();
  return {
    shop_id: String(data.shop_id),
    owner_player_id: String(data.owner_player_id),
    listings: normalizeListings(data.listings),
    shop_active: data.shop_active !== false,
    created_at: data.created_at || now,
    updated_at: data.updated_at || now
  };
}

module.exports = {
  PLAYER_SHOP_SCHEMA,
  createPlayerShopRecord
};

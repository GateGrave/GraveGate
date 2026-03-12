"use strict";

const {
  InMemoryCharacterStore,
  mockCharacterSaveLoadExample
} = require("./characters.store");
const {
  InMemoryInventoryStore,
  mockInventorySaveLoadExample
} = require("./inventories.store");
const {
  InMemoryItemStore,
  mockItemSaveLoadExample
} = require("./items.store");
const { InMemoryAccountStore } = require("./accounts.store");

module.exports = {
  InMemoryCharacterStore,
  InMemoryInventoryStore,
  InMemoryItemStore,
  InMemoryAccountStore,
  mockExamples: {
    characters: mockCharacterSaveLoadExample,
    inventories: mockInventorySaveLoadExample,
    items: mockItemSaveLoadExample
  }
};

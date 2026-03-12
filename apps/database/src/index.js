"use strict";

const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");
const { charactersSchema } = require("../schemas/characters.schema");
const { inventoriesSchema } = require("../schemas/inventories.schema");
const { sessionsSchema } = require("../schemas/sessions.schema");
const { combatsSchema } = require("../schemas/combats.schema");
const { WORLD_STATE, SESSION_STATE, COMBAT_STATE } = require("./state-layers");
const { InMemoryWorldState, mockWorldSaveLoadExample } = require("./world-state");
const { InMemorySessionState, mockSessionSaveLoadExample } = require("./session-state");
const { InMemoryCombatState, mockCombatSaveLoadExample } = require("./combat-state");
const {
  InMemoryCharacterStore,
  InMemoryInventoryStore,
  InMemoryItemStore,
  mockExamples: worldStorageMockExamples
} = require("./world-storage");

// Phase 1 database placeholder.
// This simulates where persistent storage will happen later.
class DatabasePlaceholder {
  constructor() {
    this.connected = false;
    this.savedEvents = [];
    // Separate in-memory stores for each state layer.
    // This mirrors the required architecture boundaries.
    this.worldState = new InMemoryWorldState();
    this.sessionState = new InMemorySessionState();
    this.combatState = new InMemoryCombatState();

    // Phase 2D world storage scaffolding.
    // These modules keep persistent World State concerns separate from
    // gateway, router, and combat systems.
    this.worldStorage = {
      characters: new InMemoryCharacterStore(),
      inventories: new InMemoryInventoryStore(),
      items: new InMemoryItemStore()
    };
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  /**
   * Accept one event and return a new acknowledgement event.
   * @param {object} event
   * @returns {object[]}
   */
  handleEvent(event) {
    if (!this.connected) {
      throw new Error("DatabasePlaceholder is not connected");
    }

    // Keep an in-memory copy so this placeholder stays side-effect free.
    this.savedEvents.push(event);

    return [
      createEvent(
        EVENT_TYPES.DATABASE_EVENT_SAVED,
        {
          event_id: event.event_id,
          original_event_type: event.event_type
        },
        { source: "database" }
      )
    ];
  }
}

module.exports = {
  DatabasePlaceholder,
  stores: {
    InMemoryWorldState,
    InMemorySessionState,
    InMemoryCombatState,
    InMemoryCharacterStore,
    InMemoryInventoryStore,
    InMemoryItemStore
  },
  mockExamples: {
    world: mockWorldSaveLoadExample,
    session: mockSessionSaveLoadExample,
    combat: mockCombatSaveLoadExample,
    worldStorage: worldStorageMockExamples
  },
  schemas: {
    characters: charactersSchema,
    inventories: inventoriesSchema,
    sessions: sessionsSchema,
    combats: combatsSchema
  },
  stateLayers: {
    world: WORLD_STATE,
    session: SESSION_STATE,
    combat: COMBAT_STATE
  }
};

"use strict";

// WORLD STATE (persistent layer, global scope)
// What belongs here:
// - Character profiles
// - Inventory ownership
// - Long-term progression and world metadata
// In Phase 1 this is an in-memory placeholder only.
class InMemoryWorldState {
  constructor() {
    this.records = new Map();
  }

  save(key, value) {
    this.records.set(key, value);
    return value;
  }

  load(key) {
    return this.records.get(key) || null;
  }
}

// Tiny mock save/load example for scaffolding demos.
function mockWorldSaveLoadExample() {
  const world = new InMemoryWorldState();
  world.save("character:char-001", { level: 2, class_name: "fighter" });
  return world.load("character:char-001");
}

module.exports = {
  InMemoryWorldState,
  mockWorldSaveLoadExample
};

"use strict";

// SESSION STATE (run-scoped layer)
// What belongs here:
// - Active party members
// - Current session location or node
// - Session progress/checkpoints
// In Phase 1 this is an in-memory placeholder only.
class InMemorySessionState {
  constructor() {
    this.sessions = new Map();
  }

  save(sessionId, value) {
    this.sessions.set(sessionId, value);
    return value;
  }

  load(sessionId) {
    return this.sessions.get(sessionId) || null;
  }
}

// Tiny mock save/load example for scaffolding demos.
function mockSessionSaveLoadExample() {
  const sessions = new InMemorySessionState();
  sessions.save("session-001", { dungeon_node: "N-12", party_size: 3 });
  return sessions.load("session-001");
}

module.exports = {
  InMemorySessionState,
  mockSessionSaveLoadExample
};

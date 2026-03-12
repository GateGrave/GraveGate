"use strict";

class InMemoryDungeonSessionStore {
  constructor() {
    this.sessions = new Map();
  }

  save(session) {
    this.sessions.set(session.session_id, session);
    return session;
  }

  load(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  list() {
    return Array.from(this.sessions.values());
  }
}

module.exports = {
  InMemoryDungeonSessionStore
};


"use strict";

const {
  createDungeonSessionRecord,
  isDungeonSessionShapeValid
} = require("../schema/dungeon-session.schema");
const { InMemoryDungeonSessionStore } = require("../store/in-memory-dungeon-session-store");

class DungeonSessionManager {
  constructor(options) {
    const config = options || {};
    this.store = config.store || new InMemoryDungeonSessionStore();
  }

  // Create a new dungeon session in Session State memory.
  // No dungeon gameplay logic is performed here.
  createDungeonSession(input) {
    const session = createDungeonSessionRecord(input || {});
    this.store.save(session);
    return session;
  }

  getDungeonSession(session_id) {
    return this.store.load(session_id);
  }

  // Updater can be a patch object or a function(currentSession) => nextSession.
  updateDungeonSession(session_id, updater) {
    const current = this.getDungeonSession(session_id);
    if (!current) return null;

    let updated;
    if (typeof updater === "function") {
      updated = updater(current);
    } else {
      updated = { ...current, ...(updater || {}) };
    }

    const finalSession = {
      ...current,
      ...updated,
      session_id: current.session_id,
      created_at: current.created_at,
      updated_at: new Date().toISOString()
    };

    if (!isDungeonSessionShapeValid(finalSession)) {
      throw new Error("Invalid dungeon session shape after update");
    }

    this.store.save(finalSession);
    return finalSession;
  }

  isDungeonSessionLocked(session_id) {
    const session = this.getDungeonSession(session_id);
    if (!session) return false;
    return Boolean(session.lock_flag || (session.lock && session.lock.locked));
  }

  lockDungeonSession(session_id, lockInfo) {
    const current = this.getDungeonSession(session_id);
    if (!current) {
      return {
        ok: false,
        reason: "session_not_found"
      };
    }

    if (this.isDungeonSessionLocked(session_id)) {
      return {
        ok: false,
        reason: "session_locked",
        recommendation: "queue_event_for_retry"
      };
    }

    const info = lockInfo || {};
    const locked = this.updateDungeonSession(session_id, {
      lock_flag: true,
      lock: {
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: info.locked_by || "session_event_processor",
        reason: info.reason || "event_processing"
      }
    });

    return {
      ok: true,
      session: locked
    };
  }

  unlockDungeonSession(session_id) {
    const current = this.getDungeonSession(session_id);
    if (!current) {
      return {
        ok: false,
        reason: "session_not_found"
      };
    }

    const unlocked = this.updateDungeonSession(session_id, {
      lock_flag: false,
      lock: {
        locked: false,
        locked_at: null,
        locked_by: null,
        reason: null
      }
    });

    return {
      ok: true,
      session: unlocked
    };
  }

  deleteDungeonSession(session_id) {
    return this.store.delete(session_id);
  }

  listActiveDungeonSessions() {
    return this.store
      .list()
      .filter((session) => session.session_status === "active");
  }
}

module.exports = {
  DungeonSessionManager
};

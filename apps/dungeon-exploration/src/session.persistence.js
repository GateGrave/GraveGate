"use strict";

const { createInMemoryAdapter } = require("../../database/src/adapters/inMemoryAdapter");
const { validateAdapterContract } = require("../../database/src/adapters/databaseAdapter.interface");
const { createDungeonSessionModel } = require("./core/dungeonSessionModel");

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

class SessionPersistenceBridge {
  constructor(options) {
    const cfg = options || {};
    this.adapter = cfg.adapter || createInMemoryAdapter();
    this.collection = cfg.collection ? String(cfg.collection) : "dungeon_sessions";

    const contract = validateAdapterContract(this.adapter);
    if (!contract.ok) {
      throw new Error(contract.error);
    }
  }

  validateStoredSessionShape(session) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      return { ok: false, error: "stored session data is not an object" };
    }
    if (!session.session_id || String(session.session_id).trim() === "") {
      return { ok: false, error: "stored session data is missing session_id" };
    }
    return { ok: true, error: null };
  }

  saveSession(session) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      return failure("session_persistence_save_failed", "session must be an object");
    }

    const normalized = createDungeonSessionModel(session);
    const sessionId = normalized.session_id ? String(normalized.session_id) : "";
    if (!sessionId) {
      return failure("session_persistence_save_failed", "session.session_id is required");
    }

    const out = typeof this.adapter.saveSession === "function"
      ? this.adapter.saveSession(normalized)
      : this.adapter.save(this.collection, sessionId, normalized);
    if (!out.ok) {
      return failure("session_persistence_save_failed", out.error || "adapter save failed", {
        adapter_result: out
      });
    }

    return success("session_persistence_saved", {
      session: clone(out.payload.record)
    });
  }

  loadSessionById(sessionId) {
    if (!sessionId || String(sessionId).trim() === "") {
      return failure("session_persistence_load_failed", "session_id is required");
    }

    const out = typeof this.adapter.getSessionById === "function"
      ? this.adapter.getSessionById(String(sessionId))
      : this.adapter.getById(this.collection, String(sessionId));
    if (!out.ok) {
      return failure("session_persistence_load_failed", out.error || "adapter getById failed", {
        adapter_result: out
      });
    }
    if (!out.payload.record) {
      return failure("session_persistence_load_failed", "session not found", {
        session_id: String(sessionId)
      });
    }

    const validation = this.validateStoredSessionShape(out.payload.record);
    if (!validation.ok) {
      return failure("session_persistence_load_failed", validation.error, {
        session_id: String(sessionId)
      });
    }

    return success("session_persistence_loaded", { session: clone(out.payload.record) });
  }

  listSessions() {
    const out = typeof this.adapter.listSessions === "function"
      ? this.adapter.listSessions()
      : this.adapter.list(this.collection);
    if (!out.ok) {
      return failure("session_persistence_list_failed", out.error || "adapter list failed", {
        adapter_result: out
      });
    }

    const sessions = [];
    if (Array.isArray(out.payload.records)) {
      for (const row of out.payload.records) {
        const validation = this.validateStoredSessionShape(row.record);
        if (!validation.ok) {
          return failure("session_persistence_list_failed", validation.error, {
            row_id: row && row.id ? String(row.id) : null
          });
        }
        sessions.push(clone(row.record));
      }
    }

    return success("session_persistence_listed", {
      sessions
    });
  }

  deleteSession(sessionId) {
    if (!sessionId || String(sessionId).trim() === "") {
      return failure("session_persistence_delete_failed", "session_id is required");
    }

    const out = typeof this.adapter.deleteSession === "function"
      ? this.adapter.deleteSession(String(sessionId))
      : this.adapter.delete(this.collection, String(sessionId));
    if (!out.ok) {
      return failure("session_persistence_delete_failed", out.error || "adapter delete failed", {
        adapter_result: out
      });
    }

    return success("session_persistence_deleted", {
      session_id: String(sessionId),
      deleted: Boolean(out.payload.deleted)
    });
  }
}

module.exports = {
  SessionPersistenceBridge
};

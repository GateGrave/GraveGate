"use strict";

// Interface-like contract for database adapters.
// Future adapters (SQLite/Postgres/etc) should expose this same method surface.
const DATABASE_ADAPTER_CONTRACT = {
  getById: "function(collection, id) => { ok, payload, error? }",
  list: "function(collection) => { ok, payload, error? }",
  save: "function(collection, id, record) => { ok, payload, error? }",
  delete: "function(collection, id) => { ok, payload, error? }",
  saveSession: "optional function(session) => { ok, payload, error? }",
  getSessionById: "optional function(sessionId) => { ok, payload, error? }",
  listSessions: "optional function() => { ok, payload, error? }",
  deleteSession: "optional function(sessionId) => { ok, payload, error? }",
  saveCombat: "optional function(combat or id+combat) => { ok, payload, error? }",
  getCombatById: "optional function(combatId) => { ok, payload, error? }",
  listCombats: "optional function() => { ok, payload, error? }",
  deleteCombat: "optional function(combatId) => { ok, payload, error? }"
};

function createNotImplementedResult(methodName) {
  return {
    ok: false,
    payload: {},
    error: methodName + " is not implemented"
  };
}

function validateAdapterContract(adapter) {
  const target = adapter || {};
  const requiredMethods = ["getById", "list", "save", "delete"];
  const missingMethods = requiredMethods.filter((name) => typeof target[name] !== "function");

  return {
    ok: missingMethods.length === 0,
    payload: {
      required_methods: requiredMethods,
      missing_methods: missingMethods
    },
    error: missingMethods.length === 0 ? null : "adapter is missing required methods"
  };
}

module.exports = {
  DATABASE_ADAPTER_CONTRACT,
  createNotImplementedResult,
  validateAdapterContract
};

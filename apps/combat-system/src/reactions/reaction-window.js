"use strict";

const { nowIso } = require("./reaction-utils");

function buildReactionWindow(input) {
  const waitMs = Number(input.wait_ms || 10000);

  return {
    window_id: `reaction-window-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    combat_id: input.combat_id,
    trigger_type: input.trigger_type,
    trigger_event_id: input.trigger_event_id || null,
    opened_at: nowIso(),
    expires_at: new Date(Date.now() + waitMs).toISOString(),
    wait_ms: waitMs,
    candidates: input.candidates || []
  };
}

async function waitForReactionDecision(input) {
  const waitMs = Number(input.wait_ms || 10000);
  const decisionProvider = input.decision_provider;
  const window = input.window;

  if (typeof decisionProvider !== "function") {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return {
      status: "timeout"
    };
  }

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve({ status: "timeout" }), waitMs);
  });

  const decisionPromise = Promise.resolve(
    decisionProvider({
      window
    })
  ).then((decision) => {
    if (!decision) {
      return { status: "declined" };
    }
    return decision;
  });

  return Promise.race([decisionPromise, timeoutPromise]);
}

module.exports = {
  buildReactionWindow,
  waitForReactionDecision
};

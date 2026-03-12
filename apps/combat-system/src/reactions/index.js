"use strict";

const { REACTION_TRIGGER_TYPES, REACTION_EVENT_TYPES } = require("./trigger-types");
const { ReactionRegistry } = require("./reaction-registry");
const {
  OPPORTUNITY_ATTACK,
  COUNTERSPELL_REACTION,
  PROTECT_ALLY_REACTION,
  createDefaultReactionDefinitions
} = require("./default-reactions");
const { detectReactionTrigger } = require("./detect-reaction-trigger");
const { buildReactionWindow, waitForReactionDecision } = require("./reaction-window");
const { consumeReactionAvailability, runReactionEngine } = require("./reaction-engine");
const { processReactionTriggerEvent } = require("./process-reaction-trigger-event");

function createDefaultReactionRegistry() {
  const registry = new ReactionRegistry();
  const defaults = createDefaultReactionDefinitions();
  for (const reaction of defaults) {
    registry.registerReaction(reaction);
  }
  return registry;
}

module.exports = {
  REACTION_TRIGGER_TYPES,
  REACTION_EVENT_TYPES,
  ReactionRegistry,
  OPPORTUNITY_ATTACK,
  COUNTERSPELL_REACTION,
  PROTECT_ALLY_REACTION,
  createDefaultReactionDefinitions,
  createDefaultReactionRegistry,
  detectReactionTrigger,
  buildReactionWindow,
  waitForReactionDecision,
  consumeReactionAvailability,
  runReactionEngine,
  processReactionTriggerEvent
};

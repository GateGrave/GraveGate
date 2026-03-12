"use strict";

// Single entry point so other files can import shared event helpers from one place.
const {
  EVENT_VERSION,
  SUPPORTED_EVENT_VERSIONS,
  REQUIRED_EVENT_FIELDS,
  isSupportedEventVersion,
  validateEventContract,
  createEvent,
  isValidEvent
} = require("./event-schema");
const { EVENT_TYPES } = require("./event-types");
const { STATE_LAYERS, EVENT_FLOW_NOTES, EVENT_CONTRACT_NOTES } = require("./state-layer-notes");

module.exports = {
  EVENT_VERSION,
  SUPPORTED_EVENT_VERSIONS,
  REQUIRED_EVENT_FIELDS,
  EVENT_TYPES,
  STATE_LAYERS,
  EVENT_FLOW_NOTES,
  EVENT_CONTRACT_NOTES,
  isSupportedEventVersion,
  validateEventContract,
  createEvent,
  isValidEvent
};

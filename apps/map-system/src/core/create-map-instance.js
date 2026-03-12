"use strict";

const { assertValidMapState } = require("../schema/map-state.schema");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMapInstance(baseMap, options) {
  const map = clone(baseMap);

  if (options && options.instance_id) {
    map.instance_id = options.instance_id;
  }

  if (options && options.instance_binding) {
    map.instance_binding = clone(options.instance_binding);
  }

  if (options && Array.isArray(options.tokens)) {
    map.tokens = clone(options.tokens);
  }

  if (options && Array.isArray(options.overlays)) {
    map.overlays = clone(options.overlays);
  }

  assertValidMapState(map);
  return map;
}

module.exports = {
  createMapInstance
};

"use strict";

const assert = require("assert");
const { createRoomModel, createRoomObject } = require("../rooms/roomModel");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runRoomModelTests() {
  const results = [];

  runTest("room_creation", () => {
    const out = createRoomModel({
      room_id: "room-001",
      name: "Entry Hall",
      description: "A stone entry room.",
      room_type: "encounter",
      exits: [
        { direction: "north", to_room_id: "room-002" }
      ],
      encounter: { encounter_id: "enc-001" },
      objects: [{ object_id: "torch-001" }]
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "room_created");
    assert.equal(out.payload.room.room_id, "room-001");
    assert.equal(out.payload.room.name, "Entry Hall");
    assert.equal(out.payload.room.room_type, "encounter");
  }, results);

  runTest("default_values", () => {
    const room = createRoomObject({
      room_id: "room-002"
    });

    assert.equal(room.name, "");
    assert.equal(room.description, "");
    assert.equal(room.room_type, "empty");
    assert.deepEqual(room.exits, []);
    assert.equal(room.encounter, null);
    assert.equal(room.challenge, null);
    assert.deepEqual(room.objects, []);
    assert.equal(room.discovered, false);
    assert.equal(room.cleared, false);
  }, results);

  runTest("exits_structure", () => {
    const room = createRoomObject({
      room_id: "room-003",
      exits: [
        { direction: "east", to_room_id: "room-004" },
        "room-005"
      ]
    });

    assert.equal(Array.isArray(room.exits), true);
    assert.equal(room.exits.length, 2);
    assert.deepEqual(room.exits[0], {
      direction: "east",
      to_room_id: "room-004"
    });
    assert.equal(room.exits[1], "room-005");
  }, results);

  runTest("custom_room_values", () => {
    const room = createRoomObject({
      room_id: "room-004",
      name: "Boss Gate",
      description: "A giant sealed door.",
      room_type: "boss",
      exits: [{ to_room_id: "room-003" }],
      encounter: { encounter_id: "enc-boss-001", threat: "high" },
      challenge: { challenge_id: "challenge-rune-001" },
      objects: [{ object_id: "altar-001" }],
      discovered: true,
      cleared: true
    });

    assert.equal(room.name, "Boss Gate");
    assert.equal(room.description, "A giant sealed door.");
    assert.equal(room.room_type, "boss");
    assert.equal(room.exits.length, 1);
    assert.deepEqual(room.exits[0], { direction: null, to_room_id: "room-003" });
    assert.equal(room.encounter.encounter_id, "enc-boss-001");
    assert.equal(room.challenge.challenge_id, "challenge-rune-001");
    assert.equal(room.objects.length, 1);
    assert.equal(room.discovered, true);
    assert.equal(room.cleared, true);
  }, results);

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    totals: {
      total: results.length,
      passed,
      failed
    },
    results
  };
}

if (require.main === module) {
  const summary = runRoomModelTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runRoomModelTests
};

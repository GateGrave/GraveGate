"use strict";

const assert = require("assert");
const { DungeonSessionManagerCore } = require("../core/dungeonSessionManager");
const { createRoomObject } = require("../rooms/roomModel");
const { interactWithObject } = require("../flow/interactWithObject");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function setupSessionWithObject(targetObject) {
  const manager = new DungeonSessionManagerCore();

  manager.createSession({
    session_id: "session-object-001",
    dungeon_id: "dungeon-object-001",
    status: "active"
  });

  manager.addRoomToSession({
    session_id: "session-object-001",
    room: createRoomObject({
      room_id: "room-O1",
      room_type: "empty",
      objects: [targetObject]
    })
  });

  manager.setStartRoom({
    session_id: "session-object-001",
    room_id: "room-O1"
  });

  return manager;
}

function runInteractWithObjectTests() {
  const results = [];

  runTest("opening_a_chest", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-chest-001",
      object_type: "chest"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "dungeon_object_interacted");
    assert.equal(out.payload.interaction_action, "opened");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const obj = room.objects.find((x) => x.object_id === "obj-chest-001");
    assert.equal(obj.is_opened, true);
  }, results);

  runTest("locked_chest_must_be_unlocked_before_opening", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-chest-locked-001",
      object_type: "chest",
      is_locked: true,
      metadata: { locked: true }
    });

    const blockedOpen = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-locked-001",
      action: "open"
    });
    assert.equal(blockedOpen.ok, false);
    assert.equal(blockedOpen.error, "object is locked");

    const unlockOut = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-locked-001",
      action: "unlock"
    });
    assert.equal(unlockOut.ok, true);
    assert.equal(unlockOut.payload.interaction_action, "unlocked");

    const openOut = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-locked-001",
      action: "open"
    });
    assert.equal(openOut.ok, true);
    assert.equal(openOut.payload.interaction_action, "opened");

    const duplicateOpen = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-locked-001",
      action: "open"
    });
    assert.equal(duplicateOpen.ok, false);
    assert.equal(duplicateOpen.error, "object already opened");
  }, results);

  runTest("disarming_a_trap_marks_object_disarmed", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-trap-001",
      object_type: "trap",
      is_triggered: true
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-trap-001",
      action: "disarm"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_action, "disarmed");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const obj = room.objects.find((x) => x.object_id === "obj-trap-001");
    assert.equal(obj.is_disarmed, true);
  }, results);

  runTest("activating_a_lever", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lever-001",
      object_type: "lever"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lever-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_action, "activated");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const obj = room.objects.find((x) => x.object_id === "obj-lever-001");
    assert.equal(obj.is_activated, true);
  }, results);

  runTest("interacting_with_a_shrine", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-shrine-001",
      object_type: "shrine"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-shrine-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_action, "used");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const obj = room.objects.find((x) => x.object_id === "obj-shrine-001");
    assert.equal(obj.is_used, true);
  }, results);

  runTest("reading_a_lore_object", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-001",
      object_type: "lore_object"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-001"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_action, "read");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const obj = room.objects.find((x) => x.object_id === "obj-lore-001");
    assert.equal(obj.is_read, true);

    const lastLog = out.payload.session.event_log[out.payload.session.event_log.length - 1];
    assert.equal(lastLog.event_type, "dungeon_object_interacted");
  }, results);

  runTest("dark_lore_object_requires_light_spell", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-dark-001",
      object_type: "lore_object",
      metadata: {
        requires_light: true,
        is_dark: true
      }
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-dark-001",
      action: "read"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object requires light");

    const lit = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-dark-001",
      action: "read",
      spell: {
        spell_id: "light",
        name: "Light",
        effect: {
          utility_ref: "spell_light_emits_bright_light"
        }
      }
    });

    assert.equal(lit.ok, true);
    assert.equal(lit.payload.interaction_action, "read");
    assert.equal(lit.payload.object_state.is_lit, true);
    assert.equal(lit.payload.spell_effect.spell_id, "light");
  }, results);

  runTest("lever_can_require_thaumaturgy", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lever-thaum-001",
      object_type: "lever",
      metadata: {
        requires_thaumaturgy: true
      }
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lever-thaum-001",
      action: "activate"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object requires thaumaturgy");

    const activated = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lever-thaum-001",
      action: "activate",
      spell: {
        spell_id: "thaumaturgy",
        name: "Thaumaturgy",
        effect: {
          utility_ref: "spell_thaumaturgy_minor_wonders"
        }
      }
    });

    assert.equal(activated.ok, true);
    assert.equal(activated.payload.interaction_action, "activated");
    assert.equal(activated.payload.spell_effect.spell_id, "thaumaturgy");
  }, results);

  runTest("invalid_object_failure", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-real-001",
      object_type: "chest"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-missing-001"
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "dungeon_object_interaction_failed");
    assert.equal(out.error, "object not found in current room");
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
  const summary = runInteractWithObjectTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runInteractWithObjectTests
};

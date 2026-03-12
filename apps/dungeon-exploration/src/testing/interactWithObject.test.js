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

  runTest("linked_trap_blocks_opening_trapped_chest_until_disarmed", () => {
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
        objects: [
          {
            object_id: "obj-chest-trapped-001",
            object_type: "chest",
            metadata: {
              linked_trap_object_id: "obj-trap-linked-001"
            }
          },
          {
            object_id: "obj-trap-linked-001",
            object_type: "trap"
          }
        ]
      })
    });

    manager.setStartRoom({
      session_id: "session-object-001",
      room_id: "room-O1"
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-trapped-001",
      action: "open"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object is trapped");
    assert.equal(blocked.payload.trap_trigger.object_id, "obj-trap-linked-001");

    const liveSession = manager.sessions.get("session-object-001");
    assert.equal(liveSession.movement_locked, true);

    const disarm = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-trap-linked-001",
      action: "disarm"
    });
    assert.equal(disarm.ok, true);

    const opened = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-chest-trapped-001",
      action: "open"
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.payload.interaction_action, "opened");
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

  runTest("locked_door_must_be_unlocked_before_opening", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-locked-001",
      object_type: "door",
      is_locked: true,
      metadata: { locked: true, to_room_id: "room-next" }
    });

    const blockedOpen = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-locked-001",
      action: "open"
    });
    assert.equal(blockedOpen.ok, false);
    assert.equal(blockedOpen.error, "object is locked");

    const unlockOut = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-locked-001",
      action: "unlock"
    });
    assert.equal(unlockOut.ok, true);
    assert.equal(unlockOut.payload.interaction_action, "unlocked");

    const openOut = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-locked-001",
      action: "open"
    });
    assert.equal(openOut.ok, true);
    assert.equal(openOut.payload.interaction_action, "opened");
    assert.equal(openOut.payload.next_event.event_type, "room_object_door_opened");
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

  runTest("lever_can_open_linked_door", () => {
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
        objects: [
          {
            object_id: "obj-lever-link-001",
            object_type: "lever",
            metadata: {
              linked_object_id: "obj-door-link-001"
            }
          },
          {
            object_id: "obj-door-link-001",
            object_type: "door",
            is_locked: true,
            metadata: {
              locked: true
            }
          }
        ]
      })
    });

    manager.setStartRoom({
      session_id: "session-object-001",
      room_id: "room-O1"
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lever-link-001",
      action: "activate"
    });

    assert.equal(out.ok, true);
    assert.equal(Array.isArray(out.payload.interaction_effects), true);
    assert.equal(out.payload.interaction_effects[0].effect_type, "linked_object_opened");

    const room = out.payload.session.rooms.find((x) => x.room_id === "room-O1");
    const door = room.objects.find((x) => x.object_id === "obj-door-link-001");
    assert.equal(door.is_locked, false);
    assert.equal(door.is_opened, true);
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

  runTest("shrine_can_grant_session_blessing", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-shrine-blessing-001",
      object_type: "shrine",
      metadata: {
        blessing_key: "shrine:embers_guard",
        blessing_metadata: {
          kind: "ward",
          flavor: "Warm emberlight shields the party."
        }
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-shrine-blessing-001",
      action: "use"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_effects[0].effect_type, "blessing_granted");
    assert.equal(out.payload.session.blessing_state.active_blessings[0].blessing_key, "shrine:embers_guard");
  }, results);

  runTest("shrine_can_reveal_rooms_and_clear_movement_lock", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-shrine-scout-001",
      object_type: "shrine",
      metadata: {
        blessing_key: "shrine:pathfinder",
        reveal_room_ids: ["room-secret-001", "room-secret-002"],
        clear_movement_lock: true
      }
    });
    const liveSession = manager.sessions.get("session-object-001");
    liveSession.movement_locked = true;
    manager.sessions.set("session-object-001", liveSession);

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-shrine-scout-001",
      action: "use"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.session.movement_locked, false);
    assert.equal(out.payload.session.discovered_rooms.includes("room-secret-001"), true);
    assert.equal(out.payload.session.discovered_rooms.includes("room-secret-002"), true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "room_revealed" && entry.room_id === "room-secret-001"), true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "movement_lock_cleared"), true);
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

  runTest("reading_lore_object_can_record_discovery", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-discovery-001",
      object_type: "lore_object",
      metadata: {
        discovery_key: "lore:first-tablet"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-discovery-001",
      action: "read"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.interaction_effects[0].effect_type, "lore_discovered");
    assert.equal(out.payload.session.discovery_state.lore_keys.includes("lore:first-tablet"), true);
  }, results);

  runTest("lore_object_can_reveal_rooms_when_read", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-map-001",
      object_type: "lore_object",
      metadata: {
        discovery_key: "lore:hidden-map",
        reveal_room_ids: ["room-map-001"]
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-map-001",
      action: "read"
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.session.discovery_state.lore_keys.includes("lore:hidden-map"), true);
    assert.equal(out.payload.session.discovered_rooms.includes("room-map-001"), true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "room_revealed" && entry.room_id === "room-map-001"), true);
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

  runTest("knock_can_unlock_a_locked_door", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-knock-001",
      object_type: "door",
      is_locked: true,
      metadata: { locked: true, to_room_id: "room-next" }
    });

    const unlocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-knock-001",
      action: "unlock",
      spell: {
        spell_id: "knock",
        name: "Knock",
        effect: {
          utility_ref: "spell_knock_unlocks_object"
        }
      }
    });

    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.payload.interaction_action, "unlocked");
    assert.equal(unlocked.payload.spell_effect.spell_id, "knock");
    assert.equal(unlocked.payload.object_state.is_unlocked, true);
  }, results);

  runTest("detect_magic_can_reveal_object_aura", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-magic-001",
      object_type: "lore_object",
      metadata: {
        magic_aura: true,
        detect_magic_reveal: "abjuration aura"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-magic-001",
      action: "read",
      spell: {
        spell_id: "detect_magic",
        name: "Detect Magic",
        effect: {
          utility_ref: "spell_detect_magic_reveals_aura"
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.spell_effect.spell_id, "detect_magic");
    assert.equal(out.payload.spell_effect.object_state, "magic_revealed");
    assert.equal(out.payload.spell_effect.aura_summary, "abjuration aura");
  }, results);

  runTest("required_skill_blocks_interaction_without_proficiency", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-arcana-001",
      object_type: "lore_object",
      metadata: {
        required_skill: "arcana",
        required_skill_action: "read"
      }
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-arcana-001",
      action: "read",
      skill_profile: {}
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object requires arcana");
  }, results);

  runTest("required_skill_allows_interaction_with_proficiency", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-arcana-002",
      object_type: "lore_object",
      metadata: {
        required_skill: "arcana",
        required_skill_action: "read"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-arcana-002",
      action: "read",
      skill_profile: {
        arcana: true
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.skill_check.skill_id, "arcana");
    assert.equal(out.payload.skill_check.passed, true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "skill_requirement_passed" && entry.skill_id === "arcana"), true);
  }, results);

  runTest("required_skill_dc_uses_rolled_check_and_can_fail", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-lore-investigation-001",
      object_type: "lore_object",
      metadata: {
        required_skill: "investigation",
        required_skill_action: "read",
        required_skill_dc: 15
      }
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-lore-investigation-001",
      action: "read",
      skill_profile: { investigation: true },
      character_profile: {
        stats: { intelligence: 10 },
        proficiency_bonus: 2
      },
      check_context: {
        forced_roll: 1
      }
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object requires investigation");
    assert.equal(blocked.payload.check_result.target_id, "investigation");
    assert.equal(blocked.payload.check_result.passed, false);
  }, results);

  runTest("required_skill_dc_can_reveal_hidden_path_on_success", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-hidden-001",
      object_type: "lore_object",
      metadata: {
        required_skill: "investigation",
        required_skill_action: "read",
        required_skill_dc: 10,
        reveal_hidden_on_pass: true,
        hidden: true
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-hidden-001",
      action: "read",
      skill_profile: { investigation: true },
      character_profile: {
        stats: { intelligence: 14 },
        proficiency_bonus: 2
      },
      check_context: {
        forced_roll: 10
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.skill_check.skill_id, "investigation");
    assert.equal(out.payload.skill_check.passed, true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "hidden_path_revealed"), true);
  }, results);

  runTest("required_tool_blocks_interaction_without_tool_proficiency", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-tools-001",
      object_type: "door",
      is_locked: true,
      metadata: {
        locked: true,
        required_tool: "thieves_tools",
        required_tool_action: "unlock"
      }
    });

    const blocked = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-tools-001",
      action: "unlock",
      tool_profile: []
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "object requires thieves_tools");
  }, results);

  runTest("required_tool_allows_interaction_with_tool_proficiency", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-tools-002",
      object_type: "door",
      is_locked: true,
      metadata: {
        locked: true,
        required_tool: "thieves_tools",
        required_tool_action: "unlock"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-tools-002",
      action: "unlock",
      tool_profile: ["thieves_tools"]
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.tool_check.tool_id, "thieves_tools");
    assert.equal(out.payload.tool_check.passed, true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "tool_requirement_passed" && entry.tool_id === "thieves_tools"), true);
  }, results);

  runTest("required_tool_dc_uses_rolled_check", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-door-tools-003",
      object_type: "door",
      is_locked: true,
      metadata: {
        locked: true,
        required_tool: "thieves_tools",
        required_tool_action: "unlock",
        required_tool_dc: 12
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-door-tools-003",
      action: "unlock",
      tool_profile: ["thieves_tools"],
      character_profile: {
        stats: { dexterity: 14 },
        proficiency_bonus: 2
      },
      check_context: {
        forced_roll: 8
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.tool_check.tool_id, "thieves_tools");
    assert.equal(out.payload.tool_check.passed, true);
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "tool_check_passed" && entry.tool_id === "thieves_tools"), true);
  }, results);

  runTest("identify_can_reveal_hidden_magical_object_reference", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-relic-001",
      object_type: "shrine",
      metadata: {
        hidden_item_ref: "item_ring_of_protection",
        identify_reveal: "Ring of Protection"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-relic-001",
      action: "use",
      spell: {
        spell_id: "identify",
        name: "Identify",
        effect: {
          utility_ref: "spell_identify_reveals_object_nature"
        }
      },
      item_index: {
        item_ring_of_protection: {
          item_id: "item_ring_of_protection",
          name: "Ring of Protection"
        }
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.spell_effect.spell_id, "identify");
    assert.equal(out.payload.spell_effect.object_state, "identified");
    assert.equal(out.payload.spell_effect.identified_item_id, "item_ring_of_protection");
    assert.equal(out.payload.spell_effect.identified_item_name, "Ring of Protection");
  }, results);

  runTest("detect_magic_plus_arcana_can_clear_arcane_seal", () => {
    const manager = setupSessionWithObject({
      object_id: "obj-ward-001",
      object_type: "shrine",
      metadata: {
        requires_detect_magic: true,
        required_skill: "arcana",
        required_skill_action: "use",
        required_skill_dc: 12,
        clear_magic_seal_on_pass: true,
        magic_aura: true,
        detect_magic_reveal: "abjuration ward"
      }
    });

    const out = interactWithObject({
      manager,
      session_id: "session-object-001",
      object_id: "obj-ward-001",
      action: "use",
      spell: {
        spell_id: "detect_magic",
        name: "Detect Magic",
        effect: {
          utility_ref: "spell_detect_magic_reveals_aura"
        }
      },
      skill_profile: { arcana: true },
      character_profile: {
        stats: { intelligence: 16 },
        proficiency_bonus: 2
      },
      check_context: {
        forced_roll: 8
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.spell_effect.spell_id, "detect_magic");
    assert.equal(out.payload.skill_check.skill_id, "arcana");
    assert.equal(out.payload.interaction_effects.some((entry) => entry.effect_type === "arcane_seal_cleared"), true);
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

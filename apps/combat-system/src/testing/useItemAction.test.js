"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { useItemAction } = require("../actions/useItemAction");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createActiveCombatForUseItemTests() {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: "combat-item-001",
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["p1", "p2"],
    participants: [
      {
        participant_id: "p1",
        name: "Hero",
        team: "A",
        armor_class: 12,
        current_hp: 6,
        max_hp: 10,
        attack_bonus: 3,
        damage: 4
      },
      {
        participant_id: "p2",
        name: "Goblin",
        team: "B",
        armor_class: 11,
        current_hp: 10,
        max_hp: 10,
        attack_bonus: 2,
        damage: 3
      }
    ],
    event_log: []
  });
  return manager;
}

function runUseItemActionTests() {
  const results = [];

  runTest("successful_healing_item_use", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.event_type, "use_item_action_resolved");
    assert.equal(out.payload.hp_before, 6);
    assert.equal(out.payload.hp_after, 9);
    assert.equal(out.payload.healed_for, 3);
    assert.equal(out.payload.combat.event_log.length, 1);
    assert.equal(out.payload.combat.event_log[0].event_type, "use_item_action");
    const actor = out.payload.combat.participants.find((entry) => entry.participant_id === "p1");
    assert.equal(actor.action_available, false);
  }, results);

  runTest("using_item_consumes_action_for_turn", () => {
    const manager = createActiveCombatForUseItemTests();
    const first = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });
    assert.equal(first.ok, true);

    const second = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "action is not available");
  }, results);

  runTest("hp_does_not_exceed_max_hp", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-large",
        item_type: "consumable",
        heal_amount: 99
      }
    });

    assert.equal(out.ok, true);
    assert.equal(out.payload.hp_after, 10);
    assert.equal(out.payload.healed_for, 4);
  }, results);

  runTest("wrong_turn_failure", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    combat.turn_index = 1;
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "it is not the participant's turn");
  }, results);

  runTest("invalid_item_type_failure", () => {
    const manager = createActiveCombatForUseItemTests();
    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-bomb",
        item_type: "throwable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "only consumable items are supported");
  }, results);

  runTest("defeated_participant_cannot_use_item", () => {
    const manager = createActiveCombatForUseItemTests();
    const found = manager.getCombatById("combat-item-001");
    const combat = found.payload.combat;
    const actor = combat.participants.find((p) => p.participant_id === "p1");
    actor.current_hp = 0;
    manager.combats.set("combat-item-001", combat);

    const out = useItemAction({
      combatManager: manager,
      combat_id: "combat-item-001",
      participant_id: "p1",
      item: {
        item_id: "item-heal-small",
        item_type: "consumable",
        heal_amount: 3
      }
    });

    assert.equal(out.ok, false);
    assert.equal(out.event_type, "use_item_action_failed");
    assert.equal(out.error, "defeated participants cannot act");
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
  const summary = runUseItemActionTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runUseItemActionTests
};

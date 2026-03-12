"use strict";

const { CombatRegistry } = require("../registry/combat-registry");
const { processCombatEventSafe } = require("../processing/process-combat-event-safe");

async function runLockingExample() {
  const registry = new CombatRegistry();
  const combat = registry.createCombat({
    combat_id: "combat-lock-demo",
    participants: [{ participant_id: "p1" }, { participant_id: "e1" }]
  });

  const firstEvent = { event_id: "evt-1", event_type: "turn_tick", combat_id: combat.combat_id };

  const firstResult = await processCombatEventSafe({
    registry,
    event: firstEvent,
    processEventFn: async ({ combatState }) => {
      return {
        statePatch: {
          round_number: combatState.round_number + 1
        },
        output: { message: "round advanced" }
      };
    }
  });

  // Simulate an already locked combat to show safe response.
  registry.lockCombat(combat.combat_id, { reason: "manual_test_lock", locked_by: "example" });

  const secondResult = await processCombatEventSafe({
    registry,
    event: { event_id: "evt-2", event_type: "turn_tick", combat_id: combat.combat_id },
    processEventFn: async () => ({ statePatch: {} })
  });

  // Unlock and run a failing processor to show finally-unlock behavior.
  registry.unlockCombat(combat.combat_id);

  const thirdResult = await processCombatEventSafe({
    registry,
    event: { event_id: "evt-3", event_type: "bad_event", combat_id: combat.combat_id },
    processEventFn: async () => {
      throw new Error("processing failed on purpose");
    }
  });

  console.log("First result:", firstResult.status);
  console.log("Second result:", secondResult.status, secondResult.recommendation);
  console.log("Third result:", thirdResult.status, thirdResult.reason);
  console.log("Still unlocked after error:", registry.isCombatLocked(combat.combat_id) === false);
}

if (require.main === module) {
  runLockingExample().catch((error) => {
    console.error("Locking example failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runLockingExample
};

"use strict";

const assert = require("assert");
const { commandDefinitions } = require("../discord/commandDefinitions");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function runCommandDefinitionsTests() {
  const results = [];

  runTest("slash_registration_includes_stage_13_commands", () => {
    const names = commandDefinitions.map(function mapCommand(def) {
      return def.name;
    });

    assert.equal(names.includes("ping"), true);
    assert.equal(names.includes("help"), true);
    assert.equal(names.includes("profile"), true);
    assert.equal(names.includes("combat"), true);
    assert.equal(names.includes("inventory"), true);
    assert.equal(names.includes("shop"), true);
    assert.equal(names.includes("craft"), true);
    assert.equal(names.includes("trade"), true);
    assert.equal(names.includes("admin"), true);
    assert.equal(names.includes("start"), true);
    assert.equal(names.includes("equip"), true);
    assert.equal(names.includes("unequip"), true);
    assert.equal(names.includes("identify"), true);
    assert.equal(names.includes("attune"), true);
    assert.equal(names.includes("unattune"), true);
    assert.equal(names.includes("feat"), true);
    assert.equal(names.includes("dungeon"), true);
    assert.equal(names.includes("leave"), true);
    assert.equal(names.includes("interact"), true);
    assert.equal(names.includes("move"), true);
    assert.equal(names.includes("attack"), true);
    assert.equal(names.includes("assist"), true);
    assert.equal(names.includes("ready"), true);
    assert.equal(names.includes("dodge"), true);
    assert.equal(names.includes("dash"), true);
    assert.equal(names.includes("grapple"), true);
    assert.equal(names.includes("escape"), true);
    assert.equal(names.includes("shove"), true);
    assert.equal(names.includes("disengage"), true);
    assert.equal(names.includes("cast"), true);
    assert.equal(names.includes("use"), true);
    assert.equal(commandDefinitions.length >= 24, true);

    const startDef = commandDefinitions.find(function findStart(def) {
      return def.name === "start";
    });
    const adminDef = commandDefinitions.find(function findAdmin(def) {
      return def.name === "admin";
    });
    assert.equal(Boolean(startDef), true);
    assert.equal(Boolean(adminDef), true);
    assert.equal(Array.isArray(startDef.options), true);
    assert.equal(Array.isArray(adminDef.options), true);

    const equipDef = commandDefinitions.find(function findEquip(def) {
      return def.name === "equip";
    });
    const unequipDef = commandDefinitions.find(function findUnequip(def) {
      return def.name === "unequip";
    });
    const dungeonDef = commandDefinitions.find(function findDungeon(def) {
      return def.name === "dungeon";
    });
    const identifyDef = commandDefinitions.find(function findIdentify(def) {
      return def.name === "identify";
    });
    const attuneDef = commandDefinitions.find(function findAttune(def) {
      return def.name === "attune";
    });
    const unattuneDef = commandDefinitions.find(function findUnattune(def) {
      return def.name === "unattune";
    });
    const featDef = commandDefinitions.find(function findFeat(def) {
      return def.name === "feat";
    });
    const leaveDef = commandDefinitions.find(function findLeave(def) {
      return def.name === "leave";
    });
    const interactDef = commandDefinitions.find(function findInteract(def) {
      return def.name === "interact";
    });
    const moveDef = commandDefinitions.find(function findMove(def) {
      return def.name === "move";
    });
    const shopDef = commandDefinitions.find(function findShop(def) {
      return def.name === "shop";
    });
    const craftDef = commandDefinitions.find(function findCraft(def) {
      return def.name === "craft";
    });
    const tradeDef = commandDefinitions.find(function findTrade(def) {
      return def.name === "trade";
    });
    const attackDef = commandDefinitions.find(function findAttack(def) {
      return def.name === "attack";
    });
    const assistDef = commandDefinitions.find(function findAssist(def) {
      return def.name === "assist";
    });
    const readyDef = commandDefinitions.find(function findReady(def) {
      return def.name === "ready";
    });
    const dodgeDef = commandDefinitions.find(function findDodge(def) {
      return def.name === "dodge";
    });
    const dashDef = commandDefinitions.find(function findDash(def) {
      return def.name === "dash";
    });
    const grappleDef = commandDefinitions.find(function findGrapple(def) {
      return def.name === "grapple";
    });
    const escapeDef = commandDefinitions.find(function findEscape(def) {
      return def.name === "escape";
    });
    const shoveDef = commandDefinitions.find(function findShove(def) {
      return def.name === "shove";
    });
    const disengageDef = commandDefinitions.find(function findDisengage(def) {
      return def.name === "disengage";
    });
    const castDef = commandDefinitions.find(function findCast(def) {
      return def.name === "cast";
    });
    const useDef = commandDefinitions.find(function findUse(def) {
      return def.name === "use";
    });
    assert.equal(Boolean(equipDef), true);
    assert.equal(Boolean(unequipDef), true);
    assert.equal(Boolean(dungeonDef), true);
    assert.equal(Boolean(identifyDef), true);
    assert.equal(Boolean(attuneDef), true);
    assert.equal(Boolean(unattuneDef), true);
    assert.equal(Boolean(featDef), true);
    assert.equal(Boolean(leaveDef), true);
    assert.equal(Boolean(interactDef), true);
    assert.equal(Boolean(moveDef), true);
    assert.equal(Boolean(shopDef), true);
    assert.equal(Boolean(craftDef), true);
    assert.equal(Boolean(tradeDef), true);
    assert.equal(Boolean(attackDef), true);
    assert.equal(Boolean(assistDef), true);
    assert.equal(Boolean(readyDef), true);
    assert.equal(Boolean(dodgeDef), true);
    assert.equal(Boolean(dashDef), true);
    assert.equal(Boolean(grappleDef), true);
    assert.equal(Boolean(escapeDef), true);
    assert.equal(Boolean(shoveDef), true);
    assert.equal(Boolean(disengageDef), true);
    assert.equal(Boolean(castDef), true);
    assert.equal(Boolean(useDef), true);
    assert.equal(Array.isArray(equipDef.options), true);
    assert.equal(Array.isArray(unequipDef.options), true);
    assert.equal(Array.isArray(dungeonDef.options), true);
    assert.equal(Array.isArray(identifyDef.options), true);
    assert.equal(Array.isArray(attuneDef.options), true);
    assert.equal(Array.isArray(unattuneDef.options), true);
    assert.equal(Array.isArray(featDef.options), true);
    assert.equal(Array.isArray(leaveDef.options), true);
    assert.equal(Array.isArray(interactDef.options), true);
    assert.equal(Array.isArray(moveDef.options), true);
    assert.equal(Array.isArray(shopDef.options), true);
    assert.equal(Array.isArray(craftDef.options), true);
    assert.equal(Array.isArray(tradeDef.options), true);
    assert.equal(Array.isArray(attackDef.options), true);
    assert.equal(Array.isArray(assistDef.options), true);
    assert.equal(Array.isArray(readyDef.options), true);
    assert.equal(Array.isArray(dodgeDef.options), true);
    assert.equal(Array.isArray(dashDef.options), true);
    assert.equal(Array.isArray(grappleDef.options), true);
    assert.equal(Array.isArray(escapeDef.options), true);
    assert.equal(Array.isArray(shoveDef.options), true);
    assert.equal(Array.isArray(disengageDef.options), true);
    assert.equal(Array.isArray(castDef.options), true);
    assert.equal(Array.isArray(useDef.options), true);

    const hasEnterSubcommand = dungeonDef.options.some(function hasEnter(option) {
      return option && option.name === "enter";
    });
    assert.equal(hasEnterSubcommand, true);
    const interactSpellOption = interactDef.options.find(function findOption(option) {
      return option && option.name === "spell_id";
    });
    assert.equal(Boolean(interactSpellOption), true);
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
  const summary = runCommandDefinitionsTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCommandDefinitionsTests
};

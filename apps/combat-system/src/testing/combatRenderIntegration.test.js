"use strict";

const assert = require("assert");
const { CombatManager } = require("../core/combatManager");
const { renderCombatById } = require("../flow/renderCombatState");
const { performMoveAction } = require("../actions/moveAction");
const { startCombat } = require("../flow/startCombat");

function runTest(name, fn, results) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error.message });
  }
}

function createRenderReadyCombat(combatId) {
  const manager = new CombatManager();
  manager.createCombat({
    combat_id: combatId,
    status: "active",
    round: 1,
    turn_index: 0,
    initiative_order: ["hero-001", "enemy-001"],
    participants: [
      {
        participant_id: "hero-001",
        name: "Hero",
        team: "heroes",
        current_hp: 10,
        max_hp: 10,
        position: { x: 0, y: 0 }
      },
      {
        participant_id: "enemy-001",
        name: "Enemy",
        team: "monsters",
        current_hp: 8,
        max_hp: 8,
        position: { x: 2, y: 1 }
      }
    ],
    battlefield_grid: {
      width: 4,
      height: 3,
      tile_size_feet: 5,
      tiles: [
        { x: 0, y: 0, terrain: "normal", status_effects: [] },
        { x: 1, y: 0, terrain: "normal", status_effects: [] },
        { x: 2, y: 0, terrain: "normal", status_effects: [] },
        { x: 3, y: 0, terrain: "normal", status_effects: [] },
        { x: 0, y: 1, terrain: "normal", status_effects: [] },
        { x: 1, y: 1, terrain: "difficult", status_effects: [] },
        { x: 2, y: 1, terrain: "normal", status_effects: ["blocks_line_of_effect"] },
        { x: 3, y: 1, terrain: "wall", status_effects: [] },
        { x: 0, y: 2, terrain: "hazard", status_effects: [] },
        { x: 1, y: 2, terrain: "normal", status_effects: [] },
        { x: 2, y: 2, terrain: "normal", status_effects: [] },
        { x: 3, y: 2, terrain: "normal", status_effects: [] }
      ]
    }
  });
  return manager;
}

function getActor(manifest, participantId) {
  const list = manifest && manifest.layers && Array.isArray(manifest.layers.actors) ? manifest.layers.actors : [];
  return list.find((entry) => entry.participant_id === participantId) || null;
}

function runCombatRenderIntegrationTests() {
  const results = [];

  runTest("canonical_render_path_uses_authoritative_combat_state", () => {
    const manager = createRenderReadyCombat("combat-render-authoritative-001");
    const first = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-authoritative-001",
      options: { tile_size_px: 32 }
    });
    assert.equal(first.ok, true);

    const loaded = manager.getCombatById("combat-render-authoritative-001");
    const combat = loaded.payload.combat;
    const hero = combat.participants.find((p) => p.participant_id === "hero-001");
    hero.position = { x: 1, y: 2 };
    manager.combats.set("combat-render-authoritative-001", combat);

    const second = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-authoritative-001",
      options: { tile_size_px: 32 }
    });
    assert.equal(second.ok, true);

    const heroActor = getActor(second.payload.render.render_manifest, "hero-001");
    assert.equal(heroActor.tile_x, 1);
    assert.equal(heroActor.tile_y, 2);
  }, results);

  runTest("tile_coordinates_map_to_expected_pixel_positions", () => {
    const manager = createRenderReadyCombat("combat-render-pixels-001");
    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-pixels-001",
      options: { tile_size_px: 40 }
    });
    assert.equal(out.ok, true);
    assert.equal(out.payload.render.width_px, 160);
    assert.equal(out.payload.render.height_px, 120);

    const heroActor = getActor(out.payload.render.render_manifest, "hero-001");
    assert.equal(heroActor.pixel_x >= 0, true);
    assert.equal(heroActor.pixel_y >= 0, true);
    assert.equal(heroActor.tile_x, 0);
    assert.equal(heroActor.tile_y, 0);
  }, results);

  runTest("render_layer_order_is_stable_and_predictable", () => {
    const manager = createRenderReadyCombat("combat-render-layers-001");
    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-layers-001",
      options: { tile_size_px: 24 }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.payload.render.render_manifest.layer_order, ["terrain", "environment", "actors", "effects"]);
  }, results);

  runTest("token_movement_is_reflected_in_subsequent_render", () => {
    const manager = createRenderReadyCombat("combat-render-move-001");
    const moved = performMoveAction({
      combatManager: manager,
      combat_id: "combat-render-move-001",
      participant_id: "hero-001",
      target_position: { x: 1, y: 0 }
    });
    assert.equal(moved.ok, true);

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-move-001",
      options: { tile_size_px: 24 }
    });
    assert.equal(out.ok, true);
    const heroActor = getActor(out.payload.render.render_manifest, "hero-001");
    assert.equal(heroActor.tile_x, 1);
    assert.equal(heroActor.tile_y, 0);
  }, results);

  runTest("defeated_actors_are_not_rendered", () => {
    const manager = createRenderReadyCombat("combat-render-defeated-001");
    const loaded = manager.getCombatById("combat-render-defeated-001");
    const combat = loaded.payload.combat;
    const enemy = combat.participants.find((p) => p.participant_id === "enemy-001");
    enemy.current_hp = 0;
    manager.combats.set("combat-render-defeated-001", combat);

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-defeated-001"
    });
    assert.equal(out.ok, true);
    const actor = getActor(out.payload.render.render_manifest, "enemy-001");
    assert.equal(actor, null);
  }, results);

  runTest("missing_token_assets_fall_back_without_crash", () => {
    const manager = createRenderReadyCombat("combat-render-token-fallback-001");
    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-token-fallback-001"
    });
    assert.equal(out.ok, true);
    const heroActor = getActor(out.payload.render.render_manifest, "hero-001");
    assert.equal(heroActor.token_fallback_used, true);
  }, results);

  runTest("renderer_rejects_missing_authoritative_battlefield_grid", () => {
    const manager = new CombatManager();
    manager.createCombat({
      combat_id: "combat-render-missing-grid-001",
      status: "active",
      participants: [
        {
          participant_id: "hero-001",
          name: "Hero",
          team: "heroes",
          current_hp: 10,
          max_hp: 10,
          position: { x: 0, y: 0 }
        }
      ],
      battlefield_grid: null
    });

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-missing-grid-001"
    });
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_render_failed");
    assert.equal(out.payload.reason, "invalid_battlefield_grid_dimensions");
  }, results);

  runTest("combat_start_seeds_authoritative_battlefield_grid_for_rendering", () => {
    const manager = new CombatManager();
    manager.createCombat({
      combat_id: "combat-render-seeded-grid-001",
      status: "pending",
      battlefield: { width: 4, height: 4 },
      participants: [
        {
          participant_id: "hero-001",
          name: "Hero",
          team: "heroes",
          current_hp: 10,
          max_hp: 10,
          position: { x: 0, y: 0 }
        },
        {
          participant_id: "enemy-001",
          name: "Enemy",
          team: "monsters",
          current_hp: 10,
          max_hp: 10,
          position: { x: 2, y: 1 }
        }
      ]
    });

    const started = startCombat({
      combatManager: manager,
      combat_id: "combat-render-seeded-grid-001",
      roll_function: () => 10
    });
    assert.equal(started.ok, true);
    assert.equal(started.payload.combat.battlefield_grid.width, 4);
    assert.equal(started.payload.combat.battlefield_grid.height, 4);

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-seeded-grid-001"
    });
    assert.equal(out.ok, true);
    const heroActor = getActor(out.payload.render.render_manifest, "hero-001");
    assert.equal(heroActor.tile_x, 0);
    assert.equal(heroActor.tile_y, 0);
  }, results);

  runTest("out_of_bounds_positions_fail_safely", () => {
    const manager = createRenderReadyCombat("combat-render-oob-001");
    const loaded = manager.getCombatById("combat-render-oob-001");
    const combat = loaded.payload.combat;
    const hero = combat.participants.find((p) => p.participant_id === "hero-001");
    hero.position = { x: 999, y: 0 };
    manager.combats.set("combat-render-oob-001", combat);

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-oob-001"
    });
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_render_failed");
    assert.equal(out.payload.reason, "out_of_bounds_position");
  }, results);

  runTest("ended_combat_render_requests_are_rejected_safely", () => {
    const manager = createRenderReadyCombat("combat-render-ended-001");
    const loaded = manager.getCombatById("combat-render-ended-001");
    const combat = loaded.payload.combat;
    combat.status = "complete";
    manager.combats.set("combat-render-ended-001", combat);

    const out = renderCombatById({
      combatManager: manager,
      combat_id: "combat-render-ended-001"
    });
    assert.equal(out.ok, false);
    assert.equal(out.event_type, "combat_render_failed");
    assert.equal(out.payload.reason, "combat_not_active");
  }, results);

  runTest("concurrent_combat_renders_do_not_bleed_state", () => {
    const managerA = createRenderReadyCombat("combat-render-concurrent-a");
    const managerB = createRenderReadyCombat("combat-render-concurrent-b");
    const loadedB = managerB.getCombatById("combat-render-concurrent-b");
    const combatB = loadedB.payload.combat;
    combatB.participants[0].position = { x: 3, y: 2 };
    managerB.combats.set("combat-render-concurrent-b", combatB);

    const renderA = renderCombatById({
      combatManager: managerA,
      combat_id: "combat-render-concurrent-a",
      options: { tile_size_px: 20 }
    });
    const renderB = renderCombatById({
      combatManager: managerB,
      combat_id: "combat-render-concurrent-b",
      options: { tile_size_px: 20 }
    });

    assert.equal(renderA.ok, true);
    assert.equal(renderB.ok, true);
    const heroA = getActor(renderA.payload.render.render_manifest, "hero-001");
    const heroB = getActor(renderB.payload.render.render_manifest, "hero-001");
    assert.equal(heroA.tile_x, 0);
    assert.equal(heroA.tile_y, 0);
    assert.equal(heroB.tile_x, 3);
    assert.equal(heroB.tile_y, 2);

    const pngA = renderA.payload.render.png_buffer;
    const pngB = renderB.payload.render.png_buffer;
    assert.equal(Buffer.isBuffer(pngA), true);
    assert.equal(Buffer.isBuffer(pngB), true);
    assert.equal(pngA[0], 137);
    assert.equal(pngA[1], 80);
    assert.equal(pngA[2], 78);
    assert.equal(pngA[3], 71);
  }, results);

  const passed = results.filter((row) => row.ok).length;
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
  const summary = runCombatRenderIntegrationTests();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runCombatRenderIntegrationTests
};

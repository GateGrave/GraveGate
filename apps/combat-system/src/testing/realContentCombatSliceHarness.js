"use strict";

const { createInMemoryAdapter } = require("../../../database/src/adapters/inMemoryAdapter");
const { loadStarterContentBundle } = require("../../../world-system/src/content");
const { CharacterPersistenceBridge } = require("../../../world-system/src/character/character.persistence");
const { InventoryPersistenceBridge } = require("../../../inventory-system/src/inventory.persistence");
const { createCharacterRecord } = require("../../../world-system/src/character/character.schema");
const { createInventoryRecord } = require("../../../inventory-system/src/inventory.schema");
const { applyCharacterSelections } = require("../../../world-system/src/character/flow/applyCharacterSelections");
const { processEquipRequest } = require("../../../world-system/src/character/flow/processEquipmentRequest");
const { toCombatParticipant } = require("../../../world-system/src/character/adapters/toCombatParticipant");
const { CombatManager } = require("../core/combatManager");
const { startCombat } = require("../flow/startCombat");
const { performAttackAction } = require("../actions/attackAction");
const { CombatPersistenceBridge } = require("../combat.persistence");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function success(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {},
    error: null
  };
}

function failure(eventType, message, payload) {
  return {
    ok: false,
    event_type: eventType,
    payload: payload || {},
    error: message
  };
}

function parseDamageDiceToFlat(diceText, fallback) {
  const safeFallback = Number.isFinite(fallback) ? fallback : 4;
  const safe = String(diceText || "").trim().toLowerCase();
  const match = safe.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    return safeFallback;
  }

  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(count) || !Number.isFinite(sides)) {
    return safeFallback;
  }

  // Deterministic average-ish scaffolding value.
  const averagePerDie = Math.ceil(sides / 2);
  return Math.max(1, count * averagePerDie + bonus);
}

function buildCombatReadyCharacter(character) {
  const safe = character && typeof character === "object" ? character : null;
  if (!safe) {
    return failure("real_content_combat_slice_failed", "character is required for combat readiness");
  }

  const profiles = safe.equipped_item_profiles && typeof safe.equipped_item_profiles === "object"
    ? safe.equipped_item_profiles
    : null;
  if (!profiles) {
    return failure("real_content_combat_slice_failed", "missing equipped_item_profiles for combat readiness");
  }
  if (!profiles.main_hand || typeof profiles.main_hand !== "object") {
    return failure("real_content_combat_slice_failed", "missing equipped main_hand weapon metadata");
  }

  return success("real_content_character_ready", {
    character: safe
  });
}

function runRealContentCombatSliceHarness(input) {
  const data = input || {};
  const playerId = data.player_id || "player-real-content-combat-001";
  const characterId = data.character_id || "char-real-content-combat-001";
  const inventoryId = data.inventory_id || "inv-real-content-combat-001";
  const combatId = data.combat_id || "combat-real-content-slice-001";
  const log = [];

  const contentOut = loadStarterContentBundle();
  log.push({ step: "load_content", result: clone(contentOut) });
  if (!contentOut.ok) {
    return failure("real_content_combat_slice_failed", contentOut.error || "failed to load content", { log });
  }

  const content = contentOut.payload.content;
  const raceId = data.race_id || "human";
  const classId = data.class_id || "fighter";
  const weaponItem = content.items.find((item) => item.item_id === "item_longsword");
  const armorItem = content.items.find((item) => item.item_id === "item_chain_mail");
  const shieldItem = content.items.find((item) => item.item_id === "item_shield");
  const monster =
    content.monsters.find((entry) => entry.monster_id === "monster_goblin_scout") ||
    content.monsters[0];

  if (!weaponItem || !armorItem || !shieldItem || !monster) {
    return failure("real_content_combat_slice_failed", "missing starter weapon/armor/shield/monster content", { log });
  }

  const adapter = createInMemoryAdapter();
  const characterPersistence = new CharacterPersistenceBridge({ adapter });
  const inventoryPersistence = new InventoryPersistenceBridge({ adapter });
  const combatPersistence = new CombatPersistenceBridge({ adapter });
  const combatManager = new CombatManager();

  const baseCharacter = createCharacterRecord({
    character_id: characterId,
    player_id: playerId,
    account_id: "acct-real-content-001",
    name: "Real Slice Fighter",
    inventory_id: inventoryId,
    level: 1,
    armor_class: 10,
    current_hitpoints: 18,
    hitpoint_max: 18
  });

  const selectionOut = applyCharacterSelections({
    character: baseCharacter,
    race_id: raceId,
    class_id: classId
  });
  log.push({ step: "apply_selections", result: clone(selectionOut) });
  if (!selectionOut.ok) {
    return failure("real_content_combat_slice_failed", selectionOut.error || "failed to apply character selections", { log });
  }

  const savedCharacter = characterPersistence.saveCharacter(selectionOut.payload.character_profile);
  if (!savedCharacter.ok) {
    return failure("real_content_combat_slice_failed", savedCharacter.error || "failed to save character", { log });
  }

  const seededInventory = createInventoryRecord({
    inventory_id: inventoryId,
    owner_type: "player",
    owner_id: playerId,
    equipment_items: [
      {
        item_id: weaponItem.item_id,
        item_name: weaponItem.name,
        quantity: 1,
        owner_player_id: playerId,
        metadata: clone(weaponItem.metadata || {})
      },
      {
        item_id: armorItem.item_id,
        item_name: armorItem.name,
        quantity: 1,
        owner_player_id: playerId,
        metadata: clone(armorItem.metadata || {})
      },
      {
        item_id: shieldItem.item_id,
        item_name: shieldItem.name,
        quantity: 1,
        owner_player_id: playerId,
        metadata: clone(shieldItem.metadata || {})
      }
    ]
  });
  const savedInventory = inventoryPersistence.saveInventory(seededInventory);
  if (!savedInventory.ok) {
    return failure("real_content_combat_slice_failed", savedInventory.error || "failed to seed inventory", { log });
  }

  const equipContext = {
    characterPersistence,
    inventoryPersistence
  };
  const equipWeapon = processEquipRequest({
    context: equipContext,
    player_id: playerId,
    item_id: weaponItem.item_id,
    slot: "main_hand"
  });
  const equipArmor = processEquipRequest({
    context: equipContext,
    player_id: playerId,
    item_id: armorItem.item_id,
    slot: "body"
  });
  const equipShield = processEquipRequest({
    context: equipContext,
    player_id: playerId,
    item_id: shieldItem.item_id,
    slot: "off_hand"
  });
  log.push({ step: "equip_weapon", result: clone(equipWeapon) });
  log.push({ step: "equip_armor", result: clone(equipArmor) });
  log.push({ step: "equip_shield", result: clone(equipShield) });
  if (!equipWeapon.ok || !equipArmor.ok || !equipShield.ok) {
    return failure("real_content_combat_slice_failed", "failed to equip starter gear", { log });
  }

  const loadedCharacter = characterPersistence.loadCharacterById(characterId);
  if (!loadedCharacter.ok) {
    return failure("real_content_combat_slice_failed", loadedCharacter.error || "failed to reload character", { log });
  }

  const readiness = buildCombatReadyCharacter(loadedCharacter.payload.character);
  log.push({ step: "build_combat_ready_character", result: clone(readiness) });
  if (!readiness.ok) {
    return readiness;
  }

  const weaponProfile = readiness.payload.character.equipped_item_profiles.main_hand;
  const armorProfile = readiness.payload.character.equipped_item_profiles.body || null;
  const shieldProfile = readiness.payload.character.equipped_item_profiles.off_hand || null;

  const attackDamage = parseDamageDiceToFlat(
    weaponProfile && weaponProfile.weapon ? weaponProfile.weapon.damage_dice : null,
    5
  );
  const armorBase = armorProfile && armorProfile.armor ? Number(armorProfile.armor.base_ac) : 10;
  const shieldBonus = shieldProfile ? Number(shieldProfile.shield_bonus || 0) : 0;
  const derivedArmorClass = Math.max(10, Number.isFinite(armorBase) ? armorBase : 10) + (Number.isFinite(shieldBonus) ? shieldBonus : 0);

  const participantOut = toCombatParticipant({
    character: {
      ...readiness.payload.character,
      armor_class: derivedArmorClass
    },
    team: "heroes",
    attack_bonus: 5,
    damage: attackDamage,
    position: { x: 0, y: 0 }
  });
  log.push({ step: "to_combat_participant", result: clone(participantOut) });
  if (!participantOut.ok) {
    return failure("real_content_combat_slice_failed", participantOut.error || "failed to build combat participant", { log });
  }

  const createdCombat = combatManager.createCombat({
    combat_id: combatId,
    status: "pending"
  });
  if (!createdCombat.ok) {
    return failure("real_content_combat_slice_failed", createdCombat.error || "failed to create combat", { log });
  }

  const addHero = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      ...participantOut.payload.participant,
      participant_id: characterId
    }
  });
  const addMonster = combatManager.addParticipant({
    combat_id: combatId,
    participant: {
      participant_id: monster.monster_id,
      name: monster.name,
      team: "monsters",
      armor_class: monster.armor_class,
      current_hp: monster.max_hp,
      max_hp: monster.max_hp,
      attack_bonus: monster.attack_bonus,
      damage: monster.damage,
      position: { x: 1, y: 0 },
      monster_profile: clone(monster.metadata || {})
    }
  });
  log.push({ step: "add_hero", result: clone(addHero) });
  log.push({ step: "add_monster", result: clone(addMonster) });
  if (!addHero.ok || !addMonster.ok) {
    return failure("real_content_combat_slice_failed", "failed to add combat participants", { log });
  }

  const started = startCombat({
    combatManager,
    combat_id: combatId,
    roll_function(participant) {
      return participant.participant_id === characterId ? 18 : 10;
    }
  });
  if (!started.ok) {
    return failure("real_content_combat_slice_failed", started.error || "failed to start combat", { log });
  }

  const attack = performAttackAction({
    combatManager,
    combat_id: combatId,
    attacker_id: characterId,
    target_id: monster.monster_id,
    attack_roll_fn: () => 17,
    damage_roll_fn: () => attackDamage
  });
  log.push({ step: "attack", result: clone(attack) });
  if (!attack.ok) {
    return failure("real_content_combat_slice_failed", attack.error || "attack failed", { log });
  }

  const savedSnapshot = combatPersistence.saveCombatSnapshot({
    combat_state: attack.payload.combat
  });
  log.push({ step: "save_snapshot", result: clone(savedSnapshot) });
  if (!savedSnapshot.ok) {
    return failure("real_content_combat_slice_failed", savedSnapshot.error || "failed to save combat snapshot", { log });
  }

  const loadedSnapshot = combatPersistence.loadCombatSnapshotById(savedSnapshot.payload.snapshot.snapshot_id);
  log.push({ step: "load_snapshot", result: clone(loadedSnapshot) });
  if (!loadedSnapshot.ok) {
    return failure("real_content_combat_slice_failed", loadedSnapshot.error || "failed to load combat snapshot", { log });
  }

  return success("real_content_combat_slice_completed", {
    combat_id: combatId,
    character_id: characterId,
    monster_id: monster.monster_id,
    attack: {
      hit: attack.payload.hit,
      damage_dealt: attack.payload.damage_dealt,
      target_hp_after: attack.payload.target_hp_after
    },
    readiness: {
      weapon_profile: weaponProfile,
      armor_profile: armorProfile,
      shield_profile: shieldProfile,
      derived_armor_class: derivedArmorClass
    },
    persisted_snapshot_id: loadedSnapshot.payload.snapshot.snapshot_id,
    log
  });
}

module.exports = {
  runRealContentCombatSliceHarness,
  buildCombatReadyCharacter
};


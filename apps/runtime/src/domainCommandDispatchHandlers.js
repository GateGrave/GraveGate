"use strict";

const { createEvent, EVENT_TYPES } = require("../../../packages/shared-types");
const { bootstrapPlayerStart } = require("../../world-system/src/character/flow/bootstrapPlayerStart");
const {
  processEquipRequest,
  processUnequipRequest
} = require("../../world-system/src/character/flow/processEquipmentRequest");
const { processWorldUseItemEvent } = require("../../world-system/src/flow/processWorldUseItemEvent");
const { processAdminActionRequest } = require("../../world-system/src/admin/processAdminActionRequest");
const {
  processEnterDungeonRequest,
  processLeaveSessionRequest
} = require("../../dungeon-exploration/src/flow/processSessionLifecycleRequest");
const {
  processSessionMoveRequest,
  processSessionInteractRequest
} = require("../../dungeon-exploration/src/flow/processActiveSessionAction");
const { prepareRewardHook } = require("../../dungeon-exploration/src/flow/prepareRewardHook");
const { consumeRewardHook } = require("../../world-system/src/loot/flow/consumeRewardHook");
const { rollLoot } = require("../../world-system/src/loot/flow/rollLoot");
const { grantLootToInventory } = require("../../world-system/src/loot/flow/grantLootToInventory");
const {
  processCombatAttackRequest,
  processCombatCastSpellRequest,
  processCombatMoveRequest,
  processCombatUseItemRequest
} = require("../../combat-system/src/flow/processCombatActionRequest");

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

function createGatewayResponseEvent(sourceEvent, responseType, data, ok, errorMessage, sourceSystem) {
  return createEvent(EVENT_TYPES.GATEWAY_RESPONSE_READY, {
    response_type: responseType,
    ok: ok !== false,
    data: data || {},
    error: errorMessage || null,
    request_event_type: sourceEvent.event_type,
    request_event_id: sourceEvent.event_id || null
  }, {
    source: sourceSystem || "runtime",
    target_system: "gateway",
    player_id: sourceEvent.player_id || null,
    session_id: sourceEvent.session_id || null,
    combat_id: sourceEvent.combat_id || null
  });
}

function createInventoryService(inventoryPersistence) {
  return {
    getInventory(inventoryId) {
      return inventoryPersistence.loadInventoryById(inventoryId);
    },
    saveInventory(inventory) {
      return inventoryPersistence.saveInventory(inventory);
    }
  };
}

function resolvePlayerCharacter(context, playerId) {
  const characterPersistence = context && context.characterPersistence;
  if (!characterPersistence || typeof characterPersistence.listCharacters !== "function") {
    return null;
  }
  const listed = characterPersistence.listCharacters();
  if (!listed.ok) {
    return null;
  }
  const rows = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
  return rows.find((entry) => String(entry.player_id || "") === String(playerId || "")) || null;
}

function resolveLootTableFromContent(context, lootTableId) {
  if (!lootTableId || !context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const tables = Array.isArray(content.loot_tables) ? content.loot_tables : [];
  return tables.find((entry) => String(entry.loot_table_id || "") === String(lootTableId)) || null;
}

function resolveSpellDefinitionFromContent(context, spellId) {
  if (!spellId || !context || typeof context.loadContentBundle !== "function") {
    return null;
  }
  const loaded = context.loadContentBundle();
  if (!loaded || loaded.ok !== true) {
    return null;
  }
  const content = loaded.payload && loaded.payload.content ? loaded.payload.content : {};
  const spells = Array.isArray(content.spells) ? content.spells : [];
  return spells.find((entry) => String(entry.spell_id || entry.id || "") === String(spellId || "")) || null;
}

function resolveUtilitySpellForInteraction(context, playerId, spellId) {
  const normalizedSpellId = spellId ? String(spellId).trim().toLowerCase() : "";
  if (!normalizedSpellId) {
    return success("session_interaction_spell_not_requested", {
      spell: null
    });
  }

  const playerCharacter = resolvePlayerCharacter(context, playerId);
  if (!playerCharacter) {
    return failure("session_interaction_spell_failed", "player character not found for utility spell interaction", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const spellbook = playerCharacter.spellbook && typeof playerCharacter.spellbook === "object"
    ? playerCharacter.spellbook
    : {};
  const knownSpellIds = Array.isArray(spellbook.known_spell_ids) ? spellbook.known_spell_ids : [];
  const knowsSpell = knownSpellIds.some((entry) => String(entry || "").trim().toLowerCase() === normalizedSpellId);
  if (!knowsSpell) {
    return failure("session_interaction_spell_failed", "spell is not known by character", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const spell = resolveSpellDefinitionFromContent(context, normalizedSpellId);
  if (!spell) {
    return failure("session_interaction_spell_failed", "spell data not found", {
      player_id: String(playerId || ""),
      spell_id: normalizedSpellId
    });
  }

  const utilityRef = spell.effect && spell.effect.utility_ref ? String(spell.effect.utility_ref).trim() : "";
  if (!utilityRef) {
    return failure("session_interaction_spell_failed", "spell is not a supported utility interaction spell", {
      spell_id: normalizedSpellId
    });
  }

  return success("session_interaction_spell_resolved", {
    spell: clone(spell)
  });
}

function resolveChestRewardForInteraction(context, requestEvent, interactionOut) {
  const rewardHint =
    interactionOut &&
    interactionOut.payload &&
    interactionOut.payload.reward_hint &&
    typeof interactionOut.payload.reward_hint === "object"
      ? interactionOut.payload.reward_hint
      : null;
  if (!rewardHint || String(rewardHint.reward_context || "") !== "chest_opened") {
    return success("session_interaction_reward_not_applicable", {
      reward_status: "none"
    });
  }

  const inlineLootTable = rewardHint.loot_table && typeof rewardHint.loot_table === "object"
    ? rewardHint.loot_table
    : null;
  const lootTableId = rewardHint.loot_table_id ? String(rewardHint.loot_table_id) : null;
  const resolvedLootTable = inlineLootTable || resolveLootTableFromContent(context, lootTableId);
  if (!resolvedLootTable) {
    return success("session_interaction_reward_not_configured", {
      reward_status: "none",
      loot_table_id: lootTableId || null
    });
  }

  const prepared = prepareRewardHook({
    manager: context.sessionManager,
    sessionPersistence: context.sessionPersistence || null,
    session_id: interactionOut.payload.session_id,
    reward_context: "chest_opened",
    source_override: {
      source_type: "chest",
      source_id: interactionOut.payload.object_id
    },
    reward_key_suffix: interactionOut.payload.object_id
  });
  if (!prepared.ok) {
    return failure("session_interaction_reward_failed", prepared.error || "failed to prepare chest reward");
  }

  const rewardPayload = {
    ...(prepared.payload.reward_event && prepared.payload.reward_event.payload
      ? prepared.payload.reward_event.payload
      : {}),
    target_player_id: requestEvent.player_id,
    loot_table_id: resolvedLootTable.loot_table_id || lootTableId || null,
    metadata: {
      reward_update:
        rewardHint.reward_update && typeof rewardHint.reward_update === "object"
          ? clone(rewardHint.reward_update)
          : {}
    }
  };

  const consumed = consumeRewardHook({
    reward_hook: rewardPayload,
    loot_table: resolvedLootTable
  });
  if (!consumed.ok) {
    return failure("session_interaction_reward_failed", consumed.error || "failed to consume chest reward hook");
  }

  const rollInput = consumed.payload.next_step && consumed.payload.next_step.roll_input
    ? consumed.payload.next_step.roll_input
    : null;
  const rolled = rollInput ? rollLoot(rollInput) : failure("loot_roll_failed", "reward hook did not produce roll input");
  if (!rolled.ok) {
    return failure("session_interaction_reward_failed", rolled.error || "failed to roll chest loot");
  }

  const playerCharacter = resolvePlayerCharacter(context, requestEvent.player_id);
  const inventoryService = context.inventoryPersistence ? createInventoryService(context.inventoryPersistence) : null;
  if (!inventoryService || !playerCharacter || !playerCharacter.inventory_id) {
    return failure("session_interaction_reward_failed", "player inventory is not available for chest reward");
  }

  const granted = grantLootToInventory({
    loot_bundle: rolled.payload.loot_bundle,
    inventory_service: inventoryService,
    inventory_id: playerCharacter.inventory_id,
    owner_id: requestEvent.player_id,
    owner_player_id: requestEvent.player_id,
    character_id: playerCharacter.character_id,
    characterPersistence: context.characterPersistence
  });
  if (!granted.ok) {
    return failure("session_interaction_reward_failed", granted.error || "failed to grant chest reward");
  }

  return success("session_interaction_reward_granted", {
    reward_status: "granted",
    loot_table_id: resolvedLootTable.loot_table_id || lootTableId || null,
    reward_context: "chest_opened",
    loot_entries: rolled.payload.loot_bundle && Array.isArray(rolled.payload.loot_bundle.entries)
      ? clone(rolled.payload.loot_bundle.entries)
      : [],
    inventory: granted.payload && granted.payload.inventory ? clone(granted.payload.inventory) : null
  });
}

function getRequestEvent(event) {
  return event && event.payload && event.payload.request_event ? event.payload.request_event : null;
}

function resolveMutationReplayKey(requestEvent) {
  const payload = requestEvent && requestEvent.payload && typeof requestEvent.payload === "object"
    ? requestEvent.payload
    : null;
  if (!payload) {
    return null;
  }
  const requestId = payload.request_id || payload.action_id || payload.idempotency_key || null;
  if (!requestId) {
    return null;
  }
  const normalized = String(requestId).trim();
  if (!normalized) {
    return null;
  }
  return [
    String(requestEvent.player_id || ""),
    String(requestEvent.event_type || ""),
    normalized
  ].join(":");
}

function rejectDuplicateMutationIfNeeded(requestEvent, context, responseType, sourceSystem) {
  const replayStore = context && context.mutationReplayStore;
  const replayKey = resolveMutationReplayKey(requestEvent);
  if (!replayKey || !replayStore || typeof replayStore.has !== "function" || typeof replayStore.add !== "function") {
    return null;
  }
  if (replayStore.has(replayKey)) {
    return createGatewayResponseEvent(
      requestEvent,
      responseType,
      {},
      false,
      "duplicate mutation request",
      sourceSystem
    );
  }
  return {
    replayKey
  };
}

function markMutationReplaySuccess(context, replayState, succeeded) {
  if (!succeeded || !replayState || !replayState.replayKey) {
    return;
  }
  const replayStore = context && context.mutationReplayStore;
  if (replayStore && typeof replayStore.add === "function") {
    replayStore.add(replayState.replayKey);
  }
}

function summarizeCombatProgression(outPayload) {
  const progression = outPayload && outPayload.progression && typeof outPayload.progression === "object"
    ? outPayload.progression
    : {};
  const combat = progression.combat && typeof progression.combat === "object"
    ? progression.combat
    : (outPayload && outPayload.attack && outPayload.attack.combat) ||
      (outPayload && outPayload.cast_spell && outPayload.cast_spell.combat) ||
      (outPayload && outPayload.move && outPayload.move.combat) ||
      (outPayload && outPayload.use_item && outPayload.use_item.combat) ||
      null;
  const aiTurns = Array.isArray(progression.ai_turns) ? progression.ai_turns : [];
  const activeParticipantId =
    progression.active_participant_id ||
    (combat && Array.isArray(combat.initiative_order) && Number.isFinite(combat.turn_index)
      ? combat.initiative_order[combat.turn_index]
      : null);
  let winnerTeam = null;
  if (combat && Array.isArray(combat.event_log)) {
    for (let index = combat.event_log.length - 1; index >= 0; index -= 1) {
      const entry = combat.event_log[index];
      if (entry && entry.event_type === "combat_completed" && entry.details && entry.details.winner_team) {
        winnerTeam = entry.details.winner_team;
        break;
      }
    }
  }
  return {
    progression,
    combat,
    ai_turns: aiTurns,
    ai_turn_count: aiTurns.length,
    active_participant_id: activeParticipantId || null,
    combat_completed: progression.combat_completed === true || (combat && String(combat.status || "") === "complete"),
    winner_team: winnerTeam
  };
}

function loadCharactersForProfile(context) {
  if (context.characterPersistence && typeof context.characterPersistence.listCharacters === "function") {
    const listed = context.characterPersistence.listCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through persistence bridge" };
    }

    const persistenceCharacters = Array.isArray(listed.payload.characters) ? listed.payload.characters : [];
    if (persistenceCharacters.length > 0) {
      return {
        ok: true,
        characters: persistenceCharacters
      };
    }
  }

  if (context.characterRepository && typeof context.characterRepository.listStoredCharacters === "function") {
    const listed = context.characterRepository.listStoredCharacters();
    if (!listed.ok) {
      return { ok: false, error: listed.error || "failed to list characters through repository" };
    }
    return {
      ok: true,
      characters: listed.payload.characters || []
    };
  }

  return { ok: false, error: "character persistence/repository is not available in runtime context" };
}

function handleWorldCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "world", {}, false, "runtime world dispatch missing request_event", "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_START_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "start", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const bootstrap = bootstrapPlayerStart({
      player_id: requestEvent.player_id,
      requested_character_name: requestEvent.payload && requestEvent.payload.requested_character_name,
      race_id: requestEvent.payload && requestEvent.payload.race_id,
      race_option_id: requestEvent.payload && requestEvent.payload.race_option_id,
      class_id: requestEvent.payload && requestEvent.payload.class_id,
      class_option_id: requestEvent.payload && requestEvent.payload.class_option_id,
      secondary_class_id: requestEvent.payload && requestEvent.payload.secondary_class_id,
      secondary_class_option_id: requestEvent.payload && requestEvent.payload.secondary_class_option_id,
      stats: requestEvent.payload && requestEvent.payload.stats,
      context
    });
    if (!bootstrap.ok) {
      return [createGatewayResponseEvent(requestEvent, "start", {}, false, bootstrap.error || "start bootstrap failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const character = bootstrap.payload.character || {};
    const inventory = bootstrap.payload.inventory || {};
    return [createGatewayResponseEvent(requestEvent, "start", {
      bootstrap_status: bootstrap.payload.bootstrap_status || "created",
      character_created: Boolean(bootstrap.payload.character_created),
      inventory_created: Boolean(bootstrap.payload.inventory_created),
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        name: character.name || null,
        level: character.level || 1,
        race: character.race || null,
        class: character.class || null,
        race_id: character.race_id || null,
        class_id: character.class_id || null,
        secondary_class_id:
          character.gestalt_progression && character.gestalt_progression.track_b_class_key
            ? character.gestalt_progression.track_b_class_key
            : null,
        class_option_id: character.class_option_id || null,
        secondary_class_option_id:
          character.gestalt_progression && character.gestalt_progression.track_b_option_id
            ? character.gestalt_progression.track_b_option_id
            : null,
        base_stats: character.base_stats || null,
        stats: character.stats || {},
        metadata: character.metadata || {},
        inventory_id: character.inventory_id || null
      },
      point_buy_summary: bootstrap.payload.point_buy_summary || null,
      inventory: {
        inventory_id: inventory.inventory_id || null,
        owner_id: inventory.owner_id || null
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_EQUIP_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "equip", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processEquipRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      slot: requestEvent.payload && requestEvent.payload.slot
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "equip", {}, false, out.error || "equip request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const equipped = out.payload.equipped || {};
    const character = out.payload.character || {};
    return [createGatewayResponseEvent(requestEvent, "equip", {
      equipped: {
        item_id: equipped.item_id || null,
        slot: equipped.slot || null
      },
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        equipment: character.equipment || {}
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_UNEQUIP_REQUESTED) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "unequip", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processUnequipRequest({
      context,
      player_id: requestEvent.player_id,
      item_id: requestEvent.payload && requestEvent.payload.item_id,
      slot: requestEvent.payload && requestEvent.payload.slot
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "unequip", {}, false, out.error || "unequip request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const unequipped = out.payload.unequipped || {};
    const character = out.payload.character || {};
    return [createGatewayResponseEvent(requestEvent, "unequip", {
      unequipped: {
        item_id: unequipped.item_id || null,
        slot: unequipped.slot || null
      },
      character: {
        character_id: character.character_id || null,
        player_id: character.player_id || null,
        equipment: character.equipment || {}
      }
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "use", "world_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const worldUseItemEventProcessor =
      typeof context.worldUseItemEventProcessor === "function"
        ? context.worldUseItemEventProcessor
        : processWorldUseItemEvent;

    const out = worldUseItemEventProcessor({
      event: requestEvent,
      context
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "use", {}, false, out.error || "item use request failed", "world_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const responseData = out.payload && out.payload.response_data ? out.payload.response_data : {};
    return [createGatewayResponseEvent(requestEvent, "use", {
      use_status: responseData.use_status || "consumed",
      item_id: responseData.item_id || (requestEvent.payload && requestEvent.payload.item_id) || null,
      inventory_id: responseData.inventory_id || null
    }, true, null, "world_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ADMIN_REQUESTED) {
    const out = processAdminActionRequest({
      event: requestEvent,
      context
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "admin", {}, false, out.error || "admin action failed", "world_system")];
    }

    return [createGatewayResponseEvent(requestEvent, "admin", {
      admin_event_type: out.event_type,
      result: out.payload || {}
    }, true, null, "world_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "world", {}, false, "unsupported world command dispatch", "world_system")];
}

function handleSessionCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "session", {}, false, "runtime session dispatch missing request_event", "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_MOVE) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "move", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processSessionMoveRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: requestEvent.session_id || (requestEvent.payload && requestEvent.payload.session_id) || null,
      payload: requestEvent.payload || {}
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "move",
        {},
        false,
        out.error || "session move request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    return [createGatewayResponseEvent(requestEvent, "move", {
      move_status: "completed",
      session_id: out.payload.session && out.payload.session.session_id ? out.payload.session.session_id : null,
      from_room_id: out.payload.from_room_id || null,
      to_room_id: out.payload.to_room_id || null,
      trap_trigger: out.payload.trap_trigger || null
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ENTER_DUNGEON) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "dungeon_enter", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processEnterDungeonRequest({
      context,
      player_id: requestEvent.player_id,
      dungeon_id: requestEvent.payload && requestEvent.payload.dungeon_id,
      party_id: requestEvent.payload && requestEvent.payload.party_id,
      session_id: requestEvent.session_id
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "dungeon_enter",
        {},
        false,
        out.error || "dungeon enter request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    const session = out.payload.session || {};
    return [createGatewayResponseEvent(requestEvent, "dungeon_enter", {
      enter_status: out.payload.enter_status || "created",
      created: Boolean(out.payload.created),
      session: {
        session_id: session.session_id || null,
        status: session.status || null,
        dungeon_id: session.dungeon_id || null,
        leader_id: session.party && session.party.leader_id ? session.party.leader_id : null,
        party_id: session.party && session.party.party_id ? session.party.party_id : null
      }
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_LEAVE_SESSION) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "leave_session", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processLeaveSessionRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: (requestEvent.payload && requestEvent.payload.session_id) || requestEvent.session_id || null
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "leave_session",
        {},
        false,
        out.error || "leave session request failed",
        "session_system"
      )];
    }
    markMutationReplaySuccess(context, replayState, true);

    const session = out.payload.session || {};
    return [createGatewayResponseEvent(requestEvent, "leave_session", {
      leave_status: out.payload.leave_status || "left",
      session_id: out.payload.session_id || null,
      deleted: Boolean(out.payload.deleted),
      previous_session_state: {
        status: session.status || null,
        dungeon_id: session.dungeon_id || null
      }
    }, true, null, "session_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_INTERACT_OBJECT) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "interact", "session_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const utilitySpell = resolveUtilitySpellForInteraction(
      context,
      requestEvent.player_id,
      requestEvent.payload && requestEvent.payload.spell_id
    );
    if (!utilitySpell.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        utilitySpell.error || "failed to resolve utility spell interaction",
        "session_system"
      )];
    }
    const out = processSessionInteractRequest({
      context,
      player_id: requestEvent.player_id,
      session_id: requestEvent.session_id || (requestEvent.payload && requestEvent.payload.session_id) || null,
      payload: Object.assign({}, requestEvent.payload || {}, {
        spell: utilitySpell.payload && utilitySpell.payload.spell ? utilitySpell.payload.spell : null
      })
    });

    if (!out.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        out.error || "session interact request failed",
        "session_system"
      )];
    }

    const rewardOut = resolveChestRewardForInteraction(context, requestEvent, out);
    if (!rewardOut.ok) {
      return [createGatewayResponseEvent(
        requestEvent,
        "interact",
        {},
        false,
        rewardOut.error || "session interaction reward failed",
        "session_system"
      )];
    }

    markMutationReplaySuccess(context, replayState, true);

    return [createGatewayResponseEvent(requestEvent, "interact", {
      interact_status: "resolved",
      session_id: out.payload.session_id || null,
      room_id: out.payload.room_id || null,
      object_id: out.payload.object_id || null,
      object_type: out.payload.object_type || null,
      interaction_action: out.payload.interaction_action || null,
      object_state: out.payload.object_state || null,
      spell_effect: out.payload.spell_effect || null,
      reward_status: rewardOut.payload.reward_status || "none",
      loot_entries: Array.isArray(rewardOut.payload.loot_entries) ? clone(rewardOut.payload.loot_entries) : [],
      next_event: out.payload.next_event || null
    }, true, null, "session_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "session", {}, false, "unsupported session command dispatch", "session_system")];
}

function handleCombatCommandDispatch(event, context) {
  const requestEvent = getRequestEvent(event);
  if (!requestEvent) {
    return [createGatewayResponseEvent(event, "combat", {}, false, "runtime combat dispatch missing request_event", "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_ATTACK) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "attack", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatAttackRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "attack", {}, false, out.error || "attack request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const attack = out.payload.attack || {};
    const progress = summarizeCombatProgression(out.payload);
    return [createGatewayResponseEvent(requestEvent, "attack", {
      attack_status: "resolved",
      combat_id: attack.combat_id || requestEvent.combat_id,
      attacker_id: attack.attacker_id || requestEvent.player_id || null,
      target_id: attack.target_id || null,
      hit: Boolean(attack.hit),
      damage_dealt: attack.damage_dealt || 0,
      target_hp_after: attack.target_hp_after,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_CAST_SPELL) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "cast", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatCastSpellRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "cast", {}, false, out.error || "cast request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const castSpell = out.payload.cast_spell || {};
    const progress = summarizeCombatProgression(out.payload);
    return [createGatewayResponseEvent(requestEvent, "cast", {
      cast_status: "resolved",
      combat_id: castSpell.combat_id || requestEvent.combat_id,
      caster_id: castSpell.caster_id || requestEvent.player_id || null,
      target_id: castSpell.target_id || null,
      spell_id: castSpell.spell_id || null,
      spell_name: castSpell.spell_name || null,
      resolution_type: castSpell.resolution_type || null,
      damage_type: castSpell.damage_type || null,
      hit: castSpell.hit === null ? null : Boolean(castSpell.hit),
      saved: castSpell.saved === null ? null : Boolean(castSpell.saved),
      damage_result: castSpell.damage_result || null,
      healing_result: castSpell.healing_result || null,
      defense_result: castSpell.defense_result || null,
      applied_conditions: Array.isArray(castSpell.applied_conditions) ? clone(castSpell.applied_conditions) : [],
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_MOVE) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "move", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatMoveRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "move", {}, false, out.error || "combat move request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const move = out.payload.move || {};
    const reactions = out.payload.reactions && typeof out.payload.reactions === "object" ? out.payload.reactions : {};
    const opportunityAttacks = Array.isArray(reactions.opportunity_attacks) ? reactions.opportunity_attacks : [];
    const progress = summarizeCombatProgression(out.payload);
    return [createGatewayResponseEvent(requestEvent, "move", {
      move_status: "resolved",
      combat_id: move.combat_id || requestEvent.combat_id,
      participant_id: move.participant_id || requestEvent.player_id || null,
      from_position: move.from_position || null,
      to_position: move.to_position || null,
      opportunity_attack_count: opportunityAttacks.length,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  if (requestEvent.event_type === EVENT_TYPES.PLAYER_USE_ITEM) {
    const replayState = rejectDuplicateMutationIfNeeded(requestEvent, context, "use", "combat_system");
    if (replayState && replayState.event_type) {
      return [replayState];
    }
    const out = processCombatUseItemRequest({
      context,
      player_id: requestEvent.player_id,
      combat_id: requestEvent.combat_id,
      payload: requestEvent.payload || {}
    });
    if (!out.ok) {
      return [createGatewayResponseEvent(requestEvent, "use", {}, false, out.error || "combat item use request failed", "combat_system")];
    }
    markMutationReplaySuccess(context, replayState, true);

    const useItem = out.payload.use_item || {};
    const progress = summarizeCombatProgression(out.payload);
    return [createGatewayResponseEvent(requestEvent, "use", {
      use_status: "resolved",
      combat_id: useItem.combat_id || requestEvent.combat_id,
      participant_id: useItem.participant_id || requestEvent.player_id || null,
      item_id: useItem.item_id || (requestEvent.payload && requestEvent.payload.item_id) || null,
      hp_before: useItem.hp_before,
      hp_after: useItem.hp_after,
      healed_for: useItem.healed_for,
      active_participant_id: progress.active_participant_id,
      combat_completed: progress.combat_completed,
      winner_team: progress.winner_team,
      ai_turn_count: progress.ai_turn_count,
      ai_turns: clone(progress.ai_turns)
    }, true, null, "combat_system")];
  }

  return [createGatewayResponseEvent(requestEvent, "combat", {}, false, "unsupported combat command dispatch", "combat_system")];
}

function handleWorldReadRequest(event, context) {
  if (event.event_type === EVENT_TYPES.PLAYER_PROFILE_REQUESTED) {
    const loadedCharacters = loadCharactersForProfile(context);
    if (!loadedCharacters.ok) {
      return [createGatewayResponseEvent(event, "profile", {}, false, loadedCharacters.error, "world_system")];
    }

    const playerId = event.player_id;
    const characters = loadedCharacters.characters;
    const found = characters.find((character) => String(character.player_id || "") === String(playerId || ""));

    if (!found) {
      return [
        createGatewayResponseEvent(event, "profile", {
          profile_found: false
        }, true, null, "world_system")
      ];
    }

    return [
      createGatewayResponseEvent(event, "profile", {
        profile_found: true,
        character: {
          character_id: found.character_id || null,
          player_id: found.player_id || null,
          name: found.name || null,
          race: found.race || null,
          class: found.class || null,
          race_id: found.race_id || null,
          class_id: found.class_id || null,
          secondary_class_id:
            found.gestalt_progression && found.gestalt_progression.track_b_class_key
              ? found.gestalt_progression.track_b_class_key
              : null,
          class_option_id: found.class_option_id || null,
          secondary_class_option_id:
            found.gestalt_progression && found.gestalt_progression.track_b_option_id
              ? found.gestalt_progression.track_b_option_id
              : null,
          level: found.level || 1,
          xp: Number.isFinite(Number(found.xp)) ? Number(found.xp) : 0,
          inventory_id: found.inventory_id || null,
          base_stats: found.base_stats || null,
          stats: found.stats || {}
        }
      }, true, null, "world_system")
    ];
  }

  if (event.event_type === EVENT_TYPES.PLAYER_INVENTORY_REQUESTED) {
    const inventoryPersistence = context.inventoryPersistence;
    if (!inventoryPersistence || typeof inventoryPersistence.listInventories !== "function") {
      return [
        createGatewayResponseEvent(
          event,
          "inventory",
          {},
          false,
          "inventoryPersistence is not available in runtime context",
          "world_system"
        )
      ];
    }

    const listed = inventoryPersistence.listInventories();
    if (!listed.ok) {
      return [createGatewayResponseEvent(event, "inventory", {}, false, listed.error || "failed to list inventories", "world_system")];
    }

    const playerId = event.player_id;
    const inventories = Array.isArray(listed.payload.inventories) ? listed.payload.inventories : [];
    const found = inventories.find((inventory) => String(inventory.owner_id || "") === String(playerId || ""));

    if (!found) {
      return [
        createGatewayResponseEvent(event, "inventory", {
          inventory_found: false
        }, true, null, "world_system")
      ];
    }

    return [
      createGatewayResponseEvent(event, "inventory", {
        inventory_found: true,
        inventory: {
          inventory_id: found.inventory_id || null,
          owner_id: found.owner_id || null,
          currency: found.currency || {},
          stackable_count: Array.isArray(found.stackable_items) ? found.stackable_items.length : 0,
          equipment_count: Array.isArray(found.equipment_items) ? found.equipment_items.length : 0,
          quest_count: Array.isArray(found.quest_items) ? found.quest_items.length : 0
        }
      }, true, null, "world_system")
    ];
  }

  return [];
}

module.exports = {
  handleWorldCommandDispatch,
  handleSessionCommandDispatch,
  handleCombatCommandDispatch,
  handleWorldReadRequest
};



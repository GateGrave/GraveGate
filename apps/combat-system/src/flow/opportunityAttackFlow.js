"use strict";

const { resolveAttackAgainstCombatState } = require("../actions/attackAction");
const { performCastSpellAction } = require("../actions/castSpellAction");
const { participantHasCondition, getActiveConditionsForParticipant } = require("../conditions/conditionHelpers");
const { canParticipantReact, consumeReaction } = require("../reactions/reactionState");

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

function normalizePosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y)
  };
}

function findParticipantById(participants, participantId) {
  const list = Array.isArray(participants) ? participants : [];
  return list.find((participant) => String(participant && participant.participant_id || "") === String(participantId || "")) || null;
}

function participantHasFeatFlag(participant, flagKey) {
  const key = String(flagKey || "").trim();
  if (!key || !participant || typeof participant !== "object") {
    return false;
  }
  const featFlags = participant.feat_flags && typeof participant.feat_flags === "object"
    ? participant.feat_flags
    : participant.metadata && participant.metadata.feat_flags && typeof participant.metadata.feat_flags === "object"
      ? participant.metadata.feat_flags
      : {};
  return featFlags[key] === true;
}

function loadSpellDefinition(input, spellId) {
  const normalizedSpellId = String(spellId || "").trim().toLowerCase();
  const provider = input && typeof input.load_spell_fn === "function"
    ? input.load_spell_fn
    : null;
  if (!normalizedSpellId || !provider) {
    return null;
  }
  const out = provider(normalizedSpellId);
  return out && out.ok === true && out.payload && out.payload.spell
    ? clone(out.payload.spell)
    : null;
}

function canUseWarCasterSpell(reactor, mover, spell) {
  if (!participantHasFeatFlag(reactor, "war_caster")) {
    return false;
  }
  if (!spell || typeof spell !== "object" || !reactor || !mover) {
    return false;
  }
  const actionCost = String(spell.action_cost || spell.casting_time || "").trim().toLowerCase();
  const normalizedActionCost = actionCost === "1 action" ? "action" : actionCost;
  const targetType = String(spell.target_type || (spell.targeting && spell.targeting.type) || "single_target").trim().toLowerCase();
  return normalizedActionCost === "action" && targetType === "single_target";
}

function resolveWarCasterSelection(input, reactor, mover) {
  const selector = input && typeof input.war_caster_spell_selector === "function"
    ? input.war_caster_spell_selector
    : null;
  if (!selector || !participantHasFeatFlag(reactor, "war_caster")) {
    return null;
  }
  const selection = selector({
    reactor: clone(reactor),
    mover: clone(mover),
    combat: clone(input.combat)
  });
  if (!selection) {
    return null;
  }
  if (typeof selection === "object" && selection.spell && typeof selection.spell === "object") {
    return canUseWarCasterSpell(reactor, mover, selection.spell) ? clone(selection.spell) : null;
  }
  const spell = loadSpellDefinition(input, selection);
  return canUseWarCasterSpell(reactor, mover, spell) ? spell : null;
}

function areAdjacent(a, b) {
  if (!a || !b) {
    return false;
  }
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy === 1;
}

function isLivingParticipant(participant) {
  const hp = Number(participant && participant.current_hp);
  return Number.isFinite(hp) && hp > 0;
}

function moverIsImmuneToReactor(combat, moverId, reactorId) {
  if (participantHasCondition(combat, moverId, "opportunity_attack_immunity")) {
    const conditions = getActiveConditionsForParticipant(combat, moverId)
      .filter((condition) => String(condition && condition.condition_type || "") === "opportunity_attack_immunity");
    if (conditions.length === 0) {
      return true;
    }
    for (let index = 0; index < conditions.length; index += 1) {
      const metadata = conditions[index] && conditions[index].metadata && typeof conditions[index].metadata === "object"
        ? conditions[index].metadata
        : {};
      const blockedReactorId = String(metadata.blocked_reactor_id || "").trim();
      if (!blockedReactorId || blockedReactorId === String(reactorId || "")) {
        return true;
      }
    }
  }
  return false;
}

function resolveOpportunityAttacksForMove(input) {
  const data = input || {};
  const combat = clone(data.combat);
  const moverId = String(data.mover_id || "").trim();
  const fromPosition = normalizePosition(data.from_position);
  const toPosition = normalizePosition(data.to_position);
  const voluntaryMovement = data.voluntary_movement !== false;
  const attackRollFn = typeof data.attack_roll_fn === "function" ? data.attack_roll_fn : null;
  const damageRollFn = typeof data.damage_roll_fn === "function" ? data.damage_roll_fn : null;
  const combatManager = data.combatManager || null;
  const combatId = String(data.combat_id || combat && combat.combat_id || "").trim();

  if (String(combat.status || "") !== "active" || !moverId || !fromPosition || !toPosition || !voluntaryMovement) {
    return success("opportunity_attack_resolution_skipped", {
      combat,
      triggered_attacks: []
    });
  }

  const mover = findParticipantById(combat.participants, moverId);
  if (!mover || !isLivingParticipant(mover)) {
    return success("opportunity_attack_resolution_skipped", {
      combat,
      triggered_attacks: []
    });
  }
  const reactors = [];
  const usedReactors = new Set();
  const participants = Array.isArray(combat.participants) ? combat.participants : [];
  for (let index = 0; index < participants.length; index += 1) {
    const reactor = participants[index];
    if (!reactor || String(reactor.participant_id || "") === moverId) {
      continue;
    }
    if (String(reactor.team || "") === String(mover.team || "")) {
      continue;
    }
    if (!isLivingParticipant(reactor)) {
      continue;
    }
    const reactorPosition = normalizePosition(reactor.position);
    if (!areAdjacent(fromPosition, reactorPosition)) {
      continue;
    }
    if (areAdjacent(toPosition, reactorPosition)) {
      continue;
    }
    const reactorId = String(reactor.participant_id || "");
    if (!reactorId || usedReactors.has(reactorId) || !canParticipantReact(combat, reactorId)) {
      continue;
    }
    if (moverIsImmuneToReactor(combat, moverId, reactorId)) {
      continue;
    }

    usedReactors.add(reactorId);
    const warCasterSpell = resolveWarCasterSelection(data, reactor, mover);
    if (warCasterSpell) {
      if (!combatManager || !combatId) {
        continue;
      }
      const combatForSpell = clone(combat);
      const moverIndexForSpell = Array.isArray(combatForSpell.participants)
        ? combatForSpell.participants.findIndex((entry) => String(entry && entry.participant_id || "") === moverId)
        : -1;
      if (moverIndexForSpell !== -1) {
        combatForSpell.participants[moverIndexForSpell] = Object.assign({}, combatForSpell.participants[moverIndexForSpell], {
          position: clone(fromPosition)
        });
      }
      combatManager.combats.set(combatId, combatForSpell);
      const spellOut = performCastSpellAction({
        combatManager,
        combat_id: combatId,
        caster_id: reactorId,
        target_id: moverId,
        spell: warCasterSpell,
        reaction_mode: true,
        skip_turn_validation: true,
        war_caster_reaction: true,
        damage_rng: data.damage_roll_fn,
        attack_roll_rng: data.attack_roll_fn,
        attack_roll_fn: data.spell_attack_roll_fn,
        saving_throw_fn: data.spell_saving_throw_fn,
        concentration_save_rng: data.concentration_save_rng
      });
      if (!spellOut.ok) {
        combatManager.combats.set(combatId, clone(combat));
        continue;
      }
      const updatedCombat = combatManager.getCombatById(combatId);
      if (!updatedCombat.ok) {
        continue;
      }
      const nextCombat = clone(updatedCombat.payload.combat);
      const movedParticipantIndex = Array.isArray(nextCombat.participants)
        ? nextCombat.participants.findIndex((entry) => String(entry && entry.participant_id || "") === moverId)
        : -1;
      if (movedParticipantIndex !== -1) {
        nextCombat.participants[movedParticipantIndex] = Object.assign({}, nextCombat.participants[movedParticipantIndex], {
          position: clone(toPosition)
        });
      }
      combat.participants = clone(nextCombat.participants);
      combat.conditions = clone(nextCombat.conditions || []);
      combat.event_log = clone(nextCombat.event_log || []);
      combat.updated_at = nextCombat.updated_at;
      const refreshedReactor = findParticipantById(combat.participants, reactorId);
      if (refreshedReactor) {
        refreshedReactor.reaction_available = false;
      }
      reactors.push({
        reactor_participant_id: reactorId,
        target_participant_id: moverId,
        resolution_kind: "spell",
        spell_id: String(warCasterSpell.spell_id || warCasterSpell.id || ""),
        hit: spellOut.payload.hit === null ? true : Boolean(spellOut.payload.hit),
        damage_dealt: Number(
          spellOut.payload.damage_result && spellOut.payload.damage_result.final_damage
            ? spellOut.payload.damage_result.final_damage
            : 0
        )
      });

      const currentMoverAfterSpell = findParticipantById(combat.participants, moverId);
      if (!currentMoverAfterSpell || !isLivingParticipant(currentMoverAfterSpell)) {
        break;
      }
      continue;
    }

    const reactionConsumed = consumeReaction(combat, reactorId);
    if (!reactionConsumed.ok) {
      continue;
    }
    combat.participants = reactionConsumed.next_state.participants;
    combat.event_log = reactionConsumed.next_state.event_log;

    const combatForOpportunityAttack = clone(combat);
    const moverIndexForAttack = Array.isArray(combatForOpportunityAttack.participants)
      ? combatForOpportunityAttack.participants.findIndex((entry) => String(entry && entry.participant_id || "") === moverId)
      : -1;
    if (moverIndexForAttack !== -1) {
      combatForOpportunityAttack.participants[moverIndexForAttack] = Object.assign({}, combatForOpportunityAttack.participants[moverIndexForAttack], {
        position: clone(fromPosition)
      });
    }

    const attackOut = resolveAttackAgainstCombatState({
      combat: combatForOpportunityAttack,
      attacker_id: reactorId,
      target_id: moverId,
      attack_roll_fn: attackRollFn,
      damage_roll_fn: damageRollFn,
      skip_turn_validation: true,
      reaction_mode: true,
      log_event_type: "opportunity_attack"
    });
    if (!attackOut.ok) {
      continue;
    }

    combat.participants = attackOut.payload.combat.participants;
    combat.event_log = attackOut.payload.combat.event_log;
    combat.updated_at = attackOut.payload.combat.updated_at;
    reactors.push({
      reactor_participant_id: reactorId,
      target_participant_id: moverId,
      resolution_kind: "attack",
      hit: Boolean(attackOut.payload.hit),
      damage_dealt: Number(attackOut.payload.damage_dealt || 0)
    });

    const currentMover = findParticipantById(combat.participants, moverId);
    if (!currentMover || !isLivingParticipant(currentMover)) {
      break;
    }
  }

  return success("opportunity_attack_resolution_completed", {
    combat,
    triggered_attacks: reactors
  });
}

module.exports = {
  resolveOpportunityAttacksForMove
};

"use strict";

const { processCombatEventSafe } = require("../processing/process-combat-event-safe");
const { resolveTurnStarted } = require("../resolvers/turn-started.resolver");
const { validateCombatAction } = require("../validation");
const { runReactionEngine } = require("../reactions/reaction-engine");
const { resolveDamagePipeline, applyDamageToCombatState } = require("../damage");
const { resolveConcentrationOnDamage, checkConcentrationExpiry } = require("../concentration");
const { LIFE_STATES, applyDownedState } = require("../death-downed");
const {
  createStatusEffect,
  addEffect,
  processStartOfTurnEffects,
  processEndOfTurnEffects,
  processStatusDurationTick
} = require("../status-effects");
const { advanceToNextTurn } = require("../initiative/initiative-state");
const {
  TURN_TIMEOUT_POLICIES,
  assertValidTurnTimeoutSeconds,
  buildTimeoutAutoAction,
  waitForPlayerActionWithTimeout
} = require("./turn-timeout");
const { CombatSnapshotStore } = require("../snapshots/combat-snapshot-store");

function appendEvents(target, events) {
  if (Array.isArray(events) && events.length > 0) {
    target.push(...events);
  }
}

function addPhaseResult(phaseResults, phaseName, payload) {
  phaseResults.push({
    phase: phaseName,
    ...payload
  });
}

function runDeathCheck(combatState) {
  let state = combatState;
  const emitted = [];
  const downedParticipants = [];

  for (const participant of state.participants) {
    if (Number(participant.current_hp || 0) > 0) {
      continue;
    }

    if (participant.life_state === LIFE_STATES.DEAD || participant.life_state === LIFE_STATES.STABILIZED) {
      continue;
    }

    const downed = applyDownedState(state, participant.participant_id);
    state = downed.next_state;
    appendEvents(emitted, downed.emitted_events);
    downedParticipants.push(participant.participant_id);
  }

  return {
    next_state: state,
    downed_participants: downedParticipants,
    emitted_events: emitted
  };
}

async function resolveCombatTurn(input) {
  const registry = input.registry;
  const event = input.event;
  const options = input.options || {};
  const timeoutSeconds = assertValidTurnTimeoutSeconds(
    options.turn_timeout_seconds || 60
  );
  const timeoutPolicy = options.turn_timeout_policy || TURN_TIMEOUT_POLICIES.SKIP_TURN;
  const snapshotStore =
    options.snapshot_store || new CombatSnapshotStore();

  return processCombatEventSafe({
    registry,
    event,
    processEventFn: async ({ event: phaseEvent, combatState }) => {
      const payload = phaseEvent.payload || {};
      const phaseResults = [];
      const emittedEvents = [];
      let state = combatState;

      // 1) turn_started
      const turnStarted = resolveTurnStarted({ event: phaseEvent, combatState: state });
      state = turnStarted.stateUpdater(state);
      addPhaseResult(phaseResults, "turn_started", {
        ok: true,
        active_participant_id: turnStarted.output.active_participant_id
      });
      appendEvents(emittedEvents, [
        {
          event_type: "turn_started",
          timestamp: new Date().toISOString(),
          payload: turnStarted.output
        }
      ]);

      const activeParticipantId = turnStarted.output.active_participant_id;

      // 2) start_of_turn_effects
      const startEffects = processStartOfTurnEffects(state, activeParticipantId);
      state = startEffects.next_state;
      addPhaseResult(phaseResults, "start_of_turn_effects", {
        ok: true,
        processed_count: startEffects.processed_effects.length,
        expired_count: startEffects.expired_effects.length
      });
      appendEvents(emittedEvents, startEffects.emitted_events);

      // 3) concentration expiry checks
      const concentrationExpiry = checkConcentrationExpiry({
        combat_state: state
      });
      state = concentrationExpiry.next_state;
      addPhaseResult(phaseResults, "concentration_expiry_checks", {
        ok: true,
        expired_count: concentrationExpiry.expired_participants.length
      });
      appendEvents(emittedEvents, concentrationExpiry.emitted_events);

      // 4) player_action_phase
      const actionWait = await waitForPlayerActionWithTimeout({
        timeout_seconds: timeoutSeconds,
        action_provider: options.action_provider,
        fallback_action_payload: payload.action_payload || null,
        combat_id: state.combat_id,
        participant_id: activeParticipantId
      });

      let resolvedActionPayload = actionWait.action_payload;
      if (actionWait.status === "timeout") {
        resolvedActionPayload = buildTimeoutAutoAction(
          timeoutPolicy,
          activeParticipantId
        );
      }

      let actionValidation = null;
      if (
        resolvedActionPayload &&
        resolvedActionPayload.action_type !== "dodge" &&
        resolvedActionPayload.action_type !== "skip_turn"
      ) {
        actionValidation = validateCombatAction({
          combat_state: state,
          action_payload: resolvedActionPayload
        });
      }
      addPhaseResult(phaseResults, "player_action_phase", {
        ok: true,
        action_wait_status: actionWait.status,
        action_payload: resolvedActionPayload,
        action_validation: actionValidation
      });
      appendEvents(emittedEvents, [
        {
          event_type: "player_action_phase",
          timestamp: new Date().toISOString(),
          payload: {
            action_wait_status: actionWait.status,
            action_payload: resolvedActionPayload,
            action_validation: actionValidation
          }
        }
      ]);

      // 5) reaction_window
      let reactionResult = {
        status: "skipped",
        emitted_events: []
      };
      if (payload.reaction_trigger_event && options.reaction_registry) {
        reactionResult = await runReactionEngine({
          combat_state: state,
          trigger_type: payload.reaction_trigger_event.trigger_type,
          trigger_event: payload.reaction_trigger_event,
          reaction_registry: options.reaction_registry,
          decision_provider: options.reaction_decision_provider,
          wait_ms: Number(options.reaction_wait_ms || 10000)
        });
        state = reactionResult.next_state;
      }
      addPhaseResult(phaseResults, "reaction_window", {
        ok: true,
        reaction_status: reactionResult.status
      });
      appendEvents(emittedEvents, reactionResult.emitted_events);

      // 6) damage_resolution
      let damageResult = null;
      if (payload.damage_request && payload.damage_request.target_participant_id) {
        const applied = applyDamageToCombatState({
          combat_state: state,
          target_participant_id: payload.damage_request.target_participant_id,
          damage_type: payload.damage_request.damage_type,
          damage_formula: payload.damage_request.damage_formula,
          flat_modifier: payload.damage_request.flat_modifier,
          rng: options.rng
        });
        state = applied.next_state;
        damageResult = applied.damage_result;
      } else if (payload.damage_preview && payload.damage_preview.target) {
        damageResult = resolveDamagePipeline({
          target: payload.damage_preview.target,
          damage_type: payload.damage_preview.damage_type,
          damage_formula: payload.damage_preview.damage_formula,
          flat_modifier: payload.damage_preview.flat_modifier,
          rng: options.rng
        });
      }
      addPhaseResult(phaseResults, "damage_resolution", {
        ok: true,
        damage_result: damageResult
      });
      if (damageResult) {
        appendEvents(emittedEvents, [
          {
            event_type: "damage_resolved",
            timestamp: new Date().toISOString(),
            payload: {
              target_id: damageResult.target_id,
              final_damage: damageResult.final_damage
            }
          }
        ]);
      }

      // 7) concentration_check
      let concentrationResult = null;
      if (damageResult && damageResult.target_id) {
        concentrationResult = resolveConcentrationOnDamage({
          combat_state: state,
          participant_id: damageResult.target_id,
          damage_taken: damageResult.final_damage,
          rng: options.rng
        });
        state = concentrationResult.next_state;
      }
      addPhaseResult(phaseResults, "concentration_check", {
        ok: true,
        concentration_result: concentrationResult
      });
      if (concentrationResult && concentrationResult.required) {
        appendEvents(emittedEvents, [
          {
            event_type: "concentration_check_resolved",
            timestamp: new Date().toISOString(),
            payload: {
              participant_id: concentrationResult.participant_id,
              broken: concentrationResult.concentration_broken
            }
          }
        ]);
      }

      // 8) apply_status_effects
      let statusApplyCount = 0;
      if (Array.isArray(payload.status_effects_to_apply)) {
        for (const rawEffect of payload.status_effects_to_apply) {
          const effect = createStatusEffect(rawEffect);
          const added = addEffect(state, effect);
          state = added.next_state;
          statusApplyCount += 1;
          appendEvents(emittedEvents, added.emitted_events);
        }
      }
      addPhaseResult(phaseResults, "apply_status_effects", {
        ok: true,
        applied_count: statusApplyCount
      });

      // 9) death_check
      const deathCheck = runDeathCheck(state);
      state = deathCheck.next_state;
      addPhaseResult(phaseResults, "death_check", {
        ok: true,
        downed_participants: deathCheck.downed_participants
      });
      appendEvents(emittedEvents, deathCheck.emitted_events);

      // 10) status_duration_tick
      const statusTick = processStatusDurationTick(state, activeParticipantId);
      state = statusTick.next_state;
      addPhaseResult(phaseResults, "status_duration_tick", {
        ok: true,
        processed_count: statusTick.processed_effects.length,
        expired_count: statusTick.expired_effects.length
      });
      appendEvents(emittedEvents, statusTick.emitted_events);

      // 11) end_of_turn_effects
      const endEffects = processEndOfTurnEffects(state, activeParticipantId);
      state = endEffects.next_state;
      addPhaseResult(phaseResults, "end_of_turn_effects", {
        ok: true,
        processed_count: endEffects.processed_effects.length,
        expired_count: endEffects.expired_effects.length
      });
      appendEvents(emittedEvents, endEffects.emitted_events);

      // 12) turn_ended
      addPhaseResult(phaseResults, "turn_ended", {
        ok: true,
        ended_participant_id: activeParticipantId
      });
      appendEvents(emittedEvents, [
        {
          event_type: "turn_ended",
          timestamp: new Date().toISOString(),
          payload: {
            participant_id: activeParticipantId,
            round_number: state.round_number
          }
        }
      ]);

      const snapshot = snapshotStore.saveSnapshot(state);
      appendEvents(emittedEvents, [
        {
          event_type: "combat_snapshot_saved",
          timestamp: new Date().toISOString(),
          payload: {
            snapshot_id: snapshot.snapshot_id,
            combat_id: snapshot.combat_id,
            round_number: snapshot.round_number,
            current_turn_index: snapshot.current_turn_index
          }
        }
      ]);

      // 13) next_turn
      state = advanceToNextTurn(state);
      addPhaseResult(phaseResults, "next_turn", {
        ok: true,
        next_turn_index: state.current_turn_index,
        round_number: state.round_number
      });
      appendEvents(emittedEvents, [
        {
          event_type: "next_turn",
          timestamp: new Date().toISOString(),
          payload: {
            current_turn_index: state.current_turn_index,
            round_number: state.round_number
          }
        }
      ]);

      return {
        nextState: state,
        output: {
          event_type: "combat_turn_resolved",
          combat_id: state.combat_id,
          phase_results: phaseResults,
          emitted_events: emittedEvents
        }
      };
    }
  });
}

module.exports = {
  resolveCombatTurn
};

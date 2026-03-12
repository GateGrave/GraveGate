"use strict";

class ReactionRegistry {
  constructor() {
    this.reactionsByType = new Map();
  }

  registerReaction(reactionDefinition) {
    if (!reactionDefinition || !reactionDefinition.reaction_type) {
      throw new Error("registerReaction requires reaction_type");
    }

    this.reactionsByType.set(reactionDefinition.reaction_type, reactionDefinition);
    return reactionDefinition;
  }

  getReaction(reactionType) {
    return this.reactionsByType.get(reactionType) || null;
  }

  getCandidatesForTrigger(triggerType, context) {
    const candidates = [];

    for (const definition of this.reactionsByType.values()) {
      if (!Array.isArray(definition.supported_triggers)) {
        continue;
      }

      if (!definition.supported_triggers.includes(triggerType)) {
        continue;
      }

      const built = definition.buildCandidates
        ? definition.buildCandidates(context)
        : [];

      for (const candidate of built || []) {
        candidates.push({
          reaction_type: definition.reaction_type,
          reactor_participant_id: candidate.reactor_participant_id,
          metadata: candidate.metadata || {}
        });
      }
    }

    return candidates;
  }
}

module.exports = {
  ReactionRegistry
};

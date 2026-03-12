"use strict";

class InMemoryGuildInviteStore {
  constructor() {
    this.invites = new Map();
  }

  makeKey(guildId, playerId) {
    return `${String(guildId)}:${String(playerId)}`;
  }

  saveInvite(invite) {
    const key = this.makeKey(invite.guild_id, invite.target_player_id);
    this.invites.set(key, invite);
    return invite;
  }

  loadInvite(guildId, playerId) {
    const key = this.makeKey(guildId, playerId);
    return this.invites.get(key) || null;
  }

  removeInvite(guildId, playerId) {
    const key = this.makeKey(guildId, playerId);
    return this.invites.delete(key);
  }
}

function createFailure(eventType, reason, extra) {
  return {
    ok: false,
    event_type: eventType,
    payload: {
      reason,
      ...(extra || {})
    }
  };
}

function createSuccess(eventType, payload) {
  return {
    ok: true,
    event_type: eventType,
    payload: payload || {}
  };
}

function getGuildOrFailure(guildManager, guild_id, eventType) {
  if (!guildManager) {
    return createFailure(eventType, "guild_manager_required");
  }
  if (!guild_id || String(guild_id).trim() === "") {
    return createFailure(eventType, "guild_id_required");
  }
  const guild = guildManager.getGuild(guild_id);
  if (!guild) {
    return createFailure(eventType, "guild_not_found", { guild_id: String(guild_id) });
  }
  return guild;
}

function isLeader(guild, playerId) {
  return String(guild.leader_id) === String(playerId);
}

function isOfficer(guild, playerId) {
  return Array.isArray(guild.officer_ids) && guild.officer_ids.includes(String(playerId));
}

function isMember(guild, playerId) {
  return Array.isArray(guild.member_ids) && guild.member_ids.includes(String(playerId));
}

function inviteMemberToGuild(input) {
  const data = input || {};
  const eventType = "guild_member_invite_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const inviteStore = data.inviteStore;
  if (!inviteStore || typeof inviteStore.loadInvite !== "function" || typeof inviteStore.saveInvite !== "function") {
    return createFailure(eventType, "invite_store_required");
  }

  const acting = String(data.acting_player_id || "");
  const target = String(data.target_player_id || "");
  if (!acting) return createFailure(eventType, "acting_player_id_required");
  if (!target) return createFailure(eventType, "target_player_id_required");

  const canInvite = isLeader(guild, acting) || isOfficer(guild, acting);
  if (!canInvite) return createFailure(eventType, "insufficient_permissions");
  if (isMember(guild, target)) return createFailure(eventType, "target_already_member");

  const existing = inviteStore.loadInvite(guild.guild_id, target);
  if (existing) {
    return createFailure(eventType, "duplicate_invite", {
      guild_id: guild.guild_id,
      target_player_id: target
    });
  }

  const invite = inviteStore.saveInvite({
    invite_id: data.invite_id || `ginv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guild_id: guild.guild_id,
    invited_by: acting,
    target_player_id: target,
    created_at: new Date().toISOString()
  });

  return createSuccess("guild_member_invited", {
    guild_id: guild.guild_id,
    invite
  });
}

function acceptGuildInvite(input) {
  const data = input || {};
  const eventType = "guild_member_accept_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const inviteStore = data.inviteStore;
  if (!inviteStore || typeof inviteStore.loadInvite !== "function" || typeof inviteStore.removeInvite !== "function") {
    return createFailure(eventType, "invite_store_required");
  }

  const playerId = String(data.player_id || "");
  if (!playerId) return createFailure(eventType, "player_id_required");
  if (isMember(guild, playerId)) return createFailure(eventType, "target_already_member");

  const invite = inviteStore.loadInvite(guild.guild_id, playerId);
  if (!invite) return createFailure(eventType, "invite_not_found");

  const nextMembers = Array.from(new Set([...(guild.member_ids || []), playerId]));
  const updated = data.guildManager.updateGuild(guild.guild_id, {
    member_ids: nextMembers
  });
  inviteStore.removeInvite(guild.guild_id, playerId);

  return createSuccess("guild_member_invite_accepted", {
    guild_id: guild.guild_id,
    player_id: playerId,
    member_count: updated.member_ids.length
  });
}

function declineGuildInvite(input) {
  const data = input || {};
  const eventType = "guild_member_decline_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const inviteStore = data.inviteStore;
  if (!inviteStore || typeof inviteStore.loadInvite !== "function" || typeof inviteStore.removeInvite !== "function") {
    return createFailure(eventType, "invite_store_required");
  }

  const playerId = String(data.player_id || "");
  if (!playerId) return createFailure(eventType, "player_id_required");

  const invite = inviteStore.loadInvite(guild.guild_id, playerId);
  if (!invite) return createFailure(eventType, "invite_not_found");
  inviteStore.removeInvite(guild.guild_id, playerId);

  return createSuccess("guild_member_invite_declined", {
    guild_id: guild.guild_id,
    player_id: playerId
  });
}

function leaveGuild(input) {
  const data = input || {};
  const eventType = "guild_member_leave_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const playerId = String(data.player_id || "");
  if (!playerId) return createFailure(eventType, "player_id_required");
  if (!isMember(guild, playerId)) return createFailure(eventType, "target_not_member");

  if (isLeader(guild, playerId) && guild.member_ids.length > 1) {
    return createFailure(eventType, "leader_must_transfer_before_leave");
  }

  const nextMembers = (guild.member_ids || []).filter((id) => id !== playerId);
  const nextOfficers = (guild.officer_ids || []).filter((id) => id !== playerId);
  const nextLeader = isLeader(guild, playerId) ? (nextMembers[0] || playerId) : guild.leader_id;

  const updated = data.guildManager.updateGuild(guild.guild_id, {
    member_ids: nextMembers,
    officer_ids: nextOfficers,
    leader_id: nextLeader
  });

  return createSuccess("guild_member_left", {
    guild_id: guild.guild_id,
    player_id: playerId,
    member_count: updated.member_ids.length
  });
}

function kickGuildMember(input) {
  const data = input || {};
  const eventType = "guild_member_kick_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const acting = String(data.acting_player_id || "");
  const target = String(data.target_player_id || "");
  if (!acting) return createFailure(eventType, "acting_player_id_required");
  if (!target) return createFailure(eventType, "target_player_id_required");
  if (!isMember(guild, target)) return createFailure(eventType, "target_not_member");
  if (isLeader(guild, target)) return createFailure(eventType, "cannot_kick_leader");
  if (!isMember(guild, acting)) return createFailure(eventType, "insufficient_permissions");

  const actingIsLeader = isLeader(guild, acting);
  const actingIsOfficer = isOfficer(guild, acting);
  const targetIsOfficer = isOfficer(guild, target);
  if (!(actingIsLeader || actingIsOfficer)) return createFailure(eventType, "insufficient_permissions");
  if (actingIsOfficer && targetIsOfficer) return createFailure(eventType, "officer_cannot_kick_officer");

  const nextMembers = (guild.member_ids || []).filter((id) => id !== target);
  const nextOfficers = (guild.officer_ids || []).filter((id) => id !== target);
  const updated = data.guildManager.updateGuild(guild.guild_id, {
    member_ids: nextMembers,
    officer_ids: nextOfficers
  });

  return createSuccess("guild_member_kicked", {
    guild_id: guild.guild_id,
    acting_player_id: acting,
    target_player_id: target,
    member_count: updated.member_ids.length
  });
}

function promoteGuildOfficer(input) {
  const data = input || {};
  const eventType = "guild_officer_promote_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const acting = String(data.acting_player_id || "");
  const target = String(data.target_player_id || "");
  if (!acting) return createFailure(eventType, "acting_player_id_required");
  if (!target) return createFailure(eventType, "target_player_id_required");
  if (!isLeader(guild, acting)) return createFailure(eventType, "insufficient_permissions");
  if (!isMember(guild, target)) return createFailure(eventType, "target_not_member");
  if (isOfficer(guild, target)) return createFailure(eventType, "target_already_officer");

  const nextOfficers = Array.from(new Set([...(guild.officer_ids || []), target]));
  const updated = data.guildManager.updateGuild(guild.guild_id, {
    officer_ids: nextOfficers
  });

  return createSuccess("guild_officer_promoted", {
    guild_id: guild.guild_id,
    target_player_id: target,
    officer_count: updated.officer_ids.length
  });
}

function demoteGuildOfficer(input) {
  const data = input || {};
  const eventType = "guild_officer_demote_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const acting = String(data.acting_player_id || "");
  const target = String(data.target_player_id || "");
  if (!acting) return createFailure(eventType, "acting_player_id_required");
  if (!target) return createFailure(eventType, "target_player_id_required");
  if (!isLeader(guild, acting)) return createFailure(eventType, "insufficient_permissions");
  if (!isOfficer(guild, target)) return createFailure(eventType, "target_not_officer");

  const nextOfficers = (guild.officer_ids || []).filter((id) => id !== target);
  const updated = data.guildManager.updateGuild(guild.guild_id, {
    officer_ids: nextOfficers
  });

  return createSuccess("guild_officer_demoted", {
    guild_id: guild.guild_id,
    target_player_id: target,
    officer_count: updated.officer_ids.length
  });
}

function transferGuildLeadership(input) {
  const data = input || {};
  const eventType = "guild_leadership_transfer_failed";
  const guild = getGuildOrFailure(data.guildManager, data.guild_id, eventType);
  if (guild?.ok === false) return guild;

  const acting = String(data.acting_player_id || "");
  const target = String(data.target_player_id || "");
  if (!acting) return createFailure(eventType, "acting_player_id_required");
  if (!target) return createFailure(eventType, "target_player_id_required");
  if (!isLeader(guild, acting)) return createFailure(eventType, "insufficient_permissions");
  if (!isMember(guild, target)) return createFailure(eventType, "target_not_member");
  if (target === guild.leader_id) return createFailure(eventType, "target_already_leader");

  const nextOfficers = Array.from(new Set([...(guild.officer_ids || []).filter((id) => id !== target), acting]));
  const updated = data.guildManager.updateGuild(guild.guild_id, {
    leader_id: target,
    officer_ids: nextOfficers
  });

  return createSuccess("guild_leadership_transferred", {
    guild_id: guild.guild_id,
    old_leader_id: acting,
    new_leader_id: target,
    officer_ids: updated.officer_ids
  });
}

module.exports = {
  InMemoryGuildInviteStore,
  inviteMemberToGuild,
  acceptGuildInvite,
  declineGuildInvite,
  leaveGuild,
  kickGuildMember,
  promoteGuildOfficer,
  demoteGuildOfficer,
  transferGuildLeadership
};


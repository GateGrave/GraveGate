"use strict";

// Helper functions requested for session locking.
// These call the manager methods to keep lock behavior in one place.
function lockDungeonSession(manager, session_id, lockInfo) {
  return manager.lockDungeonSession(session_id, lockInfo);
}

function unlockDungeonSession(manager, session_id) {
  return manager.unlockDungeonSession(session_id);
}

function isDungeonSessionLocked(manager, session_id) {
  return manager.isDungeonSessionLocked(session_id);
}

module.exports = {
  lockDungeonSession,
  unlockDungeonSession,
  isDungeonSessionLocked
};


"use strict";

function parseCoordinatePair(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*,\s*(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2])
  };
}

function parseMoveCommand(input) {
  const text = String(input || "").trim();
  const match = text.match(/^(move|go|walk)\s+(?:to\s+)?(\d+\s*,\s*\d+)$/i);
  if (!match) {
    return null;
  }

  const coordinate = parseCoordinatePair(match[2]);
  if (!coordinate) {
    return null;
  }

  return {
    ok: true,
    action: "move",
    target_position: coordinate,
    raw: text
  };
}

function parseAttackCommand(input) {
  const text = String(input || "").trim();
  let match = text.match(/^(attack|shoot|strike)\s+([A-Za-z0-9_-]+)$/i);
  if (match) {
    return {
      ok: true,
      action: "attack",
      target_token_ref: match[2],
      raw: text
    };
  }

  match = text.match(/^(attack|shoot|strike)\s+(\d+\s*,\s*\d+)$/i);
  if (!match) {
    return null;
  }

  const coordinate = parseCoordinatePair(match[2]);
  if (!coordinate) {
    return null;
  }

  return {
    ok: true,
    action: "attack",
    target_position: coordinate,
    raw: text
  };
}

function parseSpellCommand(input) {
  const text = String(input || "").trim();
  const match = text.match(/^(cast|spell)\s+([A-Za-z0-9_-]+)(?:\s+(?:at|on)\s+(\d+\s*,\s*\d+|[A-Za-z0-9_-]+))?$/i);
  if (!match) {
    return null;
  }

  const targetRef = match[3] || "";
  const coordinate = parseCoordinatePair(targetRef);

  return {
    ok: true,
    action: "spell",
    spell_ref: match[2],
    target_position: coordinate || null,
    target_token_ref: coordinate ? "" : targetRef,
    raw: text
  };
}

function parseTargetCommand(input) {
  const text = String(input || "").trim();
  let match = text.match(/^(target|select)\s+([A-Za-z0-9_-]+)$/i);
  if (match) {
    return {
      ok: true,
      action: "target",
      target_token_ref: match[2],
      target_position: null,
      raw: text
    };
  }

  match = text.match(/^(target|select)\s+(\d+\s*,\s*\d+)$/i);
  if (!match) {
    return null;
  }

  const coordinate = parseCoordinatePair(match[2]);
  if (!coordinate) {
    return null;
  }

  return {
    ok: true,
    action: "target",
    target_token_ref: "",
    target_position: coordinate,
    raw: text
  };
}

function parseMapCommand(input) {
  const parsers = [parseMoveCommand, parseAttackCommand, parseSpellCommand, parseTargetCommand];
  for (const parser of parsers) {
    const result = parser(input);
    if (result) {
      return result;
    }
  }

  return {
    ok: false,
    error: "unsupported map command",
    raw: String(input || "")
  };
}

module.exports = {
  parseCoordinatePair,
  parseMoveCommand,
  parseAttackCommand,
  parseSpellCommand,
  parseTargetCommand,
  parseMapCommand
};

"use strict";

const { MAP_BUTTON_ACTIONS, buildMapButtonCustomId } = require("./map-ui.contract");
const {
  DEBUG_FLAG_LABELS,
  normalizeDebugFlags,
  formatDebugFlagSummary
} = require("../interaction/debug-flags");

const PAGE_SIZE = 15;

function cleanText(value, fallback) {
  const safe = String(value || "").trim();
  return safe === "" ? (fallback || "") : safe;
}

function clampPage(page, totalPages) {
  const safeTotal = Math.max(1, Number(totalPages || 1));
  const safePage = Number(page || 1);
  if (!Number.isFinite(safePage)) {
    return 1;
  }

  return Math.max(1, Math.min(safeTotal, Math.floor(safePage)));
}

function paginateEntries(entries, page, pageSize) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safePageSize = Math.max(1, Number(pageSize || PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(safeEntries.length / safePageSize));
  const currentPage = clampPage(page, totalPages);
  const startIndex = (currentPage - 1) * safePageSize;

  return {
    entries: safeEntries.slice(startIndex, startIndex + safePageSize),
    current_page: currentPage,
    total_pages: totalPages
  };
}

function chunkButtons(buttons) {
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({
      type: 1,
      components: buttons.slice(index, index + 5)
    });
  }
  return rows;
}

function buildPagedNavRow(buttons) {
  return {
    type: 1,
    components: buttons.filter(Boolean).slice(0, 5)
  };
}

function buildPageButtons(options) {
  if (options.total_pages <= 1) {
    return [];
  }

  const buttons = [
    {
      type: 2,
      style: 2,
      label: "Prev",
      disabled: options.current_page <= 1,
        custom_id: options.build_page_custom_id(options.current_page - 1)
    },
    {
      type: 2,
      style: 2,
      label: "Next",
      disabled: options.current_page >= options.total_pages,
        custom_id: options.build_page_custom_id(options.current_page + 1)
    }
  ];

  if (options.include_label === false) {
    return buttons;
  }

  buttons.splice(1, 0, {
    type: 2,
    style: 2,
    label: `Page ${options.current_page}/${options.total_pages}`,
    disabled: true,
    custom_id: options.build_page_custom_id(options.current_page)
  });

  return buttons;
}

function buildMapActionRow(options) {
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";

  return [
    {
      type: 2,
      style: 1,
      label: "Move",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.MOVE,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 4,
      label: "Attack",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.ATTACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 2,
      label: "Spell",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.SPELL,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 2,
      label: "Token",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.TOKEN,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ];
}

function buildDebugControlRows(options) {
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const debugFlags = normalizeDebugFlags(options.debug_flags);
  const buttons = Object.keys(DEBUG_FLAG_LABELS).map((key) => ({
    type: 2,
    style: debugFlags[key] === true ? 1 : 2,
    label: DEBUG_FLAG_LABELS[key],
    custom_id: buildMapButtonCustomId({
      action: `${MAP_BUTTON_ACTIONS.DEBUG_TOGGLE},${key}`,
      actor_id: actorId,
      instance_type: instanceType,
      instance_id: instanceId
    })
  }));

  return [{
    type: 1,
    components: buttons
  }];
}

function buildMapActionRows(options) {
  return chunkButtons(buildMapActionRow(options)).concat(buildDebugControlRows(options));
}

function buildContentLines(lines) {
  return lines.filter((line) => typeof line === "string" && line.trim()).join("\n");
}

function buildModeSummary(options) {
  const lines = [];

  if (options.title) {
    lines.push(options.title);
  }

  if (options.turn_label) {
    lines.push(`Turn: ${options.turn_label}`);
  }

  if (options.mode_label) {
    lines.push(`Mode: ${options.mode_label}`);
  }

  if (options.weapon_summary) {
    lines.push(`Weapon: ${options.weapon_summary}`);
  }

  if (options.spell_summary) {
    lines.push(`Spell: ${options.spell_summary}`);
  }

  if (options.selection_summary) {
    lines.push(`Selection: ${options.selection_summary}`);
  }

  if (options.page_summary) {
    lines.push(options.page_summary);
  }

  if (options.debug_summary) {
    lines.push(options.debug_summary);
  }

  if (options.hint) {
    lines.push(options.hint);
  }

  return buildContentLines(lines);
}

function getAttackRangeSummary(attackProfile, selectedTargetId, validTargets) {
  if (!selectedTargetId) {
    return "";
  }

  const selectedTarget = (validTargets || []).find((entry) => String(entry.token_id) === String(selectedTargetId));
  if (!selectedTarget) {
    return selectedTargetId;
  }

  const bandText = selectedTarget.range_band === "long"
    ? " (long range)"
    : "";
  return `${selectedTarget.token_id} at ${selectedTarget.distance_feet} ft${bandText}`;
}

function getWeaponSummary(attackProfile) {
  if (!attackProfile) {
    return "";
  }

  const name = attackProfile.weapon_name || (attackProfile.mode === "ranged_weapon" ? "Ranged Attack" : "Melee Attack");
  if (attackProfile.mode === "melee") {
    return attackProfile.is_reach_weapon
      ? `${name} (reach ${attackProfile.range_feet} ft)`
      : `${name} (${attackProfile.range_feet} ft)`;
  }

  if (attackProfile.long_range_feet > attackProfile.range_feet) {
    return `${name} (${attackProfile.range_feet}/${attackProfile.long_range_feet} ft)`;
  }

  return `${name} (${attackProfile.range_feet} ft)`;
}

function formatFeetAsTiles(feet) {
  const safeFeet = Number(feet || 0);
  if (!Number.isFinite(safeFeet) || safeFeet <= 0) {
    return "0 tiles";
  }
  return `${Math.max(1, Math.round(safeFeet / 5))} tiles`;
}

function formatCoordinateLabel(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return "?";
  }
  return `${Math.floor(Number(point.x))},${Math.floor(Number(point.y))}`;
}

function formatCoverLabel(cover) {
  const safe = String(cover || "none");
  if (safe === "three_quarters") {
    return "three-quarters";
  }
  return safe.replace(/_/g, " ");
}

function buildTargetListSummary(label, entries, getName) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length === 0) {
    return `${label}: none`;
  }

  const names = safeEntries
    .slice(0, 5)
    .map((entry) => getName(entry))
    .filter(Boolean);
  return `${label}: ${names.join(", ")}${safeEntries.length > names.length ? ", ..." : ""}`;
}

function getTargetDisplayLabel(entry) {
  return cleanText(
    entry && (entry.name || entry.display_name || entry.token_id || entry.label),
    "unknown"
  );
}

function formatSpellShapeLabel(options) {
  const shape = String(options && options.spell_shape || "").toLowerCase();
  const sizeFeet = Number(options && options.area_size_feet || 0);
  const lineWidthFeet = Number(options && options.line_width_feet || 0);
  const maxTargets = Number(options && options.max_targets || 0);
  const requiresExact = options && options.requires_exact_target_count === true;
  const requiresAdjacent = options && options.requires_adjacent_selection === true;
  const selfCentered = options && options.self_centered_area === true;

  if (shape === "single") {
    if (String(options && options.targeting_type || "").toLowerCase() === "object") {
      return "Single object";
    }
    return "Single target";
  }

  if (shape === "split") {
    if (requiresAdjacent && maxTargets === 2) {
      return "1 or 2 adjacent targets";
    }
    if (requiresExact && maxTargets > 1) {
      return `Exactly ${maxTargets} target selections`;
    }
    if (maxTargets > 1) {
      return `Up to ${maxTargets} targets`;
    }
    return "Multi-target";
  }

  if (shape === "self") {
    return "Self";
  }

  if (shape === "utility") {
    return "Utility";
  }

  if (shape === "line") {
    if (sizeFeet > 0 && lineWidthFeet > 0) {
      return `${sizeFeet} ft x ${lineWidthFeet} ft line`;
    }
    if (sizeFeet > 0) {
      return `${sizeFeet} ft line`;
    }
    return "Line";
  }

  if (["cone", "cube", "sphere", "aura"].includes(shape)) {
    const areaLabel = sizeFeet > 0 ? `${sizeFeet} ft ${shape}` : shape;
    return selfCentered ? `Self-centered ${areaLabel}` : areaLabel;
  }

  return shape || "";
}

function buildSpellTargetingInstruction(options) {
  const useTileButtons = Array.isArray(options.valid_target_tiles) && options.valid_target_tiles.length > 0;
  const spellShape = String(options.spell_shape || "").toLowerCase();
  const maxTargets = Number(options.max_targets || 0);

  if (options.self_centered_area === true) {
    return "This spell is centered on you. Confirm when you are ready to cast.";
  }

  if (spellShape === "self") {
    return "This spell targets you. Confirm when you are ready to cast.";
  }

  if (spellShape === "utility") {
    return "No target selection is required. Confirm when you are ready to cast.";
  }

  if (useTileButtons) {
    return "Choose a target point with the buttons below.";
  }

  if (options.requires_adjacent_selection === true && maxTargets === 2) {
    return "Choose one target, or choose two adjacent targets.";
  }

  if (options.requires_exact_target_count === true && maxTargets > 1) {
    return `Choose exactly ${maxTargets} target selections.`;
  }

  if (maxTargets > 1) {
    return `Choose up to ${maxTargets} targets.`;
  }

  if (String(options.targeting_type || "").toLowerCase() === "object") {
    return "Choose an object target with the buttons below.";
  }

  return "Choose a spell target with the buttons below.";
}

function buildSpellSelectionCountSummary(options) {
  const selectedCount = Array.isArray(options.selected_targets) ? options.selected_targets.length : 0;
  const minTargets = Number(options.min_targets || 0);
  const maxTargets = Number(options.max_targets || 0);

  if (options.self_centered_area === true || ["self", "utility"].includes(String(options.spell_shape || "").toLowerCase())) {
    return "";
  }

  if (options.requires_exact_target_count === true && maxTargets > 1) {
    return `Selections: ${selectedCount}/${maxTargets}`;
  }

  if (maxTargets > 1) {
    return `Selections: ${selectedCount} of up to ${maxTargets}`;
  }

  if (minTargets > 1) {
    return `Selections: ${selectedCount} of at least ${minTargets}`;
  }

  return "";
}

function buildSpellSelectionSummary(options) {
  const selectedTargets = Array.isArray(options.selected_targets) ? options.selected_targets : [];
  const validTargets = Array.isArray(options.valid_targets) ? options.valid_targets : [];
  const selectionCounts = selectedTargets.reduce((accumulator, tokenId) => {
    const safeTokenId = String(tokenId);
    accumulator[safeTokenId] = (accumulator[safeTokenId] || 0) + 1;
    return accumulator;
  }, {});
  const selectionSummaryText = Object.keys(selectionCounts).length > 0
    ? Object.entries(selectionCounts).map(([tokenId, count]) => {
      const matchingTarget = validTargets.find((entry) => String(entry && entry.token_id || "") === tokenId);
      const label = matchingTarget ? getTargetDisplayLabel(matchingTarget) : tokenId;
      return `${label}${count > 1 ? ` x${count}` : ""}`;
    }).join(", ")
    : "";
  const selectedTargetSummary = options.selected_target_details
    ? [
        `Target ${cleanText(options.selected_target_details.name, options.selected_target_details.token_id)}`,
        Number.isFinite(Number(options.selected_target_details.distance_feet)) ? `${Number(options.selected_target_details.distance_feet)} ft` : "",
        `Cover ${formatCoverLabel(options.selected_target_details.cover)}`,
        options.selected_target_details.line_of_sight === true ? "LOS clear" : "LOS blocked"
      ].filter(Boolean).join(" | ")
    : "";
  const selectedTileSummary = options.target_position_details
    ? [
        `Tile ${formatCoordinateLabel(options.target_position_details)}`,
        Number.isFinite(Number(options.target_position_details.distance_feet)) ? `${Number(options.target_position_details.distance_feet)} ft` : "",
        options.target_position_details.line_of_sight === true ? "LOS clear" : "LOS blocked"
      ].filter(Boolean).join(" | ")
    : "";

  if (options.self_centered_area === true) {
    return "Centered on your tile.";
  }

  if (String(options.spell_shape || "").toLowerCase() === "self") {
    return "Target: you.";
  }

  if (String(options.spell_shape || "").toLowerCase() === "utility") {
    return "No target selection required.";
  }

  if (selectedTargets.length > 0) {
    return selectedTargetSummary || `Selected target${selectedTargets.length === 1 ? "" : "s"}: ${selectionSummaryText}`;
  }

  if (options.target_position) {
    return selectedTileSummary || `Selected tile: ${formatCoordinateLabel(options.target_position)}`;
  }

  return "No spell target selected yet.";
}

function buildMapMessagePayload(options) {
  return {
    content: buildContentLines([
      options.content || "Map ready.",
      options.turn_label ? `Turn: ${options.turn_label}` : "",
      options.mode_label ? `Mode: ${options.mode_label}` : "",
      formatDebugFlagSummary(options.debug_flags)
    ]),
    files: options.files || [],
    components: buildMapActionRows(options)
  };
}

function buildMapMessageEditPayload(options) {
  return {
    message_id: options.message_id || "",
    content: buildContentLines([
      options.content || "Map ready.",
      options.turn_label ? `Turn: ${options.turn_label}` : "",
      options.mode_label ? `Mode: ${options.mode_label}` : "",
      formatDebugFlagSummary(options.debug_flags)
    ]),
    files: options.files || [],
    components: buildMapActionRows(options)
  };
}

function buildMovePreviewRows(options) {
  const reachableTiles = Array.isArray(options.reachable_tiles) ? options.reachable_tiles : [];
  const pageInfo = paginateEntries(reachableTiles, options.page, options.page_size);
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const selectedLabel = formatCoordinateLabel(options.selected_target_position);

  const tileButtons = pageInfo.entries.map((tile) => {
    const label = `${formatCoordinateLabel(tile)} (${Number(tile.movement_cost_feet || 0)}ft)`.slice(0, 80);
    return {
      type: 2,
      style: selectedLabel === formatCoordinateLabel(tile) ? 1 : 2,
      label,
      custom_id: buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.MOVE_TARGET},${Math.floor(Number(tile.x))},${Math.floor(Number(tile.y))}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    };
  });

  const rows = chunkButtons(tileButtons);
  rows.push(buildPagedNavRow([
    ...buildPageButtons({
      current_page: pageInfo.current_page,
      total_pages: pageInfo.total_pages,
      build_page_custom_id: (page) => buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.MOVE_PAGE},${page}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }),
    {
      type: 2,
      style: 1,
      label: "Confirm Move",
      disabled: !options.selected_target_position,
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.MOVE_CONFIRM,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 2,
      label: "Back",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.BACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ]));

  return rows.concat(buildDebugControlRows(options));
}

function buildMovePreviewMessagePayload(options) {
  const reachableTiles = Array.isArray(options.reachable_tiles) ? options.reachable_tiles : [];
  const pageInfo = paginateEntries(reachableTiles, options.page, options.page_size);
  const selectedTarget = options.selected_target || null;
  const movementFeet = Number(options.movement_speed_feet || 0);
  const selectionSummary = selectedTarget
    ? `Selected: ${formatCoordinateLabel(selectedTarget)} | Cost ${Number(selectedTarget.movement_cost_feet || 0)} ft | Remaining ${Number(selectedTarget.remaining_movement_feet || 0)} ft`
    : "Select a legal destination tile.";

  return {
    content: options.content || buildModeSummary({
      title: "Move",
      turn_label: options.turn_label || "",
      mode_label: "Move Preview",
      selection_summary: selectionSummary,
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      debug_summary: formatDebugFlagSummary(options.debug_flags),
      hint: [
        `Speed: ${movementFeet} ft (${formatFeetAsTiles(movementFeet)}).`,
        `Reachable destinations: ${reachableTiles.length}.`,
        "Green tiles = legal movement range. Gold = selected destination."
      ].join("\n")
    }),
    files: options.files || [],
    components: buildMovePreviewRows(options)
  };
}

function buildTokenSelectionRows(options) {
  const choices = options.choices || [];
  const pageInfo = paginateEntries(choices, options.page, options.page_size);
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";

  const choiceButtons = pageInfo.entries.map((choice) => ({
    type: 2,
    style: 2,
    label: choice.label.slice(0, 80),
    custom_id: buildMapButtonCustomId({
      action: `${MAP_BUTTON_ACTIONS.TOKEN_SELECT},${choice.token_choice_id}`,
      actor_id: actorId,
      instance_type: instanceType,
      instance_id: instanceId
    })
  }));

  const rows = chunkButtons(choiceButtons);
  rows.push(buildPagedNavRow([
    ...buildPageButtons({
      current_page: pageInfo.current_page,
      total_pages: pageInfo.total_pages,
      build_page_custom_id: (page) => buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.TOKEN_PAGE},${page}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }),
    {
      type: 2,
      style: 2,
      label: "Back",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.BACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ]));

  return rows.concat(buildDebugControlRows(options));
}

function buildTokenSelectionMessagePayload(options) {
  const pageInfo = paginateEntries(options.choices || [], options.page, options.page_size);
  return {
    content: options.content || buildModeSummary({
      title: "Choose your token.",
      turn_label: options.turn_label || "",
      mode_label: "Token Selection",
      debug_summary: formatDebugFlagSummary(options.debug_flags),
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : ""
    }),
    files: options.files || [],
    components: buildTokenSelectionRows(options)
  };
}

function buildSpellSelectionRows(options) {
  const spells = options.spells || [];
  const pageInfo = paginateEntries(spells, options.page, options.page_size);
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";

  const spellButtons = pageInfo.entries.map((spell) => ({
    type: 2,
    style: 2,
    label: spell.name.slice(0, 80),
    custom_id: buildMapButtonCustomId({
      action: `${MAP_BUTTON_ACTIONS.SPELL},${spell.spell_id}`,
      actor_id: actorId,
      instance_type: instanceType,
      instance_id: instanceId
    })
  }));

  const rows = chunkButtons(spellButtons);
  rows.push(buildPagedNavRow([
    ...buildPageButtons({
      current_page: pageInfo.current_page,
      total_pages: pageInfo.total_pages,
      build_page_custom_id: (page) => buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.SPELL_PAGE},${page}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }),
    {
      type: 2,
      style: 2,
      label: "Back",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.BACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ]));

  return rows.concat(buildDebugControlRows(options));
}

function buildSpellSelectionMessagePayload(options) {
  const pageInfo = paginateEntries(options.spells || [], options.page, options.page_size);
  const unsupported = Array.isArray(options.unsupported_spells) ? options.unsupported_spells : [];
  const unsupportedNames = unsupported.slice(0, 5).map((entry) => entry.name).filter(Boolean);
  return {
    content: options.content || buildModeSummary({
      title: (options.spells || []).length > 0 ? "Choose a spell." : "No supported map-mode spells.",
      turn_label: options.turn_label || "",
      mode_label: "Spell Selection",
      selection_summary: unsupported.length > 0
        ? `Hidden here: ${unsupportedNames.join(", ")}${unsupported.length > unsupportedNames.length ? ", ..." : ""}`
        : "",
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      debug_summary: formatDebugFlagSummary(options.debug_flags),
      hint: unsupported.length > 0 && (options.spells || []).length > 0
        ? "Only spells whose targeting metadata is understood by the map-system interpreter are shown here."
        : ""
    }),
    files: options.files || [],
    components: buildSpellSelectionRows(options)
  };
}

function buildAttackPreviewMessagePayload(options) {
  const validTargets = options.valid_targets || [];
  const invalidTargets = Array.isArray(options.invalid_targets) ? options.invalid_targets : [];
  const pageInfo = paginateEntries(validTargets, options.page, options.page_size);
  const selectedTargetId = options.selected_target_id || "";
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const selectedTarget = validTargets.find((entry) => String(entry.token_id) === String(selectedTargetId));
  const selectedSummary = selectedTarget
    ? [
        `${getTargetDisplayLabel(selectedTarget)} | legal`,
        Number.isFinite(Number(selectedTarget.distance_feet)) ? `${Number(selectedTarget.distance_feet)} ft` : "",
        `Cover ${formatCoverLabel(selectedTarget.cover)}`,
        "LOS clear",
        selectedTarget.range_band === "long" ? "Long range" : ""
      ].filter(Boolean).join(" | ")
    : "No attack target selected yet.";

  const targetButtons = pageInfo.entries.map((target) => ({
    type: 2,
    style: selectedTargetId === target.token_id ? 1 : 2,
    label: getTargetDisplayLabel(target).slice(0, 80),
    custom_id: buildMapButtonCustomId({
      action: `${MAP_BUTTON_ACTIONS.ATTACK_TARGET},${target.token_id}`,
      actor_id: actorId,
      instance_type: instanceType,
      instance_id: instanceId
    })
  }));

  const rows = chunkButtons(targetButtons);
  rows.push(buildPagedNavRow([
    ...buildPageButtons({
      current_page: pageInfo.current_page,
      total_pages: pageInfo.total_pages,
      build_page_custom_id: (page) => buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.ATTACK_PAGE},${page}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }),
    {
      type: 2,
      style: 4,
      label: "Confirm Attack",
      disabled: !selectedTargetId,
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.ATTACK_CONFIRM,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 2,
      label: "Back",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.BACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ]));

  const invalidSummary = invalidTargets.length > 0
    ? `Unavailable: ${invalidTargets
      .slice(0, 3)
      .map((entry) => `${getTargetDisplayLabel(entry)} (${entry.reason_summary || "illegal"})`)
      .join(", ")}${invalidTargets.length > 3 ? ", ..." : ""}`
    : "";

  return {
    content: options.content || buildModeSummary({
      title: "Attack",
      turn_label: options.turn_label || "",
      mode_label: "Attack Preview",
      weapon_summary: getWeaponSummary(options.attack_profile),
      selection_summary: selectedSummary,
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      debug_summary: formatDebugFlagSummary(options.debug_flags),
      hint: [
        buildTargetListSummary("Legal targets", validTargets, (entry) => getTargetDisplayLabel(entry)),
        invalidSummary,
        "Red tiles = legal attack targets. Gold = selected target.",
        "You can also type `attack token-id` or `attack x,y`."
      ].filter(Boolean).join("\n")
    }),
    files: options.files || [],
    components: rows.concat(buildDebugControlRows(options))
  };
}

function buildSpellPreviewMessagePayload(options) {
  const validTargets = options.valid_targets || [];
  const invalidTargets = Array.isArray(options.invalid_targets) ? options.invalid_targets : [];
  const validTargetTiles = Array.isArray(options.valid_target_tiles) ? options.valid_target_tiles : [];
  const invalidTargetTileSummary = Array.isArray(options.invalid_target_tile_summary)
    ? options.invalid_target_tile_summary
    : [];
  const useTileButtons = validTargetTiles.length > 0;
  const pageInfo = paginateEntries(useTileButtons ? validTargetTiles : validTargets, options.page, options.page_size);
  const spellName = options.spell_name || "Spell";
  const selectedTargets = options.selected_targets || [];
  const targetPosition = options.target_position || null;
  const canConfirm = options.can_confirm === true;
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const selectionCounts = selectedTargets.reduce((accumulator, tokenId) => {
    const safeTokenId = String(tokenId);
    accumulator[safeTokenId] = (accumulator[safeTokenId] || 0) + 1;
    return accumulator;
  }, {});
  const affectedUnits = Array.isArray(options.affected_units) ? options.affected_units : [];
  const spellShapeLabel = formatSpellShapeLabel(options);
  const spellRangeSummary = [
    options.spell_name || "Spell",
    options.range_feet > 0 ? `Range ${options.range_feet} ft` : "Range self",
    spellShapeLabel
  ].filter(Boolean).join(" | ");
  const selectionSummary = buildSpellSelectionSummary(options);
  const targetCountSummary = buildSpellSelectionCountSummary(options);
  const targetSummary = options.self_centered_area === true || ["self", "utility"].includes(String(options.spell_shape || "").toLowerCase())
    ? ""
    : (useTileButtons
      ? buildTargetListSummary("Legal target points", validTargetTiles, (entry) => formatCoordinateLabel(entry))
      : buildTargetListSummary("Legal targets", validTargets, (entry) => getTargetDisplayLabel(entry)));
  const invalidTargetSummary = invalidTargets.length > 0
    ? `Unavailable: ${invalidTargets
      .slice(0, 3)
      .map((entry) => `${getTargetDisplayLabel(entry)} (${entry.reason_summary || "illegal"})`)
      .join(", ")}${invalidTargets.length > 3 ? ", ..." : ""}`
    : "";
  const affectedUnitLabels = affectedUnits
    .map((entry) => typeof entry === "string" ? cleanText(entry, "") : getTargetDisplayLabel(entry))
    .filter(Boolean);
  const invalidTileSummary = invalidTargetTileSummary.length > 0
    ? `Unavailable points: ${invalidTargetTileSummary
      .map((entry) => `${entry.count} ${entry.label}`)
      .join(", ")}`
    : "";

  const targetButtons = pageInfo.entries.map((target) => {
    if (useTileButtons) {
      const targetLabel = formatCoordinateLabel(target);
      return {
        type: 2,
        style: targetPosition && targetLabel === formatCoordinateLabel(targetPosition) ? 1 : 2,
        label: targetLabel.slice(0, 80),
        custom_id: buildMapButtonCustomId({
          action: `${MAP_BUTTON_ACTIONS.SPELL_TARGET_TILE},${options.spell_id || "unknown"},${Math.floor(Number(target.x))},${Math.floor(Number(target.y))}`,
          actor_id: actorId,
          instance_type: instanceType,
          instance_id: instanceId
        })
      };
    }

    const targetCount = selectionCounts[String(target.token_id)] || 0;
    return {
      type: 2,
        style: targetCount > 0 ? 1 : 2,
      label: `${getTargetDisplayLabel(target).slice(0, 70)}${targetCount > 1 ? ` x${targetCount}` : ""}`.slice(0, 80),
      custom_id: buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.SPELL_TARGET_TOKEN},${options.spell_id || "unknown"},${target.token_id}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    };
  });

  const rows = chunkButtons(targetButtons);
  rows.push(buildPagedNavRow([
    ...buildPageButtons({
      current_page: pageInfo.current_page,
      total_pages: pageInfo.total_pages,
      include_label: options.show_clear_button !== true,
      build_page_custom_id: (page) => buildMapButtonCustomId({
        action: `${useTileButtons ? MAP_BUTTON_ACTIONS.SPELL_TARGET_TILE_PAGE : MAP_BUTTON_ACTIONS.SPELL_TARGET_PAGE},${options.spell_id || "unknown"},${page}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }),
    options.show_clear_button === true ? {
      type: 2,
      style: 2,
      label: "Clear",
      custom_id: buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.SPELL_CLEAR_TARGETS},${options.spell_id || "unknown"}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    } : null,
    {
      type: 2,
      style: 1,
      label: "Confirm Spell",
      disabled: canConfirm !== true,
      custom_id: buildMapButtonCustomId({
        action: `${MAP_BUTTON_ACTIONS.SPELL_CONFIRM},${options.spell_id || "unknown"}`,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    },
    {
      type: 2,
      style: 2,
      label: "Back",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.BACK,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ]));

  return {
    content: options.content || buildModeSummary({
      title: spellName,
      turn_label: options.turn_label || "",
      mode_label: "Spell Preview",
      spell_summary: spellRangeSummary,
      selection_summary: [selectionSummary, targetCountSummary].filter(Boolean).join(" | "),
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      debug_summary: formatDebugFlagSummary(options.debug_flags),
      hint: [
        targetSummary,
        invalidTargetSummary,
        invalidTileSummary,
        affectedUnitLabels.length > 0 ? `Affected units: ${affectedUnitLabels.join(", ")}` : (targetPosition ? "Affected units: none" : ""),
        useTileButtons
          ? "Blue tiles = spell range. Purple = spell area. Gold = selected target point."
          : (options.self_centered_area === true ? "Blue tiles = spell range. Purple = spell area." : "Blue tiles = spell range. Gold = selected target."),
        buildSpellTargetingInstruction(options)
      ].filter(Boolean).join("\n")
    }),
    files: options.files || [],
    components: rows.concat(buildDebugControlRows(options))
  };
}

module.exports = {
  PAGE_SIZE,
  paginateEntries,
  buildMapActionRow,
  buildMapActionRows,
  buildMapMessagePayload,
  buildMapMessageEditPayload,
  buildMovePreviewMessagePayload,
  buildTokenSelectionRows,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionRows,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
};

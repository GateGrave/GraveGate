"use strict";

const { MAP_BUTTON_ACTIONS, buildMapButtonCustomId } = require("./map-ui.contract");

const PAGE_SIZE = 20;

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
      label: "Item",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.ITEM,
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
    },
    {
      type: 2,
      style: 2,
      label: "End Turn",
      custom_id: buildMapButtonCustomId({
        action: MAP_BUTTON_ACTIONS.END_TURN,
        actor_id: actorId,
        instance_type: instanceType,
        instance_id: instanceId
      })
    }
  ];
}

function buildMapActionRows(options) {
  return chunkButtons(buildMapActionRow(options));
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

function buildMapMessagePayload(options) {
  return {
    content: buildContentLines([
      options.content || "Map ready.",
      options.turn_label ? `Turn: ${options.turn_label}` : "",
      options.mode_label ? `Mode: ${options.mode_label}` : ""
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
      options.mode_label ? `Mode: ${options.mode_label}` : ""
    ]),
    files: options.files || [],
    components: buildMapActionRows(options)
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

  return rows;
}

function buildTokenSelectionMessagePayload(options) {
  const pageInfo = paginateEntries(options.choices || [], options.page, options.page_size);
  return {
    content: options.content || buildModeSummary({
      title: "Choose your token.",
      turn_label: options.turn_label || "",
      mode_label: "Token Selection",
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

  return rows;
}

function buildSpellSelectionMessagePayload(options) {
  const pageInfo = paginateEntries(options.spells || [], options.page, options.page_size);
  return {
    content: options.content || buildModeSummary({
      title: "Choose a spell.",
      turn_label: options.turn_label || "",
      mode_label: "Spell Selection",
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : ""
    }),
    files: options.files || [],
    components: buildSpellSelectionRows(options)
  };
}

function buildAttackPreviewMessagePayload(options) {
  const validTargets = options.valid_targets || [];
  const pageInfo = paginateEntries(validTargets, options.page, options.page_size);
  const selectedTargetId = options.selected_target_id || "";
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const targetSummary = validTargets.length > 0
    ? `Valid attack targets: ${validTargets.map((entry) => entry.token_id).join(", ")}`
    : "No valid attack targets in range.";
  const selectedSummary = selectedTargetId
    ? `Selected target: ${selectedTargetId}`
    : "No attack target selected yet.";

  const targetButtons = pageInfo.entries.map((target) => ({
    type: 2,
    style: selectedTargetId === target.token_id ? 1 : 2,
    label: String(target.token_id).slice(0, 80),
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

  return {
    content: options.content || buildModeSummary({
      title: "Attack",
      turn_label: options.turn_label || "",
      mode_label: "Attack Preview",
      weapon_summary: getWeaponSummary(options.attack_profile),
      selection_summary: getAttackRangeSummary(options.attack_profile, selectedTargetId, validTargets) || selectedSummary.replace(/^Selected target:\s*/, ""),
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      hint: `${targetSummary}\nYou can also type \`attack token-id\` or \`attack x,y\`.`
    }),
    files: options.files || [],
    components: rows
  };
}

function buildSpellPreviewMessagePayload(options) {
  const validTargets = options.valid_targets || [];
  const pageInfo = paginateEntries(validTargets, options.page, options.page_size);
  const spellName = options.spell_name || "Spell";
  const selectedTargets = options.selected_targets || [];
  const targetPosition = options.target_position || null;
  const canConfirm = options.can_confirm === true;
  const actorId = options.actor_id || "unknown";
  const instanceType = options.instance_type || "combat";
  const instanceId = options.instance_id || "unknown";
  const targetSummary = validTargets.length > 0
    ? `Valid targets: ${validTargets.map((entry) => entry.token_id).join(", ")}`
    : "No valid targets in range.";
  const selectionCounts = selectedTargets.reduce((accumulator, tokenId) => {
    const safeTokenId = String(tokenId);
    accumulator[safeTokenId] = (accumulator[safeTokenId] || 0) + 1;
    return accumulator;
  }, {});
  const selectionSummaryText = Object.keys(selectionCounts).length > 0
    ? Object.entries(selectionCounts).map(([tokenId, count]) => `${tokenId}${count > 1 ? ` x${count}` : ""}`).join(", ")
    : "";
  const selectedSummary = selectedTargets.length > 0
    ? `Selected target${selectedTargets.length === 1 ? "" : "s"}: ${selectionSummaryText}`
    : (targetPosition ? `Selected tile: ${targetPosition.x},${targetPosition.y}` : "No spell target selected yet.");
  const targetCountSummary = Number.isFinite(options.max_targets)
    ? `Selections: ${selectedTargets.length}/${options.max_targets}`
    : "";
  const tilePrompt = "For tile-targeted spells, type `target x,y` or `cast spell-name at x,y`.";

  const targetButtons = pageInfo.entries.map((target) => {
    const targetCount = selectionCounts[String(target.token_id)] || 0;
    return {
      type: 2,
      style: targetCount > 0 ? 1 : 2,
      label: `${String(target.token_id).slice(0, 70)}${targetCount > 1 ? ` x${targetCount}` : ""}`.slice(0, 80),
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
        action: `${MAP_BUTTON_ACTIONS.SPELL_TARGET_PAGE},${options.spell_id || "unknown"},${page}`,
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
      spell_summary: options.spell_shape
        ? `${spellName} (${options.spell_shape}${options.area_size_feet ? ` ${options.area_size_feet} ft` : ""})`
        : spellName,
      selection_summary: [selectedSummary, targetCountSummary].filter(Boolean).join(" | "),
      page_summary: pageInfo.total_pages > 1 ? `Page ${pageInfo.current_page}/${pageInfo.total_pages}` : "",
      hint: `${targetSummary}\n${tilePrompt}`
    }),
    files: options.files || [],
    components: rows
  };
}

module.exports = {
  PAGE_SIZE,
  paginateEntries,
  buildMapActionRow,
  buildMapActionRows,
  buildMapMessagePayload,
  buildMapMessageEditPayload,
  buildTokenSelectionRows,
  buildTokenSelectionMessagePayload,
  buildSpellSelectionRows,
  buildSpellSelectionMessagePayload,
  buildAttackPreviewMessagePayload,
  buildSpellPreviewMessagePayload
};

"use strict";

const { finalizeCharacterProfile } = require("../flow/applyCharacterSelections");

function buildBaseProfile(id, name) {
  return {
    character_id: id,
    name,
    stats: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10
    }
  };
}

function runSmoke() {
  const cases = [
    {
      label: "human_fighter",
      base: buildBaseProfile("smoke-001", "Human Fighter"),
      selections: { race_id: "human", class_id: "fighter" }
    },
    {
      label: "hill_dwarf_cleric",
      base: buildBaseProfile("smoke-002", "Hill Dwarf Cleric"),
      selections: { race_id: "dwarf", race_option_id: "hill_dwarf", class_id: "cleric", class_option_id: "life_domain" }
    },
    {
      label: "red_dragonborn_sorcerer",
      base: buildBaseProfile("smoke-003", "Red Dragonborn Sorcerer"),
      selections: {
        race_id: "dragonborn",
        race_option_id: "red",
        class_id: "sorcerer",
        class_option_id: "draconic_bloodline"
      }
    },
    {
      label: "wood_elf_ranger",
      base: buildBaseProfile("smoke-004", "Wood Elf Ranger"),
      selections: { race_id: "elf", race_option_id: "wood_elf", class_id: "ranger", class_option_id: "hunter" }
    }
  ];

  const output = {
    ok: true,
    event_type: "assembled_character_profile_smoke_completed",
    payload: {
      cases: []
    },
    error: null
  };

  for (let i = 0; i < cases.length; i += 1) {
    const row = cases[i];
    const out = finalizeCharacterProfile(row.base, row.selections);
    output.payload.cases.push({
      label: row.label,
      ok: out.ok,
      event_type: out.event_type,
      error: out.error,
      profile: out.ok ? out.payload.character_profile : null
    });
    if (!out.ok) {
      output.ok = false;
      output.error = "one_or_more_smoke_profiles_failed";
    }
  }

  return output;
}

if (require.main === module) {
  const summary = runSmoke();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

module.exports = {
  runSmoke
};


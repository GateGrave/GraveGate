"use strict";

// Persistent spell progression references.
// Stores slot tables and unlock references, not spell resolution logic.
const spellProgressionReferencesStoreShape = {
  character_id: "string",
  caster_type: "full | half | third | pact | none",
  spellcasting_ability: "string | null",
  unlocked_spell_level_cap: "number",
  spell_slot_table_ref: "string | null",
  known_spell_count: "number",
  prepared_spell_count: "number",
  progression_ref_notes: "string"
};

module.exports = {
  spellProgressionReferencesStoreShape
};

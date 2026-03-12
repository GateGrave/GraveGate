"use strict";

// Spell list references for known/prepared spells.
// This file stores references only, not full spell rule text.
const spellListReferencesModel = {
  spellcasting_ability: "string | null",
  known_spell_refs: ["string"],
  prepared_spell_refs: ["string"],
  spell_list_sources: ["class | subclass | feat | race"]
};

const exampleSpellListReferences = {
  spellcasting_ability: "intelligence",
  known_spell_refs: ["magic_missile", "shield", "detect_magic", "misty_step"],
  prepared_spell_refs: ["magic_missile", "shield", "misty_step"],
  spell_list_sources: ["class", "feat"]
};

module.exports = {
  spellListReferencesModel,
  exampleSpellListReferences
};

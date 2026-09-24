/**
 * A minimal, purpose-built reader for the parts of an English Wiktionary page we
 * need for curation: which *senses* a word has (part of speech), what each means
 * (a gloss, to tell two senses of the same part of speech apart), and which language
 * each sense came from (the donor templates).
 *
 * Why this exists: the etymology data the bank is built from (etymology-db) records
 * relations per word, not per sense, so `back` arrives as one pile containing both the
 * inherited word and the French loan. Wiktionary knows the difference — it is written
 * as etymology sections with part-of-speech sub-sections — and a page is small enough
 * to fetch per word. Nothing is bulk-copied: the tool fetches a page only for a word a
 * curator is working on, and keeps only these three facts.
 *
 * The parser is deliberately forgiving. Wikitext is not a format you can be strict
 * about: levels vary between pages, some pages have no etymology headers at all, and
 * templates take both positional and named arguments.
 */

/** Parts of speech Wiktionary uses for English, lowercased. */
const POS_NAMES = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "article",
  "numeral",
  "particle",
  "phrase",
  "proverb",
  "contraction",
  "proper noun",
  "symbol",
  "letter",
  "punctuation",
  "prefix",
  "suffix",
  "circumfix",
  "infix",
  "interfix",
  "root",
  "abbreviation",
  "initialism",
  "acronym",
  "postposition",
];

/** Templates that state where a word came from. */
const DONOR_TEMPLATES =
  /^\{\{\s*(inh|bor|der|bor\+|inh\+|der\+|slbor|ubor|learned borrowing|learned|calque|clq|borrowed|derived|inherited|etyl)\s*(\||\}\})/i;

export interface WiktionarySense {
  /** Etymological section as written, e.g. "Etymology 1" ("" when the page has none). */
  etymology: string;
  /** Lowercased part of speech, e.g. "noun". */
  pos: string;
  /** First definition, wikitext stripped. Empty when the page gives no gloss. */
  gloss: string;
  /** Donor language codes in the order the etymology names them, e.g. ["enm", "ang"]. */
  donors: string[];
}

/** Undo the markup that would otherwise leak into a gloss or a donor name. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\{\{[^{}]*\}\}/g, " ") // templates: labels, qualifiers, references
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[page|display]] -> display
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[page]] -> page
    .replace(/'''?/g, "")
    .replace(/<ref[^>]*>.*?<\/ref>/gs, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a page into its level-2 language sections. */
function languageSections(wikitext: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "";
  for (const line of wikitext.split("\n")) {
    const header = /^==\s*([^=]+?)\s*==\s*$/.exec(line);
    if (header) {
      current = (header[1] ?? "").trim();
      sections.set(current, "");
      continue;
    }
    if (current) sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
  }
  return sections;
}

/** Split a section into its subsections of a given header level. */
function subsections(body: string, level: 3 | 4): Array<{ label: string; body: string }> {
  const marks = level === 3 ? "===" : "====";
  const pattern = new RegExp(`^${marks}\\s*([^=]+?)\\s*${marks}\\s*$`);
  const parts: Array<{ label: string; body: string }> = [];
  let label = "";
  let buffer = "";
  for (const line of body.split("\n")) {
    const header = pattern.exec(line);
    if (header) {
      if (label || buffer.trim()) parts.push({ label, body: buffer });
      label = (header[1] ?? "").trim();
      buffer = "";
      continue;
    }
    buffer += `${line}\n`;
  }
  if (label || buffer.trim()) parts.push({ label, body: buffer });
  return parts;
}

/**
 * The donor language codes an etymology paragraph names, in order.
 *
 * Direction matters: `{{inh|en|enm|bak}}` says English inherited from Middle English,
 * while a template naming English as the SOURCE belongs to some other language's
 * section. Only templates borrowing INTO English are etymons of the word we are
 * curating, so those are the only ones kept.
 */
export function donorCodes(etymologyText: string): string[] {
  const codes: string[] = [];
  for (const line of etymologyText.split("\n")) {
    for (const template of line.match(/\{\{[^{}]*\}\}/g) ?? []) {
      if (!DONOR_TEMPLATES.test(template)) continue;
      const args = template.replace(/^\{\{|\}\}$/g, "").split("|").slice(1);
      // Both shapes occur: `{{inh|en|enm|bak}}` and `{{inh|1=en|2=enm|3=bak}}`.
      const positional: string[] = [];
      const named = new Map<string, string>();
      for (const arg of args) {
        const eq = arg.indexOf("=");
        if (eq > 0) named.set(arg.slice(0, eq).trim(), arg.slice(eq + 1).trim());
        else positional.push(arg.trim());
      }
      const target = (named.get("1") ?? positional[0] ?? "").toLowerCase();
      const source = (named.get("2") ?? positional[1] ?? "").toLowerCase();
      if (!source || source === target) continue;
      if (target !== "en" && target !== "english") continue;
      if (!/^[a-z][a-z0-9-]{0,11}$/.test(source)) continue;
      if (!codes.includes(source)) codes.push(source);
    }
  }
  return codes;
}

function isPos(label: string): boolean {
  const clean = label.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
  return POS_NAMES.includes(clean);
}

function firstGloss(body: string): string {
  for (const line of body.split("\n")) {
    const match = /^#\s+(?!#|:|\*)(.*)$/.exec(line);
    if (!match) continue;
    const gloss = stripMarkup(match[1] ?? "");
    if (gloss) return gloss;
  }
  return "";
}

/**
 * Every sense of an English word, as (etymology, part of speech) pairs.
 *
 * A single etymology section can carry several parts of speech, and Wiktionary marks
 * them as sibling sub-sections under it: for `back`, "Etymology 1" holds Adjective,
 * Adverb, Noun and Verb, and "Etymology 2" holds another Noun. The pair is therefore
 * the unit a curator works on: it is what has one gloss and one donor.
 */
export function parseEnglishSenses(wikitext: string): WiktionarySense[] {
  const english = languageSections(wikitext).get("English");
  if (!english) return [];
  const sections = subsections(english, 3);
  const etymologies = sections.filter((section) => /^etymolog/i.test(section.label));

  if (etymologies.length === 0) {
    // Pages without etymology sub-sections: the parts of speech are level-3 sections
    // in their own right, and any etymology section that IS there applies to the
    // senses that follow it. (`money` is written this way.)
    const senses: WiktionarySense[] = [];
    let etymology = "";
    let donors: string[] = [];
    for (const section of sections) {
      if (/^etymolog/i.test(section.label)) {
        etymology = section.label;
        donors = donorCodes(section.body);
        continue;
      }
      if (!isPos(section.label)) continue;
      senses.push({
        etymology,
        pos: normalisePos(section.label),
        gloss: firstGloss(section.body),
        donors,
      });
    }
    return senses;
  }

  const senses: WiktionarySense[] = [];
  for (const chunk of etymologies) {
    // Donors live in the etymology prose, which sits before the first POS header.
    const parts = subsections(chunk.body, 4);
    const firstPos = parts.findIndex((part) => isPos(part.label));
    const prose = firstPos <= 0 ? chunk.body : parts.slice(0, firstPos).map((p) => p.body).join("\n");
    const donors = donorCodes(prose);
    for (const part of parts.filter((candidate) => isPos(candidate.label))) {
      senses.push({
        etymology: chunk.label,
        pos: normalisePos(part.label),
        gloss: firstGloss(part.body),
        donors,
      });
    }
  }
  if (senses.length > 0) return senses;

  // An etymology section can exist while the parts of speech are level-3 siblings of
  // it rather than level-4 children (`money` is written this way), so fall back to
  // reading the sections in order, carrying each etymology's donors forward.
  let etymology = "";
  let donors: string[] = [];
  for (const section of sections) {
    if (/^etymolog/i.test(section.label)) {
      etymology = section.label;
      donors = donorCodes(section.body);
      continue;
    }
    if (!isPos(section.label)) continue;
    senses.push({
      etymology,
      pos: normalisePos(section.label),
      gloss: firstGloss(section.body),
      donors,
    });
  }
  return senses;
}

function normalisePos(label: string): string {
  return label.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
}

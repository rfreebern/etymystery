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

/**
 * Templates that mark the register of a sense: `{{lb|en|obsolete}}`, or `{{tlb|en|literary}}`
 * for the inline variant. `okra` and `tsetse` carry none; `musard` is `{{tlb|en|literary}}`,
 * which is the reason a player had never met that word.
 */
const LABEL_TEMPLATES = /^\{\{\s*(lb|tlb|label|lbl)\s*(\||\}\})/i;

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
  /**
   * Register labels per definition line in this section, in order: `[[]]` for an ordinary
   * current sense, `[["literary"]]` for `musard`, and `[["obsolete"], []]` for a word like
   * `disparage` that carries an obsolete sense and a current one.
   */
  definitionLabels: string[][];
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

/**
 * The register labels a definition line carries, lowercased.
 *
 * Both argument shapes occur (`{{lb|en|obsolete}}` and `{{lb|1=en|2=obsolete}}`), and the
 * first argument is always the language the label applies to rather than a label, so it is
 * dropped. Duplicates collapse: two templates saying "obsolete" are one label.
 */
/**
 * Words that appear among a label template's arguments but are not labels themselves:
 * Wiktionary writes `{{lb|en|archaic|or|historical}}` to mean "archaic or historical".
 */
const LABEL_CONNECTIVES = new Set(["or", "and", "sometimes", "chiefly", "now", "usually", "especially", "broadly"]);

export function senseLabels(definitionLine: string): string[] {
  const labels: string[] = [];
  for (const template of definitionLine.match(/\{\{[^{}]*\}\}/g) ?? []) {
    if (!LABEL_TEMPLATES.test(template)) continue;
    const args = template.replace(/^\{\{|\}\}$/g, "").split("|").slice(1);
    const positional: string[] = [];
    const named = new Map<string, string>();
    for (const arg of args) {
      const eq = arg.indexOf("=");
      if (eq > 0) named.set(arg.slice(0, eq).trim(), arg.slice(eq + 1).trim());
      else positional.push(arg.trim());
    }
    const values = [
      ...positional.slice(1),
      ...[...named.entries()].filter(([key]) => key !== "1").map(([, value]) => value),
    ];
    for (const value of values) {
      const label = value.toLowerCase();
      if (label && !LABEL_CONNECTIVES.has(label) && !labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}
function isPos(label: string): boolean {
  const clean = label.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
  return POS_NAMES.includes(clean);
}

/**
 * The first definition line of a part-of-speech section: its gloss, and the register
 * labels written on that same line. They come from one place because that is how
 * Wiktionary marks a sense: `# {{tlb|en|literary}} A dreamer; an absent-minded person.`
 */
/**
 * A part-of-speech section's definitions: the gloss of the first, and the register labels
 * of EVERY definition line in the section.
 *
 * All of them, not just the first, because that is the question the bank has to answer:
 * does this part of speech still have a sense in current use? Wiktionary gives `disparage`
 * an obsolete first sense and an ordinary second one, and reading only the first would
 * condemn a word in daily use.
 */
function firstDefinition(body: string): { gloss: string; definitionLabels: string[][] } {
  let gloss = "";
  const definitionLabels: string[][] = [];
  for (const line of body.split("\n")) {
    const match = /^#\s+(?!#|:|\*)(.*)$/.exec(line);
    if (!match) continue;
    const definition = match[1] ?? "";
    definitionLabels.push(senseLabels(definition));
    if (!gloss) gloss = stripMarkup(definition);
  }
  // A section with no definition lines at all still needs a gloss field, and an empty
  // list of labels says "nothing was read", which is what the register rule expects.
  return { gloss: gloss || "", definitionLabels };
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
        ...firstDefinition(section.body),
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
        ...firstDefinition(part.body),
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
      ...firstDefinition(section.body),
      donors,
    });
  }
  // Still nothing: the parts of speech are nested under something else entirely, so
  // fall back to reading the page in order.
  return senses.length > 0 ? senses : linearSenses(english);
}

/**
 * Last-resort reader: walk the English section in document order and use only the
 * ORDER of headers, ignoring their levels.
 *
 * Two shapes defeat the level-based readers above, and both are common: `abstract`
 * puts its parts of speech under `===Pronunciation 1===` rather than directly under
 * the etymology, and `money` has them as level-3 siblings of it. In document order the
 * information is unambiguous - donors come from the most recent etymology header,
 * senses from every part-of-speech header after it - so read the page linearly rather
 * than guessing at its levels.
 */
function linearSenses(english: string): WiktionarySense[] {
  const header = /^(={2,6})\s*([^=]+?)\s*\1\s*$/;
  const senses: WiktionarySense[] = [];
  let etymology = "";
  let donors: string[] = [];
  let previous: { label: string; isPos: boolean; isEtymology: boolean } | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!previous) return;
    if (previous.isEtymology) donors = donorCodes(buffer.join("\n"));
    else if (previous.isPos) {
      senses.push({
        etymology,
        pos: normalisePos(previous.label),
        ...firstDefinition(buffer.join("\n")),
        donors,
      });
    }
  };

  for (const line of english.split("\n")) {
    const match = header.exec(line);
    if (match) {
      flush();
      const label = (match[2] ?? "").trim();
      const isEtymology = /^etymolog/i.test(label);
      if (isEtymology) etymology = label;
      previous = { label, isPos: isPos(label), isEtymology };
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return senses;
}

function normalisePos(label: string): string {
  return label.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim();
}

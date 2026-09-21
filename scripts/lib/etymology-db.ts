/**
 * Ingest for the etymology-db dataset — https://github.com/droher/etymology-db
 * (data derived from Wiktionary, CC BY-SA 3.0; see LICENSES.md).
 *
 * Verified schema: term_id, lang, term, reltype, related_term_id,
 * related_lang, related_term, position, group_tag, parent_tag, parent_position.
 */

export interface EtymEdge {
  lang: string;
  term: string;
  reltype: string;
  relatedLang: string | null;
  relatedTerm: string | null;
}

/** Streaming RFC 4180 row parser (handles quoted commas, escaped quotes, newlines). */
export function forEachCsvRow(text: string, onRow: (row: string[]) => void): void {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    if (row.length > 1 || (row[0] ?? "") !== "") onRow(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
}

/** Convenience wrapper returning the header row plus data rows. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  forEachCsvRow(text, (row) => rows.push(row));
  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...data] = rows;
  return { headers: headers!.map((h) => h.trim()), rows: data };
}

function resolveColumn(headers: string[], aliases: string[], label: string, required: boolean): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx >= 0) return idx;
  }
  if (required) {
    throw new Error(
      `etymology-db CSV is missing the "${label}" column (tried: ${aliases.join(", ")}); found: ${headers.join(", ")}`,
    );
  }
  return -1;
}

/**
 * Extract edges from etymology-db CSV text. `reltypeFilter` optionally keeps
 * only the given relation types (recommended for the full 4.2M-row dataset).
 * Header names are matched case-insensitively with fallback aliases.
 */
export function extractEdges(text: string, reltypeFilter?: ReadonlySet<string>): EtymEdge[] {
  let cols: { lang: number; term: number; reltype: number; relatedLang: number; relatedTerm: number } | null = null;
  const edges: EtymEdge[] = [];
  forEachCsvRow(text, (row) => {
    if (!cols) {
      const headers = row.map((h) => h.trim());
      cols = {
        lang: resolveColumn(headers, ["lang", "language"], "lang", true),
        term: resolveColumn(headers, ["term"], "term", true),
        reltype: resolveColumn(headers, ["reltype", "relation", "relation_type"], "reltype", true),
        relatedLang: resolveColumn(headers, ["related_lang", "related_language"], "related_lang", false),
        relatedTerm: resolveColumn(headers, ["related_term"], "related_term", false),
      };
      return;
    }
    const get = (idx: number): string => (idx >= 0 ? (row[idx] ?? "").trim() : "");
    const lang = get(cols.lang);
    const term = get(cols.term);
    const reltype = get(cols.reltype);
    if (!lang || !term || !reltype) return;
    if (reltypeFilter && !reltypeFilter.has(reltype)) return;
    edges.push({
      lang,
      term,
      reltype,
      relatedLang: cols.relatedLang >= 0 ? get(cols.relatedLang) || null : null,
      relatedTerm: cols.relatedTerm >= 0 ? get(cols.relatedTerm) || null : null,
    });
  });
  if (!cols) throw new Error("etymology-db CSV is empty (no header row found)");
  return edges;
}

/**
 * Relation types that identify a genuine donor-language event, ordered by
 * preference (0 = clearest geographic signal). Formation relations
 * (has_suffix, compound_of, ...) and non-directional relations (cognate_of,
 * doublet_with) are intentionally excluded from chain building.
 */
export const DONOR_RELATION_PRIORITY: Record<string, number> = {
  learned_borrowing_from: 0,
  borrowed_from: 0,
  unadapted_borrowing_from: 0,
  orthographic_borrowing_from: 0,
  semi_learned_borrowing_from: 0,
  inherited_from: 1,
  derived_from: 2,
};

/** Terms that make good puzzle words: lowercase single words of 3+ letters. */
export function isCandidateTerm(term: string): boolean {
  return /^[a-z][a-z'-]{2,}$/.test(term);
}

export interface OriginChain {
  term: string;
  /** Donor language codes, immediate donor first, most distant last. */
  chainLangs: string[];
  /** Relation priority of the immediate-donor edge (lower = more geographic). */
  firstPriority: number;
}

export interface BuildChainsOptions {
  /** Source-language code, default "en". */
  englishLangCode?: string;
  /** Maximum chain length (immediate donor + further hops), default 3. */
  maxDepth?: number;
}

/**
 * Build English-word origin chains by walking the edge graph outward from
 * each English entry, preferring the clearest borrowing relations. Cycles
 * are pruned; the best chain per word (most geographic, then deepest) wins.
 */
export function buildChains(edges: EtymEdge[], options: BuildChainsOptions = {}): Map<string, OriginChain> {
  const english = options.englishLangCode ?? "en";
  const maxDepth = Math.max(1, options.maxDepth ?? 3);

  const byLangTerm = new Map<string, EtymEdge[]>();
  for (const edge of edges) {
    if (!(edge.reltype in DONOR_RELATION_PRIORITY)) continue;
    if (!edge.relatedLang || !edge.relatedTerm) continue;
    if (edge.relatedLang === edge.lang && edge.relatedTerm.toLowerCase() === edge.term.toLowerCase()) continue;
    const key = `${edge.lang}\u0000${edge.term.toLowerCase()}`;
    const list = byLangTerm.get(key);
    if (list) list.push(edge);
    else byLangTerm.set(key, [edge]);
  }
  for (const list of byLangTerm.values()) {
    list.sort(
      (a, b) =>
        DONOR_RELATION_PRIORITY[a.reltype]! - DONOR_RELATION_PRIORITY[b.reltype]! ||
        a.relatedLang!.localeCompare(b.relatedLang!) ||
        a.relatedTerm!.localeCompare(b.relatedTerm!),
    );
  }

  const chains = new Map<string, OriginChain>();
  for (const edge of edges) {
    if (edge.lang !== english) continue;
    if (!(edge.reltype in DONOR_RELATION_PRIORITY)) continue;
    if (!edge.relatedLang || !edge.relatedTerm) continue;
    if (edge.relatedLang === english) continue;
    if (!isCandidateTerm(edge.term)) continue;

    const chainLangs = [edge.relatedLang];
    let currentKey = `${edge.relatedLang}\u0000${edge.relatedTerm.toLowerCase()}`;
    const visited = new Set<string>([`${english}\u0000${edge.term.toLowerCase()}`]);
    for (let depth = 1; depth < maxDepth; depth++) {
      if (visited.has(currentKey)) break;
      visited.add(currentKey);
      const next = byLangTerm.get(currentKey)?.[0];
      if (!next?.relatedLang || !next.relatedTerm) break;
      if (next.relatedLang === english) break;
      chainLangs.push(next.relatedLang);
      currentKey = `${next.relatedLang}\u0000${next.relatedTerm.toLowerCase()}`;
    }

    const candidate: OriginChain = {
      term: edge.term,
      chainLangs,
      firstPriority: DONOR_RELATION_PRIORITY[edge.reltype]!,
    };
    const key = edge.term.toLowerCase();
    const existing = chains.get(key);
    if (!existing || isBetterChain(candidate, existing)) chains.set(key, candidate);
  }
  return chains;
}

function isBetterChain(a: OriginChain, b: OriginChain): boolean {
  if (a.firstPriority !== b.firstPriority) return a.firstPriority < b.firstPriority;
  if (a.chainLangs.length !== b.chainLangs.length) return a.chainLangs.length > b.chainLangs.length;
  return a.term < b.term;
}

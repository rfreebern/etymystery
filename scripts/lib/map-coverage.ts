/**
 * Which ISO 3166 alpha-2 countries the shipped map can actually draw.
 *
 * The 50m Natural Earth set covers 241 territories but still omits 76 small ones
 * (Tuvalu, Tokelau, Niue, Wallis and Futuna ...). An answer anchored only to one of
 * those has no outline to hit, so scoring falls back to its representative point:
 * winnable, but only by clapping near the point rather than anywhere "in the
 * country". Curation should know which entries are in that position, because it is
 * the difference between a normal puzzle and one that needs luck with the map.
 */

import { readFileSync } from "node:fs";

export function loadDrawableCountries(topojsonPath: string, countriesPath: string): Set<string> {
  const topo = JSON.parse(readFileSync(topojsonPath, "utf8")) as {
    objects: { countries: { geometries: Array<{ id?: string | number }> } };
  };
  const drawn = new Set(
    topo.objects.countries.geometries
      .map((geometry) => Number(geometry.id))
      .filter((id) => Number.isFinite(id)),
  );
  const table = JSON.parse(readFileSync(countriesPath, "utf8")) as Record<
    string,
    { ccn3?: string }
  >;
  const drawable = new Set<string>();
  for (const [code, info] of Object.entries(table)) {
    const ccn3 = Number(info.ccn3);
    if (Number.isFinite(ccn3) && drawn.has(ccn3)) drawable.add(code);
  }
  return drawable;
}

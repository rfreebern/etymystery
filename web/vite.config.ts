import { defineConfig } from "vite";

/**
 * GitHub Pages serves a project site from a subdirectory
 * (https://<user>.github.io/<repo>/), so every asset URL has to be relative to
 * the page rather than anchored at the domain root. `base: "./"` does that for
 * the bundled JS/CSS and for the files copied out of web/public.
 *
 * The client fetches its data with document-relative paths for the same reason
 * (see the boot() fetches in src/main.ts).
 */
export default defineConfig({
  base: "./",
});

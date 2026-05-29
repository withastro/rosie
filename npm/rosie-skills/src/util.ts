// String / path / small-utility helpers. Ported from src/util.rs.

import * as os from "./os.js";

// Joins `base` and `name`, stripping any trailing slashes on `base` and any
// leading slashes on `name`. Produces forward-slash separators (used when
// building lockfile sources like "npm:react#README.md"). For ordinary
// filesystem paths, prefer node:path. Mirrors util.rs::path_join.
export function pathJoin(base: string, name: string): string {
  const b = base.replace(/\/+$/, "");
  const n = name.replace(/^\/+/, "");
  if (b.length === 0) {
    return `/${n}`;
  }
  return `${b}/${n}`;
}

// Read a top-level string field from a JSON file (used to pull `version` from
// package.json). Returns undefined if the file is missing, unparseable, the
// field is absent, or the value isn't a string. Mirrors
// util.rs::read_json_string_field; JS has JSON built in, so we parse directly.
export function readJsonStringField(p: string, field: string): string | undefined {
  let contents: string;
  try {
    contents = os.readToString(p);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (parsed && typeof parsed === "object" && field in (parsed as Record<string, unknown>)) {
    const v = (parsed as Record<string, unknown>)[field];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

// Build a `<base>.tmp` path for an atomic write. Mirrors util.rs::tmp_path_for.
export function tmpPathFor(p: string): string {
  return `${p}.tmp`;
}

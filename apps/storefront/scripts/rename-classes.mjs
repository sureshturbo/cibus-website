// Renames class names in JSX to match the conventions already in styles/.
// Operates on className attribute values so spacing stays tidy.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.argv[2] ?? "src";

/** Exact-token renames, applied wherever the token appears in a class list. */
const RENAMES = {
  "visually-hidden": "sr-only",
  "section-head--row": "section__head",
  "section-head": "section__head",
  "section-title": "section__title",
  "section-sub": "lede",
  breadcrumb: "breadcrumbs",
  "page-title": "page-head__title",
  "notice--error": "notice--danger",
  "badge--muted": "badge--out",
  "btn--primary": null,
  // Copy-paste slip: this was a stock-state class used for a money figure.
  "cart-line__stock--in": "text-save",
};

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let changedFiles = 0;

for (const file of walk(root)) {
  if (extname(file) !== ".tsx") continue;

  const before = readFileSync(file, "utf8");

  const after = before.replace(/className=\{?["`]([^"`]*)["`]/g, (match, value) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const mapped = [];

    for (const token of tokens) {
      if (!(token in RENAMES)) {
        mapped.push(token);
        continue;
      }
      const replacement = RENAMES[token];
      if (replacement) mapped.push(replacement);
    }

    const deduped = [...new Set(mapped)];
    const rebuilt = deduped.join(" ");
    return match.replace(value, rebuilt);
  });

  if (after !== before) {
    writeFileSync(file, after);
    changedFiles++;
    console.log(`updated ${file}`);
  }
}

console.log(`\n${changedFiles} file(s) changed`);
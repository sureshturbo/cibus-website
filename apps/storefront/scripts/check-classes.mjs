// Reports class names used in JSX that no stylesheet defines.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.argv[2] ?? "src";

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const used = new Set();

for (const file of walk(root)) {
  if (extname(file) !== ".tsx") continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/className=\{?["`]([^"`]+)/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/.test(token)) used.add(token);
    }
  }
}

const defined = new Set();

for (const file of walk(join(root, "styles"))) {
  if (extname(file) !== ".css") continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\.(-?[_a-z][\w-]*)/g)) defined.add(match[1]);
}

const missing = [...used].filter((name) => !defined.has(name)).sort();

console.log(`used=${used.size} defined=${defined.size} missing=${missing.length}`);
for (const name of missing) console.log(`  ${name}`);
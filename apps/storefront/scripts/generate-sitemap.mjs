/**
 * Writes public/sitemap.xml from the live catalogue.
 *
 * The site is served as static files by Apache, so the sitemap has to be a
 * file too. Re-run this before a build whenever products or categories change:
 *   node scripts/generate-sitemap.mjs [https://cibus.gy]
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const origin = (process.argv[2] ?? "https://cibus.gy").replace(/\/$/, "");
const out = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));

async function get(path) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  const body = await response.json();
  return body;
}

const STATIC_PATHS = [
  "/",
  "/products",
  "/contact",
  "/page/about",
  "/page/what-we-do",
  "/page/vision",
  "/page/mission",
  "/page/privacy-policy",
];

const categories = (await get("/api/public/categories")).data;
const categoryList = Array.isArray(categories) ? categories : (categories.items ?? categories.categories ?? []);

const products = [];
for (let page = 1; ; page += 1) {
  const body = await get(`/api/public/products?page=${page}&pageSize=50&sort=name_asc`);
  products.push(...body.data);
  if (!body.meta || page >= body.meta.totalPages) break;
}

const urls = [
  ...STATIC_PATHS,
  ...categoryList.map((category) => `/products?category=${encodeURIComponent(category.slug)}`),
  ...products.map((product) => `/product/${encodeURIComponent(product.slug)}`),
];

const escape = (value) => value.replace(/&/g, "&amp;");
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((path) => `  <url><loc>${escape(origin + path)}</loc></url>`),
  "</urlset>",
  "",
].join("\n");

writeFileSync(out, xml);
console.log(`sitemap.xml: ${urls.length} URLs (${categoryList.length} categories, ${products.length} products)`);

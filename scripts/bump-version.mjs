#!/usr/bin/env node
// Stamps a new release version into index.html (import map, stylesheet, entry
// script, app-version meta) and version.json. Run before every deploy:
//   node scripts/bump-version.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const v = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // yyyymmddhhmm
const modules = [
  ...readdirSync(new URL("js/", root)).filter((f) => f.endsWith(".js")).map((f) => `./js/${f}`),
  ...readdirSync(new URL("vendor/", root)).filter((f) => f.endsWith(".js")).map((f) => `./vendor/${f}`),
].sort();
const map = JSON.stringify({ imports: Object.fromEntries(modules.map((m) => [m, `${m}?v=${v}`])) }, null, 2)
  .replace(/\n/g, "\n  ");

const file = new URL("index.html", root);
let html = readFileSync(file, "utf8");
html = html
  .replace(/<meta name="app-version" content="[^"]*">/, `<meta name="app-version" content="${v}">`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n  ${map}\n  </script>`)
  .replace(/css\/style\.css(\?v=[^"]*)?"/, `css/style.css?v=${v}"`)
  .replace(/src="js\/app\.js(\?v=[^"]*)?"/, `src="js/app.js?v=${v}"`);
writeFileSync(file, html);
writeFileSync(new URL("version.json", root), JSON.stringify({ v }) + "\n");
console.log("version", v);

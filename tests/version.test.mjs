import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const v = /<meta name="app-version" content="([^"]+)">/.exec(html)?.[1];

test("index.html and version.json carry the same release version", () => {
  assert.ok(v, "app-version meta missing");
  const json = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
  assert.equal(json.v, v, "run: node scripts/bump-version.mjs");
});

test("every script is versioned in the import map (no stale cached modules)", () => {
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  const files = [
    ...readdirSync(new URL("../js/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `./js/${f}`),
    ...readdirSync(new URL("../vendor/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `./vendor/${f}`),
  ];
  for (const f of files) assert.equal(map[f], `${f}?v=${v}`, `${f} not versioned — run: node scripts/bump-version.mjs`);
  assert.match(html, new RegExp(`css/style\\.css\\?v=${v}"`));
  assert.match(html, new RegExp(`src="js/app\\.js\\?v=${v}"`));
});

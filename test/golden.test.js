// golden.test.js - the byte-stability gate: the committed golden C must match
// what compile() produces now (the luacretro seam can't drift under neslua).
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

test("golden-c: every fixture is byte-identical", () => {
  const out = execFileSync("node", [path.join(dir, "golden-c.mjs"), "check"], { encoding: "utf8" });
  assert.match(out, /byte-identical/);
});

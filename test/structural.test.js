// structural.test.js - build a real .nes through the CLI (bundled cc65 WASM) and
// assert the ROM structure: the iNES header, MMC1 mapper, CHR-RAM, size, and the
// vector table. This is the end-to-end "the toolchain produces a valid cart"
// gate. It needs romdev-toolchain-cc65 installed (npm install).
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(REPO, "bin", "neslua.js");
const toolchainInstalled = existsSync(
  path.join(REPO, "node_modules", "romdev-toolchain-cc65", "wasm", "cc65.js"));

test("build produces a valid iNES ROM (MMC1 + CHR-RAM, 32K PRG)", { skip: !toolchainInstalled ? "romdev-toolchain-cc65 not installed" : false }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "neslua-struct-"));
  const lua = path.join(tmp, "main.lua");
  const nes = path.join(tmp, "main.nes");
  writeFileSync(lua, `function _draw() cls(1) print("hi",8,16,7) end`);
  execFileSync("node", [CLI, "build", lua, "-o", nes], { encoding: "utf8", stdio: "pipe" });

  const rom = readFileSync(nes);
  // iNES magic
  assert.deepEqual([...rom.subarray(0, 4)], [0x4e, 0x45, 0x53, 0x1a], "NES\\x1a magic");
  assert.equal(rom[4], 2, "PRG-ROM = 2 x 16K = 32K");
  assert.equal(rom[5], 0, "CHR-ROM = 0 (CHR-RAM)");
  // flags6: mapper lo nybble = 1 (MMC1), battery + vertical mirroring bits set
  assert.equal(rom[6] & 0xF0, 0x10, "mapper lo nybble = 1 (MMC1)");
  assert.ok(rom[6] & 0x02, "battery bit set (PRG-RAM at $6000)");
  assert.equal(rom[7] & 0xF0, 0x00, "mapper hi nybble = 0 -> mapper 1");
  // total size = 16 header + 32K PRG
  assert.equal(rom.length, 16 + 32 * 1024, "16-byte header + 32K PRG");
  // vectors at the tail: NMI + RESET + IRQ words, all in ROM (nonzero NMI/RESET)
  const nmi = rom[rom.length - 6] | (rom[rom.length - 5] << 8);
  const reset = rom[rom.length - 4] | (rom[rom.length - 3] << 8);
  assert.ok(nmi >= 0x8000, "NMI vector points into PRG-ROM");
  assert.ok(reset >= 0x8000, "RESET vector points into PRG-ROM");
});

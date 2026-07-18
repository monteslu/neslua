#!/usr/bin/env node
// neslua CLI - compile a .lua game to a real NES .nes ROM.
//
//   neslua build <main.lua> [-o game.nes]     build a cartridge
//   neslua run   <main.lua|game.nes>          build + play in a window (bundled fceumm)
//   neslua c     <main.lua>                    print the generated C (debugging)
//
// Thin node adapter over the environment-agnostic pipeline in compiler/build.js.
// The cc65 toolchain runs as bundled WASM (romdev-toolchain-cc65) - zero native
// tools. Override with NESLUA_TOOLCHAIN=native to use a cc65 on PATH.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile, formatDiagnostics } from "../compiler/index.js";
import { build } from "../compiler/build.js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SDK = path.join(REPO, "sdk");

// Locate romdev-toolchain-cc65 via Node module resolution, so it works whether
// npm nested it under this SDK or HOISTED it to the consumer's top-level
// node_modules (the flattened-install case a REPO-relative path misses). The
// package exports "./wasm/*" but not "./package.json", so resolve an exported
// file and walk up. Falls back to the REPO-local path for a source checkout.
function cc65PackageDir() {
  try {
    const wasmGlue = fileURLToPath(import.meta.resolve("romdev-toolchain-cc65/wasm/cc65.js"));
    return path.dirname(path.dirname(wasmGlue));
  } catch {
    return path.join(REPO, "node_modules", "romdev-toolchain-cc65");
  }
}

function fail(msg) { console.error(msg); process.exit(1); }

// The bundled-WASM backend. cc65/ca65/ld65 run in one persistent worker holding
// the WASM for the whole build (compiler/wasm_worker.js), driven synchronously.
function wasmToolchain() {
  const share = path.join(cc65PackageDir(), "share", "cc65");
  return {
    kind: "wasm",
    cc65: ["cc65"], ca65: ["ca65"], ld65: ["ld65"],
    lib: path.join(share, "lib", "nes.lib"),
    asminc: path.join(share, "asminc"),
  };
}
function wasmToolchainInstalled() {
  return existsSync(path.join(cc65PackageDir(), "wasm", "cc65.js"));
}

function nativeToolchain(home) {
  return {
    kind: "native",
    cc65: [path.join(home, "bin", "cc65")], ca65: [path.join(home, "bin", "ca65")],
    ld65: [path.join(home, "bin", "ld65")],
    lib: path.join(home, "lib", "nes.lib"), asminc: path.join(home, "asminc"),
  };
}

function findToolchain() {
  const forced = process.env.NESLUA_TOOLCHAIN;
  if (forced === "wasm") {
    if (!wasmToolchainInstalled()) fail("NESLUA_TOOLCHAIN=wasm but romdev-toolchain-cc65 is not installed (run: npm install).");
    return wasmToolchain();
  }
  const findNative = () => {
    if (process.env.NESLUA_CC65_HOME && existsSync(path.join(process.env.NESLUA_CC65_HOME, "bin", "cc65")))
      return nativeToolchain(process.env.NESLUA_CC65_HOME);
    const probe = spawnSync("cc65", ["--version"], { encoding: "utf8" });
    if (probe.status === 0 || probe.status === 1) {
      const tp = spawnSync("cc65", ["--print-target-path"], { encoding: "utf8" });
      const targetPath = (tp.stdout || "").trim();
      const share = targetPath ? path.dirname(targetPath) : null;
      return {
        kind: "native", cc65: ["cc65"], ca65: ["ca65"], ld65: ["ld65"],
        lib: share ? path.join(share, "lib", "nes.lib") : "nes.lib",
        asminc: share ? path.join(share, "asminc") : null,
      };
    }
    return null;
  };
  if (forced === "native") {
    const n = findNative();
    if (n) return n;
    fail("NESLUA_TOOLCHAIN=native but no cc65 found (put cc65/ca65/ld65 on PATH).");
  }
  const native = findNative();
  if (native) return native;
  if (wasmToolchainInstalled()) return wasmToolchain();
  fail("No cc65 toolchain found. Run `npm install` (bundled cc65 WASM), or put cc65 on PATH.");
}

let toolchainKind = "native";
let _runToolSync = null, _closeWorker = null;

function execTool(tool, args) {
  if (toolchainKind === "wasm") return _runToolSync(tool[0], args);
  const [cmd, ...pre] = tool;
  return spawnSync(cmd, [...pre, ...args], { encoding: "utf8" });
}

async function prepareToolchain() {
  const tc = findToolchain();
  toolchainKind = tc.kind;
  if (tc.kind === "wasm" && !_runToolSync) {
    const mod = await import("../compiler/wasm_sync_client.js");
    _runToolSync = mod.runToolSync;
    _closeWorker = mod.closeWorker;
  }
  return tc;
}

function makeNodeEnv(tc, sdkDir) {
  return {
    readFile: (p) => readFileSync(p),
    readText: (p) => readFileSync(p, "utf8"),
    writeFile: (p, x) => writeFileSync(p, x),
    exists: (p) => existsSync(p),
    size: (p) => statSync(p).size,
    mkdirp: (p) => { mkdirSync(p, { recursive: true }); },
    join: (...parts) => path.join(...parts),
    dirname: (p) => path.dirname(p),
    basename: (p, ext) => path.basename(p, ext),
    extname: (p) => path.extname(p),
    sdk: sdkDir,
    sdkFile: (n) => path.join(sdkDir, n),
    runTool: (n, args) => execTool(tc[n], args),
    lib: tc.lib, asminc: tc.asminc,
    hash: (bytes) => createHash("sha1").update(bytes).digest("hex"),
    log: (m) => console.log(m),
    warn: (m) => console.error(m),
    debug: !!process.env.NESLUA_DEBUG,
  };
}

function compileLuaCli(entry) {
  const source = readFileSync(entry, "utf8");
  const result = compile(source, path.basename(entry), {});
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");
  if (warnings.length) console.error(formatDiagnostics(warnings));
  if (!result.ok) {
    console.error(formatDiagnostics(result.diagnostics.filter((d) => d.severity === "error")));
    process.exit(1);
  }
  return result;
}

async function runBuild(entry, opts) {
  if (!existsSync(entry)) fail(`no such file: ${entry}`);
  const tc = await prepareToolchain();
  const env = makeNodeEnv(tc, SDK);
  const absEntry = path.resolve(entry);
  try { await build(absEntry, opts, env); }
  catch (e) { fail(e?.message ?? String(e)); }
}

// ---- main -------------------------------------------------------------------
const [, , cmd, ...rest] = process.argv;
const flagVal = (name) => { const i = rest.indexOf(name); return i !== -1 ? rest[i + 1] : undefined; };
const entryArg = () => rest.find((a) => !a.startsWith("-") && (a === rest[0] || rest[rest.indexOf(a) - 1]?.startsWith("-") === false || !rest[rest.indexOf(a) - 1]?.startsWith("-")));

if (cmd === "build") {
  const entry = rest.filter((a, i) => !a.startsWith("-") && rest[i - 1] !== "-o")[0];
  if (!entry) fail("usage: neslua build <main.lua> [-o game.nes]");
  await runBuild(entry, { outPath: flagVal("-o") });
  if (_closeWorker) _closeWorker();
} else if (cmd === "run") {
  const entry = rest.filter((a, i) => !a.startsWith("-") && rest[i - 1] !== "-o")[0];
  if (!entry) fail("usage: neslua run <main.lua|game.nes>");
  let rom;
  if (entry.endsWith(".nes")) rom = entry;
  else {
    rom = path.join(path.dirname(path.resolve(entry)), path.basename(entry, path.extname(entry)) + ".nes");
    await runBuild(entry, { outPath: rom });
    if (_closeWorker) _closeWorker();
  }
  try {
    const { runRom } = await import("./neslua-run.mjs");
    await runRom(rom);
  } catch (e) {
    fail(`neslua run: your cart built fine (${rom}), but a window couldn't open: ${e?.message ?? e}\n` +
         "Load the .nes in any NES emulator.");
  }
} else if (cmd === "c") {
  if (!rest[0]) fail("usage: neslua c <main.lua>");
  process.stdout.write(compileLuaCli(rest[0]).c);
} else {
  fail("usage: neslua build <main.lua> [-o game.nes]\n" +
       "       neslua run   <main.lua|game.nes>   build + play in a window\n" +
       "       neslua c     <main.lua>            print the generated C");
}

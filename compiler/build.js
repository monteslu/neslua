// build.js - the neslua cart build (lua -> C -> cc65/ca65/ld65 -> .nes).
//
// Environment-agnostic: everything platform-specific (fs, path, tool spawn)
// arrives through the `env` object the CLI builds (bin/neslua.js). The same
// contract the gtlua build uses, so a web IDE could drive it too.
//
// Pipeline:
//   1. lua -> C (luacretro target:"nes"): main.lua -> build/main.c
//   2. cc65 each C unit -> .s, run the shared peephole pass, ca65 -> .o
//   3. ca65 the asm units (crt0, the fixed-point 6502 asm)
//   4. ld65 -C neslua.cfg + nes.lib -> the .nes ROM (iNES header from the crt0)

import { compile, formatDiagnostics } from "./index.js";
import { peephole } from "./peephole.js";

// run one tool; throw on nonzero status with the tool log.
function run(env, tool, args) {
  const r = env.runTool(tool, args);
  if (r.status !== 0) {
    throw new Error(`${tool} failed (status ${r.status}):\n${r.stderr || r.stdout || "(no output)"}`);
  }
  return r;
}

/**
 * Build a .nes from a Lua entry file.
 * @param {string} entry     absolute path to main.lua
 * @param {object} opts       { outPath?, mapPath? }
 * @param {object} env        fs/path/tool primitives (see bin/neslua.js)
 */
export async function build(entry, opts, env) {
  const { outPath } = opts;
  const SDK = env.sdk;
  const projDir = env.dirname(entry);
  const buildDir = env.join(projDir, "build");
  env.mkdirp(buildDir);
  const name = env.basename(entry, env.extname(entry));
  const nes = outPath ?? env.join(projDir, `${name}.nes`);
  const B = (f) => env.join(buildDir, f);

  // 1. lua -> C
  const source = env.readText(entry);
  const result = compile(source, env.basename(entry), {});
  const warnings = result.diagnostics.filter((d) => d.severity === "warning");
  if (warnings.length) env.warn(formatDiagnostics(warnings));
  if (!result.ok) {
    throw new Error("compile errors:\n" + formatDiagnostics(result.diagnostics.filter((d) => d.severity === "error")));
  }
  const gameC = B("main.c");
  env.writeFile(gameC, result.c);

  // cc65 flags: NES 2A03 is a plain NMOS 6502. -Osr optimizes; --static-locals
  // makes locals absolute stores (the 6502 has no cheap stack-relative access);
  // -g keeps symbols for the debug map; -I SDK finds nes_api.h.
  const CFLAGS = ["-t", "nes", "-Osr", "--cpu", "6502", "--codesize", "500", "-g",
                  "--static-locals", "-I", SDK];
  // ca65 for a plain 6502 target.
  const AFLAGS = ["--cpu", "6502", "-g"];
  if (env.asminc && env.exists(env.asminc)) AFLAGS.push("-I", env.asminc);

  // compile C -> .s -> peephole -> assemble -> .o
  let phTail = 0, phReload = 0;
  const cc = (src, sdst) => {
    run(env, "cc65", [...CFLAGS, "-o", sdst, src]);
    const opt = peephole(env.readText(sdst));
    env.writeFile(sdst, opt.text);
    phTail += opt.stats.tailCalls; phReload += opt.stats.reloads;
  };
  const as = (src, obj) => run(env, "ca65", [...AFLAGS, "-o", obj, src]);
  const ccAs = (cname, base) => { cc(env.join(SDK, cname), B(base + ".s")); as(B(base + ".s"), B(base + ".o")); };

  // 2. the game unit
  cc(gameC, B("main.s"));
  as(B("main.s"), B("main.o"));

  // 2b. the C runtime units
  ccAs("nes_api.c", "nes_api");
  ccAs("nes_fixed.c", "nes_fixed");
  ccAs("nes_math.c", "nes_math");

  // 3. the asm units (crt0 + hand-tuned fixed-point 6502)
  const asmUnit = (fname, base) => { as(env.join(SDK, fname), B(base + ".o")); };
  asmUnit("neslua.crt0.s", "crt0");
  asmUnit("nes_fixed_asm.s", "nes_fixed_asm");
  asmUnit("nes_rng.s", "nes_rng");

  // 4. link. The crt0 is the startup module; nes.lib supplies the C runtime
  // (zerobss/copydata/incsp/mul/div helpers). neslua.cfg places PRG-RAM BSS.
  const objs = ["crt0.o", "main.o", "nes_api.o", "nes_fixed.o", "nes_math.o", "nes_fixed_asm.o", "nes_rng.o"].map(B);
  const cfg = env.join(SDK, "neslua.cfg");
  const dbg = B(`${name}.dbg`);
  run(env, "ld65", ["-C", cfg, "-o", nes, "--dbgfile", dbg, ...objs, env.lib]);

  if (env.debug) env.log(`peephole: ${phTail} tail-calls, ${phReload} reloads folded`);
  const bytes = env.size(nes);
  env.log(`built ${env.basename(nes)} (${bytes} bytes)`);
  return { rom: nes, dbg, bytes };
}

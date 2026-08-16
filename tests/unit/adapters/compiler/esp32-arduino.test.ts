import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { BuildTimeoutError, ProcessOutputLimitError, UnsupportedBuildTargetError } from "@/src/ports/compiler";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): { root: string; sourceDir: string; outputDir: string } {
  const root = mkdtempSync(join(tmpdir(), "mcu-controlled-compiler-"));
  roots.push(root);
  const sourceDir = join(root, "source");
  const outputDir = join(root, "output");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "main.cpp"), "void setup(){}\n", "utf8");
  return { root, sourceDir: resolve(sourceDir), outputDir: resolve(outputDir) };
}

function compilerScript(mode: "success" | "missing" | "nonzero" | "sleep" | "output-flood" | "symlink" | "directory-symlink", pidMarker?: string, cwdMarker?: string): string {
  return `const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(1);if(args[0]==='version'){console.log('controlled-fixture 1.0');process.exit(0)};if(${JSON.stringify(pidMarker)})fs.writeFileSync(${JSON.stringify(pidMarker)},String(process.pid));if(${JSON.stringify(cwdMarker)})fs.writeFileSync(${JSON.stringify(cwdMarker)},process.cwd());if(${JSON.stringify(mode)}==='sleep'){setInterval(()=>{},1000)}else if(${JSON.stringify(mode)}==='output-flood'){process.stdout.write('x'.repeat(2*1024*1024+1));process.exit(0)}else if(${JSON.stringify(mode)}==='nonzero'){process.exit(7)}else if(${JSON.stringify(mode)}==='missing'){process.exit(0)}else{const out=args[args.indexOf('--output-dir')+1];fs.mkdirSync(out,{recursive:true});if(${JSON.stringify(mode)}==='symlink'){const outside=path.join(path.dirname(out),'outside.bin');fs.writeFileSync(outside,Buffer.from('firmware-fixture'));fs.symlinkSync(outside,path.join(out,'fixture.bin'),'file')}else if(${JSON.stringify(mode)}==='directory-symlink'){const outside=path.join(path.dirname(out),'outside-dir');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'fixture.bin'),Buffer.from('firmware-fixture'));fs.symlinkSync(outside,path.join(out,'nested'),'junction')}else{fs.writeFileSync(path.join(out,'fixture.bin'),Buffer.from('firmware-fixture'))};process.exit(0)};`;
}

function createFixture(mode: "success" | "missing" | "nonzero" | "sleep" | "output-flood" | "symlink" | "directory-symlink", timeoutMs = 500, pidMarker?: string, cwdMarker?: string): ReturnType<typeof createEsp32ArduinoCompiler> {
  return createEsp32ArduinoCompiler({
    arduinoCliPath: process.execPath,
    executableArgsPrefix: ["-e", compilerScript(mode, pidMarker, cwdMarker)],
    timeoutMs,
    terminateGraceMs: 50,
  });
}

function request(root: ReturnType<typeof fixtureRoot>) {
  return {
    target: "esp32-s3",
    toolchain: "esp32-arduino" as const,
    options: {},
    sourceDir: root.sourceDir,
    outputDir: root.outputDir,
  };
}

describe("controlled external compiler fixture (not Arduino CLI)", () => {
  it("discovers the Arduino CLI version separately from the pinned ESP32 core", async () => {
    const script = `const args=process.argv.slice(1);if(args[0]==='version'){console.log('arduino-cli 1.5.0');process.exit(0)}if(args[0]==='core'&&args[1]==='list'){console.log(JSON.stringify({platforms:[{id:'esp32:esp32',installed_version:'3.3.11'}]}));process.exit(0)}process.exit(2);`;
    const compiler = createEsp32ArduinoCompiler({ arduinoCliPath: process.execPath, executableArgsPrefix: ["-e", script] });
    await expect(compiler.discoverToolchain()).resolves.toMatchObject({
      available: true,
      version: "arduino-cli 1.5.0",
      corePackage: "esp32:esp32",
      coreVersion: "3.3.11",
    });
  });

  it("spawns a real child and records exact FQBN/source/output/size/hash evidence", async () => {
    const root = fixtureRoot();
    const compiler = createFixture("success");
    const result = await compiler.build(request(root), () => {}, new AbortController().signal);
    expect(result.exitCode).toBe(0);
    expect(result.command).toContain("esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB");
    expect(result.sourceDir).toBe(root.sourceDir);
    expect(result.outputDir).toBe(root.outputDir);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ kind: "bin", sizeBytes: 16, path: join(root.outputDir, "fixture.bin") });
    expect(result.outputs[0]?.sha256).toBe("4872aaf92b449866c0452a5fb55712c1cb0c8db425a046235c5ca4c4ad1feafe");
    expect(readFileSync(result.outputs[0]!.path, "utf8")).toBe("firmware-fixture");
  });

  it("uses the explicit sourceDir as child cwd even when the caller cwd is unrelated", async () => {
    const root = fixtureRoot();
    const unrelated = mkdtempSync(join(tmpdir(), "mcu-unrelated-cwd-"));
    roots.push(unrelated);
    const cwdMarker = join(root.root, "child.cwd");
    const originalCwd = process.cwd();
    process.chdir(unrelated);
    try {
      await createFixture("success", 500, undefined, cwdMarker).build(request(root), () => {}, new AbortController().signal);
    } finally {
      process.chdir(originalCwd);
    }
    expect(readFileSync(cwdMarker, "utf8")).toBe(root.sourceDir);
  });

  it("rejects unsupported targets before spawning", async () => {
    const root = fixtureRoot();
    const compiler = createFixture("success");
    await expect(compiler.build({ ...request(root), target: "stm32f4" }, () => {}, new AbortController().signal))
      .rejects.toBeInstanceOf(UnsupportedBuildTargetError);
    expect(existsSync(root.outputDir)).toBe(false);
  });

  it("distinguishes exit failure and exit-zero-without-output", async () => {
    const nonzeroRoot = fixtureRoot();
    const nonzero = await createFixture("nonzero").build(request(nonzeroRoot), () => {}, new AbortController().signal);
    expect(nonzero.exitCode).toBe(7);
    expect(nonzero.outputs).toEqual([]);

    const missingRoot = fixtureRoot();
    const missing = await createFixture("missing").build(request(missingRoot), () => {}, new AbortController().signal);
    expect(missing.exitCode).toBe(0);
    expect(missing.outputs).toEqual([]);
  });

  it("does not read firmware through a symlink in the compiler output tree", async () => {
    const root = fixtureRoot();
    const result = await createFixture("symlink").build(request(root), () => {}, new AbortController().signal);
    expect(result.exitCode).toBe(0);
    expect(result.outputs).toEqual([]);
  });

  it("does not recurse through a symlinked output directory", async () => {
    const root = fixtureRoot();
    const result = await createFixture("directory-symlink").build(request(root), () => {}, new AbortController().signal);
    expect(result.exitCode).toBe(0);
    expect(result.outputs).toEqual([]);
  });

  it("times out and aborts the actual child without a late success", async () => {
    const timeoutRoot = fixtureRoot();
    await expect(createFixture("sleep", 40).build(request(timeoutRoot), () => {}, new AbortController().signal))
      .rejects.toBeInstanceOf(BuildTimeoutError);

    const cancelRoot = fixtureRoot();
    const pidMarker = join(cancelRoot.root, "child.pid");
    const controller = new AbortController();
    const promise = createFixture("sleep", 5000, pidMarker).build(request(cancelRoot), () => {}, controller.signal);
    for (let attempt = 0; attempt < 100 && !existsSync(pidMarker); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(pidMarker)).toBe(true);
    setTimeout(() => controller.abort(), 30);
    const cancelled = await promise;
    expect(cancelled.exitCode).toBe(1);
    expect(cancelled.outputs).toEqual([]);
    const pid = Number(readFileSync(pidMarker, "utf8"));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("terminates and rejects a child that exceeds the combined output bound", async () => {
    const root = fixtureRoot();
    await expect(createFixture("output-flood").build(request(root), () => {}, new AbortController().signal))
      .rejects.toBeInstanceOf(ProcessOutputLimitError);
  });

  it("does not spawn when cancellation is already requested", async () => {
    const root = fixtureRoot();
    const controller = new AbortController();
    controller.abort();
    const result = await createFixture("success").build(request(root), () => {}, controller.signal);
    expect(result.exitCode).toBe(1);
    expect(result.outputs).toEqual([]);
    expect(existsSync(join(root.outputDir, "fixture.bin"))).toBe(false);
  });
});

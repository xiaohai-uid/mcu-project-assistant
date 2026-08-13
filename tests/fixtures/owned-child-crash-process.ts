import { writeFileSync } from "node:fs";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { createPhysicalArduinoDevice } from "@/src/adapters/device/physical-arduino";

const [mode, pidPath, cwd] = process.argv.slice(2);
if (!mode || !pidPath || !cwd) throw new Error("owned child crash fixture requires mode, pid path, and cwd");
const markerPath = pidPath;
const fixtureCwd = cwd;

const script = `const fs=require('node:fs');const args=process.argv.slice(1);if(args.includes('version')){process.stdout.write('fixture 1.0\\n');process.exit(0)};if(args.includes('board')){process.stdout.write(JSON.stringify([{port:'COM9',protocol:'serial',matching_boards:[{fqbn:'esp32:esp32:esp32s3',serial_number:'owned-child-fixture'}]}]));process.exit(0)};fs.writeFileSync(${JSON.stringify(markerPath)},String(process.pid));setInterval(()=>{},1000);`;

async function main(): Promise<void> {
  if (mode === "compiler") {
    const compiler = createEsp32ArduinoCompiler({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", script],
      timeoutMs: 60_000,
    });
    await compiler.build({
      target: "esp32-s3",
      toolchain: "esp32-arduino",
      options: {},
      sourceDir: fixtureCwd,
      outputDir: `${fixtureCwd}/output`,
    }, () => undefined, new AbortController().signal);
    return;
  }
  if (mode === "upload") {
    const device = createPhysicalArduinoDevice({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", script],
      cwd: fixtureCwd,
      timeoutMs: 60_000,
    });
    const board = await device.detectBoard();
    await device.flash({
      projectId: "project",
      operationId: "owned-child-upload",
      deviceId: board.id,
      buildId: "build",
      artifactVersionId: "version",
      outputDir: fixtureCwd,
      firmwarePath: `${fixtureCwd}/firmware.bin`,
      firmwareSha256: "0".repeat(64),
    }, () => undefined, new AbortController().signal);
    return;
  }
  throw new Error(`unknown owned child mode: ${mode}`);
}

void main().catch((error) => {
  writeFileSync(`${pidPath}.error`, error instanceof Error ? error.message : String(error), "utf8");
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProcess } from "../src/process-runner.js";

const workerScript = new URL("../scripts/media/qq-media-worker.mjs", import.meta.url).pathname;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

// A tiny 16-bit mono WAV: one quiet second, then one loud second of 440 Hz.
function toneWav(sampleRate = 16_000) {
  const samples = sampleRate * 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const amplitude = index < sampleRate ? 0.01 : 0.5;
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * amplitude * 32_767), 44 + index * 2);
  }
  return buffer;
}

test("the media worker analyzes loudness without optional components", { skip: hasFfmpeg ? false : "ffmpeg is not installed" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "qq-media-worker-"));
  try {
    const input = join(dir, "tone.wav");
    await writeFile(input, toneWav());
    const result = await runProcess(process.execPath, [workerScript, "analyze", "--tools", join(dir, "no-tools"), "--input", input, "--mode", "music", "--tags", "0"], {
      timeoutMs: 30_000,
      allowFailure: true
    });
    const parsed = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, "music");
    assert.equal(parsed.durationSeconds, 2);
    assert.equal(parsed.essentia, false);
    assert.ok(parsed.notes.includes("essentia_missing"));
    assert.equal(parsed.loudness.loudestAt, 1);
    assert.ok(parsed.loudness.rangeDb > 20, JSON.stringify(parsed.loudness));
    const usage = await runProcess(process.execPath, [workerScript, "nope", "--tools", dir], { timeoutMs: 10_000, allowFailure: true });
    assert.equal(JSON.parse(usage.stdout.trim()).code, "MEDIA_USAGE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

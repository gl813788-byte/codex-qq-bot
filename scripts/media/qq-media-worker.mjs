#!/usr/bin/env node
// One-shot local audio understanding for the QQ Hub, run as a bounded child
// process so the native ONNX runtime never lives in the Hub. It decodes the
// input with ffmpeg to 16 kHz mono, splits long audio with Silero VAD,
// transcribes each span with SenseVoice (text, language, emotion, sound
// event) and optionally tags general sounds with CED (AudioSet labels).
// Prints exactly one JSON object on stdout; every failure is a JSON error.
//
//   node qq-media-worker.mjs transcribe --tools DIR --input FILE
//        [--language auto] [--threads 2] [--max-seconds 900]
//        [--from 0] [--to 0] [--tags 1] [--ffmpeg ffmpeg]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const SAMPLE_RATE = 16_000;
const SINGLE_PASS_SECONDS = 28;
const TAG_WINDOW_SECONDS = 10;
const MAX_TAG_WINDOWS = 8;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) continue;
    const value = rest[index + 1];
    options[key.slice(2)] = value === undefined || value.startsWith("--") ? "1" : value;
    if (value !== undefined && !value.startsWith("--")) index += 1;
  }
  return options;
}

function emit(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = code;
}

function cleanToken(value) {
  return String(value || "").replace(/^<\|/, "").replace(/\|>$/, "").trim();
}

function decodeAudio({ ffmpeg, input, from, to, maxSeconds }) {
  return new Promise((resolve, reject) => {
    const duration = to > from ? Math.min(to - from, maxSeconds) : maxSeconds;
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
    if (from > 0) args.push("-ss", String(from));
    args.push("-i", input, "-t", String(duration), "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1");
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    const limit = Math.ceil(duration * SAMPLE_RATE * 4) + 4096;
    const chunks = [];
    let bytes = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (bytes >= limit) return;
      chunks.push(chunk);
      bytes += chunk.length;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0 && bytes === 0) {
        const error = new Error(`ffmpeg could not decode the audio${stderr ? `: ${stderr.trim().split("\n").pop()}` : ""}`);
        error.code = /does not contain any stream|matches no streams/i.test(stderr) ? "MEDIA_NO_AUDIO" : "MEDIA_DECODE_FAILED";
        reject(error);
        return;
      }
      const buffer = Buffer.concat(chunks).subarray(0, Math.floor(Math.min(bytes, limit) / 4) * 4);
      const samples = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
      resolve(samples);
    });
  });
}

function loadSherpa(toolsDir) {
  const require = createRequire(join(toolsDir, "package.json"));
  return require("sherpa-onnx-node");
}

function createRecognizer(sherpa, toolsDir, { language, threads }) {
  const dir = join(toolsDir, "models", "sense-voice");
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: join(dir, "model.int8.onnx"), language, useInverseTextNormalization: 1 },
      tokens: join(dir, "tokens.txt"),
      numThreads: threads,
      provider: "cpu",
      debug: 0
    }
  });
}

function recognize(recognizer, samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return {
    text: String(result?.text || "").trim(),
    language: cleanToken(result?.lang),
    emotion: cleanToken(result?.emotion),
    event: cleanToken(result?.event)
  };
}

function splitSpeech(sherpa, toolsDir, samples, threads) {
  const vadModel = join(toolsDir, "models", "silero_vad.onnx");
  if (!existsSync(vadModel)) return fixedWindows(samples);
  const windowSize = 512;
  const vad = new sherpa.Vad({
    sileroVad: { model: vadModel, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.5, maxSpeechDuration: 20, windowSize },
    sampleRate: SAMPLE_RATE,
    numThreads: Math.max(1, Math.min(2, threads)),
    debug: 0
  }, 60);
  const spans = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      const segment = vad.front(false);
      vad.pop();
      spans.push({ start: Number(segment.start) || 0, samples: Float32Array.from(segment.samples) });
    }
  };
  for (let index = 0; index + windowSize <= samples.length; index += windowSize) {
    vad.acceptWaveform(samples.subarray(index, index + windowSize));
    drain();
  }
  vad.flush();
  drain();
  return spans;
}

function fixedWindows(samples) {
  const size = 20 * SAMPLE_RATE;
  const spans = [];
  for (let start = 0; start < samples.length; start += size) {
    spans.push({ start, samples: samples.subarray(start, Math.min(samples.length, start + size)) });
  }
  return spans;
}

function tagSounds(sherpa, toolsDir, samples, threads) {
  const dir = join(toolsDir, "models", "audio-tagging");
  const model = join(dir, "model.int8.onnx");
  const labels = join(dir, "class_labels_indices.csv");
  if (!existsSync(model) || !existsSync(labels)) return null;
  const tagger = new sherpa.AudioTagging({ model: { ced: model, numThreads: Math.max(1, Math.min(2, threads)), debug: 0 }, labels, topK: 5 });
  const window = TAG_WINDOW_SECONDS * SAMPLE_RATE;
  const count = Math.max(1, Math.min(MAX_TAG_WINDOWS, Math.ceil(samples.length / window)));
  const step = count > 1 ? Math.floor((samples.length - window) / (count - 1)) : 0;
  const best = new Map();
  const timeline = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.max(0, Math.min(samples.length - 1, index * step));
    const slice = samples.subarray(start, Math.min(samples.length, start + window));
    if (slice.length < SAMPLE_RATE / 2) continue;
    const stream = tagger.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: slice });
    const events = tagger.compute(stream) || [];
    const top = events.filter((event) => Number(event.prob) >= 0.25).slice(0, 3);
    if (top.length) timeline.push({ at: round(start / SAMPLE_RATE), labels: top.map((event) => String(event.name)) });
    for (const event of events) {
      const prob = Number(event.prob) || 0;
      if (prob > (best.get(event.name) || 0)) best.set(String(event.name), prob);
    }
  }
  const overall = [...best.entries()]
    .filter(([, prob]) => prob >= 0.2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, prob]) => ({ label, prob: round(prob) }));
  return { overall, timeline: timeline.slice(0, MAX_TAG_WINDOWS) };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function transcribe(options) {
  const toolsDir = String(options.tools || "");
  const input = String(options.input || "");
  if (!toolsDir || !input) throw Object.assign(new Error("--tools and --input are required"), { code: "MEDIA_USAGE" });
  if (!existsSync(join(toolsDir, "models", "sense-voice", "model.int8.onnx"))) {
    throw Object.assign(new Error("SenseVoice model is not installed"), { code: "MEDIA_ASR_MISSING" });
  }
  const threads = Math.max(1, Math.min(4, Number(options.threads) || 2));
  const maxSeconds = Math.max(5, Math.min(3600, Number(options["max-seconds"]) || 900));
  const from = Math.max(0, Number(options.from) || 0);
  const to = Math.max(0, Number(options.to) || 0);
  const language = ["auto", "zh", "en", "ja", "ko", "yue"].includes(options.language) ? options.language : "auto";
  const startedAt = Date.now();
  const samples = await decodeAudio({ ffmpeg: options.ffmpeg || "ffmpeg", input, from, to, maxSeconds });
  const durationSeconds = round(samples.length / SAMPLE_RATE);
  if (samples.length < SAMPLE_RATE / 4) {
    return { ok: true, durationSeconds, segments: [], text: "", noSpeech: true, sounds: null, elapsedMs: Date.now() - startedAt };
  }
  const sherpa = loadSherpa(toolsDir);
  const recognizer = createRecognizer(sherpa, toolsDir, { language, threads });
  const spans = durationSeconds <= SINGLE_PASS_SECONDS
    ? [{ start: 0, samples }]
    : splitSpeech(sherpa, toolsDir, samples, threads);
  const segments = [];
  for (const span of spans) {
    const result = recognize(recognizer, span.samples);
    if (!result.text) continue;
    const start = round(from + span.start / SAMPLE_RATE);
    segments.push({ start, end: round(start + span.samples.length / SAMPLE_RATE), ...result });
  }
  const sounds = options.tags === "0" ? null : tagSounds(sherpa, toolsDir, samples, threads);
  const languages = countBy(segments.map((segment) => segment.language));
  const emotions = countBy(segments.map((segment) => segment.emotion));
  const events = countBy(segments.map((segment) => segment.event));
  return {
    ok: true,
    durationSeconds,
    from,
    language: languages[0] || "",
    emotions,
    events,
    segments,
    text: segments.map((segment) => segment.text).join(" ").slice(0, 20_000),
    noSpeech: segments.length === 0,
    sounds,
    elapsedMs: Date.now() - startedAt
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([value]) => value).slice(0, 4);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command !== "transcribe") throw Object.assign(new Error(`unknown command: ${options.command || ""}`), { code: "MEDIA_USAGE" });
  emit(await transcribe(options));
} catch (error) {
  emit({ ok: false, code: String(error?.code || "MEDIA_WORKER_FAILED"), error: String(error?.message || error).slice(0, 600) }, 1);
}

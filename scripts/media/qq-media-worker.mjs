#!/usr/bin/env node
// One-shot local audio understanding for the QQ Hub, run as a bounded child
// process so the native ONNX runtime and the Essentia WASM never live in the
// Hub. It decodes the input with ffmpeg to 16 kHz mono, splits long audio
// with Silero VAD, transcribes each span with SenseVoice (text, language,
// emotion, sound event) and optionally tags general sounds with CED
// (AudioSet labels). `analyze` adds a loudness curve and, when essentia.js
// (AGPL-3.0, optional) is installed, tempo, key, danceability and dynamics
// for music or the pitch range of a voice.
// Prints exactly one JSON object on stdout; every failure is a JSON error.
//
//   node qq-media-worker.mjs transcribe --tools DIR --input FILE
//        [--language auto] [--threads 2] [--max-seconds 900]
//        [--from 0] [--to 0] [--tags 1] [--ffmpeg ffmpeg]
//   node qq-media-worker.mjs analyze --tools DIR --input FILE
//        [--mode music|voice] [--from 0] [--to 0] [--max-seconds 600]
//        [--focus-from S --focus-to S] [--asr 0] [--tags 1] [--threads 2]

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

function decodeAudio({ ffmpeg, input, from, to, maxSeconds, sampleRate = SAMPLE_RATE }) {
  return new Promise((resolve, reject) => {
    const duration = to > from ? Math.min(to - from, maxSeconds) : maxSeconds;
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
    if (from > 0) args.push("-ss", String(from));
    args.push("-i", input, "-t", String(duration), "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1");
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    const limit = Math.ceil(duration * sampleRate * 4) + 4096;
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

function tagSounds(sherpa, toolsDir, samples, threads, { topK = 5, offset = 0 } = {}) {
  const dir = join(toolsDir, "models", "audio-tagging");
  const model = join(dir, "model.int8.onnx");
  const labels = join(dir, "class_labels_indices.csv");
  if (!existsSync(model) || !existsSync(labels)) return null;
  const tagger = new sherpa.AudioTagging({ model: { ced: model, numThreads: Math.max(1, Math.min(2, threads)), debug: 0 }, labels, topK });
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
    if (top.length) timeline.push({ at: round(offset + start / SAMPLE_RATE), labels: top.map((event) => String(event.name)) });
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

function speechFromSamples(sherpa, toolsDir, samples, { language, threads, from }) {
  const durationSeconds = samples.length / SAMPLE_RATE;
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
  const languages = countBy(segments.map((segment) => segment.language));
  return {
    language: languages[0] || "",
    emotions: countBy(segments.map((segment) => segment.emotion)),
    events: countBy(segments.map((segment) => segment.event)),
    segments,
    text: segments.map((segment) => segment.text).join(" ").slice(0, 20_000),
    noSpeech: segments.length === 0
  };
}

function commonOptions(options) {
  const toolsDir = String(options.tools || "");
  const input = String(options.input || "");
  if (!toolsDir || !input) throw Object.assign(new Error("--tools and --input are required"), { code: "MEDIA_USAGE" });
  return {
    toolsDir,
    input,
    ffmpeg: options.ffmpeg || "ffmpeg",
    threads: Math.max(1, Math.min(4, Number(options.threads) || 2)),
    from: Math.max(0, Number(options.from) || 0),
    to: Math.max(0, Number(options.to) || 0),
    language: ["auto", "zh", "en", "ja", "ko", "yue"].includes(options.language) ? options.language : "auto"
  };
}

function hasSenseVoice(toolsDir) {
  return existsSync(join(toolsDir, "models", "sense-voice", "model.int8.onnx"));
}

async function transcribe(options) {
  const { toolsDir, input, ffmpeg, threads, from, to, language } = commonOptions(options);
  if (!hasSenseVoice(toolsDir)) {
    throw Object.assign(new Error("SenseVoice model is not installed"), { code: "MEDIA_ASR_MISSING" });
  }
  const maxSeconds = Math.max(5, Math.min(3600, Number(options["max-seconds"]) || 900));
  const startedAt = Date.now();
  const samples = await decodeAudio({ ffmpeg, input, from, to, maxSeconds });
  const durationSeconds = round(samples.length / SAMPLE_RATE);
  if (samples.length < SAMPLE_RATE / 4) {
    return { ok: true, durationSeconds, segments: [], text: "", noSpeech: true, sounds: null, elapsedMs: Date.now() - startedAt };
  }
  const sherpa = loadSherpa(toolsDir);
  const speech = speechFromSamples(sherpa, toolsDir, samples, { language, threads, from });
  const sounds = options.tags === "0" ? null : tagSounds(sherpa, toolsDir, samples, threads);
  return {
    ok: true,
    durationSeconds,
    from,
    ...speech,
    sounds,
    elapsedMs: Date.now() - startedAt
  };
}

// Loudness per second (dBFS) folded into at most `points` buckets, plus the
// spread between quiet and loud passages.
function loudnessProfile(samples, sampleRate, { offset = 0, points = 20 } = {}) {
  const seconds = Math.floor(samples.length / sampleRate);
  if (seconds < 1) return null;
  const perSecond = [];
  for (let second = 0; second < seconds; second += 1) {
    let sum = 0;
    const start = second * sampleRate;
    for (let index = start; index < start + sampleRate; index += 1) sum += samples[index] * samples[index];
    perSecond.push(10 * Math.log10(sum / sampleRate + 1e-12));
  }
  const audible = perSecond.filter((db) => db > -60).sort((left, right) => left - right);
  const quantile = (q) => (audible.length ? audible[Math.min(audible.length - 1, Math.round(q * (audible.length - 1)))] : -90);
  const bucket = Math.max(1, Math.ceil(perSecond.length / points));
  const curve = [];
  for (let start = 0; start < perSecond.length; start += bucket) {
    const slice = perSecond.slice(start, start + bucket);
    curve.push({ at: round(offset + start), db: round(slice.reduce((sum, db) => sum + db, 0) / slice.length) });
  }
  const loudest = perSecond.indexOf(Math.max(...perSecond));
  return {
    meanDb: round(audible.length ? audible.reduce((sum, db) => sum + db, 0) / audible.length : -90),
    peakDb: round(Math.max(...perSecond)),
    rangeDb: round(quantile(0.95) - quantile(0.1)),
    quietRatio: round(1 - audible.length / perSecond.length),
    loudestAt: round(offset + loudest),
    curve
  };
}

function loadEssentia(toolsDir) {
  const require = createRequire(join(toolsDir, "package.json"));
  const wasm = require("essentia.js/dist/essentia-wasm.umd.js");
  const core = require("essentia.js/dist/essentia.js-core.umd.js");
  const module = wasm?.EssentiaWASM || wasm;
  const Essentia = typeof core === "function" ? core : core?.Essentia || core?.default;
  if (!module?.EssentiaJS || typeof Essentia !== "function") throw new Error("essentia.js did not load");
  return new Essentia(module);
}

function hasEssentia(toolsDir) {
  return existsSync(join(toolsDir, "node_modules", "essentia.js", "package.json"));
}

function attempt(errors, name, task) {
  try {
    return task();
  } catch (error) {
    errors.push(`${name}: ${String(error?.message || error).slice(0, 120)}`);
    return null;
  }
}

function toArray(essentia, vector) {
  if (!vector) return [];
  if (vector instanceof Float32Array || Array.isArray(vector)) return Array.from(vector);
  try {
    return Array.from(essentia.vectorToArray(vector));
  } catch {
    return [];
  }
}

// Tempo (Degara beat tracker; regularity of the beat intervals stands in for
// its missing confidence), key, danceability and dynamic complexity.
function musicFeatures(essentia, samples, sampleRate, errors) {
  const signal = essentia.arrayToVector(samples);
  try {
    const rhythm = sampleRate === 44_100 ? attempt(errors, "rhythm", () => {
      const result = essentia.RhythmExtractor2013(signal, 208, "degara", 40);
      const ticks = toArray(essentia, result.ticks);
      const intervals = ticks.slice(1).map((tick, index) => tick - ticks[index]).filter((value) => value > 0);
      const mean = intervals.reduce((sum, value) => sum + value, 0) / (intervals.length || 1);
      const deviation = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (intervals.length || 1));
      return {
        bpm: round(Number(result.bpm) || 0),
        beats: ticks.length,
        regularity: intervals.length >= 8 ? round(Math.max(0, Math.min(1, 1 - deviation / (mean || 1)))) : null
      };
    }) : null;
    const key = attempt(errors, "key", () => {
      const result = essentia.KeyExtractor(signal, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "bgate", sampleRate);
      return result?.key ? { key: String(result.key), scale: String(result.scale), strength: round(Number(result.strength) || 0) } : null;
    });
    const dance = attempt(errors, "danceability", () => {
      const window = samples.length > sampleRate * 30 ? samples.subarray(Math.floor((samples.length - sampleRate * 30) / 2), Math.floor((samples.length + sampleRate * 30) / 2)) : samples;
      const vector = essentia.arrayToVector(window);
      try {
        return round(Number(essentia.Danceability(vector, 8800, 310, sampleRate, 1.1)?.danceability) || 0);
      } finally {
        vector.delete?.();
      }
    });
    const dynamics = attempt(errors, "dynamics", () => {
      const result = essentia.DynamicComplexity(signal, 0.2, sampleRate);
      return { complexity: round(Number(result.dynamicComplexity) || 0), loudness: round(Number(result.loudness) || 0) };
    });
    return { rhythm, key, danceability: dance, dynamics };
  } finally {
    signal.delete?.();
  }
}

// Fundamental frequency of a voice: median and spread over voiced frames.
function pitchFeatures(essentia, samples, sampleRate, errors) {
  const window = samples.length > sampleRate * 30 ? samples.subarray(0, sampleRate * 30) : samples;
  const signal = essentia.arrayToVector(window);
  try {
    return attempt(errors, "pitch", () => {
      const result = essentia.PitchYinProbabilistic(signal, 2048, 256, 0.1, "negative", false, sampleRate);
      const pitch = toArray(essentia, result.pitch);
      const probability = toArray(essentia, result.voicedProbabilities);
      const voiced = pitch.filter((hz, index) => hz > 50 && hz < 1500 && (probability[index] ?? 1) >= 0.5).sort((left, right) => left - right);
      if (voiced.length < 10) return { voicedRatio: round(voiced.length / (pitch.length || 1)) };
      const at = (q) => voiced[Math.min(voiced.length - 1, Math.round(q * (voiced.length - 1)))];
      return { medianHz: round(at(0.5)), lowHz: round(at(0.1)), highHz: round(at(0.9)), voicedRatio: round(voiced.length / (pitch.length || 1)) };
    });
  } finally {
    signal.delete?.();
  }
}

// The excerpt used for tempo and key: the requested focus (e.g. a known
// chorus), otherwise up to 60 seconds around the middle of the window.
function focusWindow({ from, durationSeconds, focusFrom, focusTo, maxFocusSeconds = 60 }) {
  const end = from + durationSeconds;
  if (focusTo > focusFrom && focusFrom >= from && focusFrom < end) {
    return { start: focusFrom, length: Math.min(focusTo, end) - focusFrom };
  }
  if (durationSeconds <= maxFocusSeconds + 15) return { start: from, length: durationSeconds };
  const middle = from + durationSeconds / 2;
  return { start: Math.max(from, middle - maxFocusSeconds / 2), length: maxFocusSeconds };
}

async function analyze(options) {
  const { toolsDir, input, ffmpeg, threads, from, to, language } = commonOptions(options);
  const mode = options.mode === "voice" ? "voice" : "music";
  const maxSeconds = Math.max(5, Math.min(1800, Number(options["max-seconds"]) || 600));
  const startedAt = Date.now();
  const samples = await decodeAudio({ ffmpeg, input, from, to, maxSeconds });
  const durationSeconds = round(samples.length / SAMPLE_RATE);
  const result = { ok: true, mode, durationSeconds, from, loudness: null, sounds: null, speech: null, music: null, pitch: null, essentia: false, notes: [] };
  if (samples.length < SAMPLE_RATE / 2) {
    result.notes.push("too_short");
    result.elapsedMs = Date.now() - startedAt;
    return result;
  }
  result.loudness = loudnessProfile(samples, SAMPLE_RATE, { offset: from });
  let sherpa = null;
  try {
    sherpa = existsSync(join(toolsDir, "node_modules", "sherpa-onnx-node", "package.json")) ? loadSherpa(toolsDir) : null;
  } catch {
    result.notes.push("sherpa_unavailable");
  }
  if (sherpa && options.tags !== "0") {
    result.sounds = tagSounds(sherpa, toolsDir, samples, threads, { topK: mode === "music" ? 8 : 5, offset: from });
  }
  if (sherpa && options.asr === "1" && hasSenseVoice(toolsDir)) {
    result.speech = speechFromSamples(sherpa, toolsDir, samples, { language, threads, from });
  }
  if (!hasEssentia(toolsDir)) {
    result.notes.push("essentia_missing");
  } else {
    const errors = [];
    const essentia = attempt(errors, "load", () => loadEssentia(toolsDir));
    if (essentia) {
      result.essentia = true;
      const singing = (result.sounds?.overall || []).some((tag) => /sing|music|song|choir|rapping/i.test(tag.label));
      if (mode === "music" || singing) {
        const focus = focusWindow({
          from,
          durationSeconds,
          focusFrom: Number(options["focus-from"]) || 0,
          focusTo: Number(options["focus-to"]) || 0
        });
        const excerpt = await decodeAudio({ ffmpeg, input, from: focus.start, to: focus.start + focus.length, maxSeconds: focus.length, sampleRate: 44_100 })
          .catch((error) => {
            errors.push(`decode44k: ${String(error?.message || error).slice(0, 120)}`);
            return null;
          });
        if (excerpt && excerpt.length > 44_100 * 3) {
          result.music = { ...musicFeatures(essentia, excerpt, 44_100, errors), from: round(focus.start), to: round(focus.start + excerpt.length / 44_100) };
        }
      }
      if (mode === "voice") result.pitch = pitchFeatures(essentia, samples, SAMPLE_RATE, errors);
      essentia.shutdown?.();
    }
    if (errors.length) result.essentiaErrors = errors.slice(0, 6);
  }
  result.elapsedMs = Date.now() - startedAt;
  return result;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([value]) => value).slice(0, 4);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command === "transcribe") emit(await transcribe(options));
  else if (options.command === "analyze") emit(await analyze(options));
  else throw Object.assign(new Error(`unknown command: ${options.command || ""}`), { code: "MEDIA_USAGE" });
} catch (error) {
  emit({ ok: false, code: String(error?.code || "MEDIA_WORKER_FAILED"), error: String(error?.message || error).slice(0, 600) }, 1);
}

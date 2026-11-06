import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Hears the voice clips of an incoming QQ message before routing, the way a
// person listens to a voice message: up to two clips from the message and its
// quote, each bounded in length, under one deadline. The transcript replaces
// the bare [语音] marker in the message text so memory, routing and the main
// model all see what was said. Failures leave the message unchanged.

const MAX_CLIPS = 2;
const emotionLabels = Object.freeze({ HAPPY: "开心", SAD: "难过", ANGRY: "生气", FEARFUL: "害怕", DISGUSTED: "厌恶", SURPRISED: "惊讶" });
const eventLabels = Object.freeze({ BGM: "有背景音乐", Laughter: "有笑声", Applause: "有掌声", Cry: "有哭声", Cough: "有咳嗽声" });

export async function transcribeQqEventVoices(event, {
  runtime,
  fetchVoice,
  workRoot,
  maxSeconds = 90,
  deadlineMs = 45_000,
  now = Date.now
} = {}) {
  const clips = [
    ...(event?.contentContext?.media?.audios || []).map((audio) => ({ audio, source: "current" })),
    ...(event?.replyContext?.contentContext?.media?.audios || []).map((audio) => ({ audio, source: "quoted" }))
  ].slice(0, MAX_CLIPS);
  if (!clips.length || !runtime || typeof fetchVoice !== "function" || !workRoot) return { event, transcripts: [] };
  const status = await runtime.status().catch(() => null);
  if (!status?.audio) return { event, transcripts: [] };
  const startedAt = now();
  const dir = join(workRoot, `voice-${randomUUID()}`);
  const transcripts = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("voice transcription deadline")), deadlineMs);
  timer.unref?.();
  try {
    await mkdir(dir, { recursive: true });
    for (const [index, clip] of clips.entries()) {
      if (now() - startedAt >= deadlineMs) break;
      try {
        const path = await fetchVoice(clip.audio, { outputDir: join(dir, String(index)), signal: controller.signal });
        const result = await runtime.transcribe(path, { signal: controller.signal, tags: false, maxSeconds });
        transcripts.push({
          ok: true,
          source: clip.source,
          text: String(result.text || "").trim().slice(0, 2000),
          durationSeconds: Math.round(Number(result.durationSeconds) || 0),
          emotion: (result.emotions || [])[0] || "",
          events: result.events || [],
          noSpeech: Boolean(result.noSpeech)
        });
      } catch (error) {
        transcripts.push({ ok: false, source: clip.source, code: String(error?.code || "VOICE_FAILED") });
        if (error?.code === "MEDIA_BUSY" || error?.code === "MEDIA_LOW_MEMORY") break;
      }
    }
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { event: applyQqVoiceTranscripts(event, transcripts), transcripts };
}

export function formatQqVoiceTranscript(transcript = {}) {
  if (!transcript.ok) return "[语音（没听清）]";
  const length = transcript.durationSeconds ? ` ${transcript.durationSeconds}秒` : "";
  if (transcript.noSpeech || !transcript.text) return `[语音${length}，听不出说了什么]`;
  const notes = [
    emotionLabels[transcript.emotion] ? `语气${emotionLabels[transcript.emotion]}` : "",
    ...(transcript.events || []).map((value) => eventLabels[value]).filter(Boolean)
  ].filter(Boolean);
  return `[语音${length}] ${transcript.text}${notes.length ? `（${notes.join("，")}）` : ""}`;
}

export function applyQqVoiceTranscripts(event, transcripts = []) {
  if (!event || !transcripts.length) return event;
  const current = transcripts.filter((item) => item.source === "current");
  const quoted = transcripts.filter((item) => item.source === "quoted");
  const next = { ...event, qqVoiceTranscripts: transcripts };
  if (current.length) {
    const replaceMarkers = (text) => {
      let index = 0;
      const replaced = String(text || "").replace(/\[语音\]/g, (marker) => {
        const transcript = current[index];
        index += 1;
        return transcript ? formatQqVoiceTranscript(transcript) : marker;
      });
      return index > 0 ? replaced : [replaced, ...current.map(formatQqVoiceTranscript)].filter(Boolean).join("\n");
    };
    next.text = replaceMarkers(event.text);
    const content = event.contentContext || {};
    const spoken = current.filter((item) => item.ok && item.text).map((item) => item.text).join(" ");
    next.contentContext = {
      ...content,
      displayText: replaceMarkers(content.displayText || event.text),
      // Routing and intent read plainText; a heard voice message is speech.
      plainText: [content.plainText, spoken].filter(Boolean).join(" ").trim()
    };
  }
  if (quoted.length && event.replyContext) {
    const replyText = String(event.replyContext.text || "");
    let index = 0;
    const text = replyText.replace(/\[语音\]/g, (marker) => {
      const transcript = quoted[index];
      index += 1;
      return transcript ? formatQqVoiceTranscript(transcript) : marker;
    });
    next.replyContext = { ...event.replyContext, text: index > 0 ? text : [replyText, ...quoted.map(formatQqVoiceTranscript)].filter(Boolean).join("\n") };
  }
  return next;
}

export function hasQqHeardVoice(event) {
  return Array.isArray(event?.qqVoiceTranscripts)
    && event.qqVoiceTranscripts.some((item) => item.source === "current" && item.ok);
}

// /转文字: the command a person sends while quoting a voice message.
export function isQqVoiceToTextCommand(compact) {
  return /^(?:转文字|语音转文字|转文本|识别语音|stt)$/i.test(String(compact || ""));
}

export function hasQqQuotedOrCurrentVoice(event) {
  return (event?.contentContext?.media?.audios || []).length > 0
    || (event?.replyContext?.contentContext?.media?.audios || []).length > 0;
}

// Transcripts heard before routing are reused unless they were cut at the
// automatic length limit; then the clip is heard again with a longer limit.
export function needsQqVoiceRetranscription(transcripts = [], { autoMaxSeconds = 90 } = {}) {
  const usable = transcripts.filter((item) => item.ok);
  if (!usable.length) return true;
  return usable.some((item) => Number(item.durationSeconds) >= Math.max(1, autoMaxSeconds - 1));
}

export function formatQqVoiceToTextReply(transcripts = [], { available = true, hasVoice = true } = {}) {
  if (!hasVoice) return "回复（引用）一条语音消息，再发 /转文字。";
  if (!available) return "本机还没装语音识别组件，转不了文字（主人可运行 npm run ncc -- media install）。";
  const lines = [];
  for (const [index, item] of transcripts.entries()) {
    const label = transcripts.length > 1 ? `第 ${index + 1} 条` : "这条语音";
    if (!item.ok) {
      lines.push(`${label}没识别出来（${item.code === "MEDIA_BUSY" ? "媒体处理正忙，稍后再试" : item.code === "MEDIA_LOW_MEMORY" ? "手机内存不够，稍后再试" : "可能已过期"}）。`);
      continue;
    }
    const length = item.durationSeconds ? `（${item.durationSeconds} 秒）` : "";
    lines.push(item.noSpeech || !item.text ? `${label}${length}听不出说了什么。` : `${label}${length}：\n${item.text}`);
  }
  return lines.length ? `🎙️ 语音转文字\n${lines.join("\n")}\n（本机识别，可能有同音错字）` : "没找到能转的语音。";
}

const defaultTimeZone = "Asia/Shanghai";

export function formatQqContextTime(value, {
  now = Date.now(),
  timeZone = defaultTimeZone
} = {}) {
  const timestamp = new Date(value);
  const current = new Date(now);
  if (!Number.isFinite(timestamp.getTime()) || !Number.isFinite(current.getTime())) return "";
  const messageParts = getDateTimeParts(timestamp, timeZone);
  const currentParts = getDateTimeParts(current, timeZone);
  const dayDistance = getCalendarDayNumber(currentParts) - getCalendarDayNumber(messageParts);
  const time = `${messageParts.hour}:${messageParts.minute}`;
  if (dayDistance === 0) return `今天 ${time}`;
  if (dayDistance === 1) return `昨天 ${time}`;
  if (messageParts.year === currentParts.year) {
    return `${messageParts.month}月${messageParts.day}日 ${time}`;
  }
  return `${messageParts.year}年${messageParts.month}月${messageParts.day}日 ${time}`;
}

function getDateTimeParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: fields.hour,
    minute: fields.minute
  };
}

function getCalendarDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

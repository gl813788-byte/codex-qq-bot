// QQ shows chat text exactly as typed, so a Markdown link such as
// "[Arcaea](https://arcaea.lowiro.com/zh)" arrives with its brackets and
// parentheses. Models that just searched the web like to cite that way. A
// link becomes its label followed by the bare URL, which QQ makes clickable,
// or only the URL when the label merely repeats it. Code spans and fenced
// blocks are left alone, as are links that are not http(s).

const CODE_PATTERN = /(```[\s\S]*?```|`[^`\n]+`)/g;
const LINK_PATTERN = /!?\[([^\[\]\n]{0,300})\]\((https?:\/\/[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)(?:\s+"[^"\n]*")?\)/gi;

export function flattenQqMarkdownLinks(text) {
  const value = String(text ?? "");
  if (!value.includes("](")) return value;
  return value
    .split(CODE_PATTERN)
    .map((part, index) => (index % 2 === 1 ? part : flattenPart(part)))
    .join("");
}

function flattenPart(part) {
  return part.replace(LINK_PATTERN, (match, label, url, offset, whole) => {
    const name = String(label || "").trim();
    const shown = sameAddress(name, url) ? url : `${name} ${url}`;
    // An ASCII character right after the URL would be read as part of it.
    const next = whole[offset + match.length] || "";
    return /[\x21-\x7e]/.test(next) ? `${shown} ` : shown;
  });
}

function sameAddress(label, url) {
  if (!label) return true;
  const strip = (value) => String(value).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  return strip(label) === strip(url);
}

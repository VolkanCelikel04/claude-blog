/** XML helpers for the narrow SpreadsheetML subset the vault uses. */

// XML 1.0 forbids most control characters outright; they would corrupt the file
// rather than round-trip, so they are dropped on the way in. Built from escape
// sequences so the source file itself stays plain ASCII.
const ILLEGAL_XML_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

export function escapeXml(value: string): string {
  return value
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/** Reads an attribute from a raw tag body such as ` r="A1" t="s"`. */
export function attr(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? unescapeXml(match[1]) : undefined;
}

/** "C" -> 2, "AB" -> 27. Zero-based column index from an A1-style reference. */
export function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase());
  if (!letters) return 0;
  let index = 0;
  for (const char of letters[1]) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 0 -> "A", 26 -> "AA". */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Small string helpers shared by the HTML parsers. They are pure string logic
 * (no DOMParser) so the same code runs in the browser and in Vitest.
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x"
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }

    return HTML_ENTITY_MAP[entity.toLowerCase()] ?? full
  })
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

/** Parses the attributes of a single opening tag such as `<link rel="x" href="y">`. */
export function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(tag))) {
    const name = match[1].toLowerCase()
    if (!(name in attributes)) {
      attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "")
    }
  }

  return attributes
}

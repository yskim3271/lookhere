// Just enough source-map support to turn a dev-server stack frame (transformed module,
// line, column) back into the original file and line.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

export interface RawSourceMap {
  sources: string[];
  sourceRoot?: string;
  mappings: string;
}

/** Decodes one mappings segment ("AAAA") into its VLQ numbers. */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64_INDEX.get(ch);
    if (digit === undefined) throw new Error(`Bad VLQ character: ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * Original position for a 1-based generated line and column, or null when unmapped.
 * Picks the last segment on that line that starts at or before the column.
 */
export function originalPosition(map: RawSourceMap, line: number, column: number): { source: string; line: number } | null {
  let src = 0;
  let srcLine = 0;
  let best: { source: string; line: number } | null = null;
  const lines = map.mappings.split(";");
  for (let i = 0; i < lines.length && i < line; i++) {
    let genCol = 0;
    for (const seg of lines[i].split(",")) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      genCol += v[0];
      if (v.length >= 4) {
        src += v[1];
        srcLine += v[2];
        if (i === line - 1 && genCol <= column - 1) {
          best = { source: (map.sourceRoot ?? "") + map.sources[src], line: srcLine + 1 };
        }
      }
    }
  }
  return best;
}

/** Extracts the source map a module points to; inline `data:` maps are decoded, others fetched. */
export async function loadSourceMap(code: string, moduleUrl: string, fetchText: (url: string) => Promise<string>): Promise<RawSourceMap | null> {
  const m = /\/\/[#@] sourceMappingURL=(\S+)\s*$/m.exec(code);
  if (!m) return null;
  const ref = m[1];
  try {
    if (ref.startsWith("data:")) {
      const comma = ref.indexOf(",");
      const body = ref.slice(comma + 1);
      const json = ref.slice(0, comma).includes(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
      return JSON.parse(json) as RawSourceMap;
    }
    return JSON.parse(await fetchText(new URL(ref, moduleUrl).href)) as RawSourceMap;
  } catch {
    return null;
  }
}

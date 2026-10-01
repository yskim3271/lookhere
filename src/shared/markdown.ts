import type { Bundle, ElementMatch } from "./types.js";

const RELATION_LABEL: Record<ElementMatch["relation"], string> = {
  matches: "matches the box",
  "contains-box": "wraps the box",
  "inside-box": "inside the box",
  overlaps: "overlaps the box",
};

function describeTarget(m: ElementMatch): string {
  const el = m.element;
  const parts = [`\`${el.selector}\``, `<${el.tag}>`];
  if (el.text) parts.push(JSON.stringify(el.text));
  if (el.components?.length) parts.push(`component ${el.components.map((c) => `\`${c}\``).join(" in ")}`);
  if (el.source) parts.push(`source \`${el.source}\``);
  return `${parts.join(" · ")} (${RELATION_LABEL[m.relation]})`;
}

/**
 * Renders a bundle as instructions an agent can act on.
 * `dir` is the bundle folder as the agent should see it (relative to the project root).
 */
export function renderBundleMarkdown(bundle: Bundle, dir: string): string {
  const boxCount = bundle.captures.reduce((n, c) => n + c.boxes.length, 0);
  const out: string[] = [];
  const file = (name: string) => `${dir}/${name}`;

  out.push(`# UI feedback ${bundle.id}`);
  out.push("");
  out.push(
    `The user captured ${bundle.captures.length} screen${bundle.captures.length === 1 ? "" : "s"} ` +
      `and marked ${boxCount} region${boxCount === 1 ? "" : "s"} they want changed. ` +
      `Each numbered box has a note. Coordinates are image pixels. ` +
      `Open the images to see exactly what the user pointed at.`,
  );
  if (bundle.message.trim()) {
    out.push("");
    out.push(`**Overall request:** ${bundle.message.trim()}`);
  }

  for (const c of bundle.captures) {
    out.push("");
    const where = c.source.url ?? c.source.title ?? c.source.kind;
    out.push(`## Screen ${c.n}: ${where} (${c.width}×${c.height})`);
    out.push("");
    out.push(`- Annotated screenshot: \`${file(c.image)}\``);
    out.push(`- Captured by: ${c.source.kind}`);
    if (c.note.trim()) out.push(`- Note for this screen: ${c.note.trim()}`);

    for (const b of c.boxes) {
      out.push("");
      out.push(`### ${c.n}.${b.n} ${b.note.trim() || "(no note)"}`);
      out.push("");
      out.push(`- Region: x=${b.rect.x} y=${b.rect.y} w=${b.rect.w} h=${b.rect.h}`);
      out.push(`- Crop: \`${file(b.crop)}\``);
      if (b.targets.length) {
        out.push(`- Elements under the box:`);
        for (const t of b.targets) out.push(`  - ${describeTarget(t)}`);
      }
    }
  }

  out.push("");
  out.push(
    `When you have handled this feedback, call the \`mark_done\` tool with bundle_id "${bundle.id}" ` +
      `(or tell the user which items you changed).`,
  );
  return out.join("\n") + "\n";
}

export type MarkdownLine =
  | { type: 'heading1' | 'heading2'; text: string }
  | { type: 'checklist'; checked: boolean; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'paragraph'; text: string };

const CHECKLIST_PATTERN = /^[-*]\s\[( |x|X)\]\s(.*)$/;
const BULLET_PATTERN = /^[-*]\s(.*)$/;

/**
 * Line-based Markdown parser — deliberately simple (headings, checklists,
 * bullets, quotes, fenced code, paragraphs with inline bold/italic) rather
 * than a full CommonMark implementation. Storage stays plain Markdown text;
 * this only powers the read-mode render.
 */
export function parseMarkdownLines(body: string): MarkdownLine[] {
  const rawLines = body.split('\n');
  const lines: MarkdownLine[] = [];
  let inCodeFence = false;
  let codeBuffer: string[] = [];

  for (const raw of rawLines) {
    if (raw.trim().startsWith('```')) {
      if (inCodeFence) {
        lines.push({ type: 'code', text: codeBuffer.join('\n') });
        codeBuffer = [];
      }
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      codeBuffer.push(raw);
      continue;
    }

    const checklistMatch = raw.match(CHECKLIST_PATTERN);
    if (checklistMatch) {
      lines.push({
        type: 'checklist',
        checked: checklistMatch[1].toLowerCase() === 'x',
        text: checklistMatch[2],
      });
      continue;
    }
    if (raw.startsWith('## ')) {
      lines.push({ type: 'heading2', text: raw.slice(3) });
      continue;
    }
    if (raw.startsWith('# ')) {
      lines.push({ type: 'heading1', text: raw.slice(2) });
      continue;
    }
    if (raw.startsWith('> ')) {
      lines.push({ type: 'quote', text: raw.slice(2) });
      continue;
    }
    const bulletMatch = raw.match(BULLET_PATTERN);
    if (bulletMatch) {
      lines.push({ type: 'bullet', text: bulletMatch[1] });
      continue;
    }
    lines.push({ type: 'paragraph', text: raw });
  }

  if (inCodeFence && codeBuffer.length) lines.push({ type: 'code', text: codeBuffer.join('\n') });

  return lines;
}

export type InlineToken = { text: string; bold?: boolean; italic?: boolean };

/** Splits a line into bold/italic/plain runs for **bold** and *italic* spans. */
export function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) tokens.push({ text: text.slice(lastIndex, match.index) });
    const chunk = match[0];
    if (chunk.startsWith('**')) tokens.push({ text: chunk.slice(2, -2), bold: true });
    else tokens.push({ text: chunk.slice(1, -1), italic: true });
    lastIndex = match.index + chunk.length;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens;
}

/** Strips Markdown syntax down to readable plain text — for list/card previews, not for editing. */
export function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[-*]\s\[[ xX]\]\s/gm, '')
    .replace(/^[#>*-]+\s/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export type OpenWikiLink = { start: number; query: string };

/**
 * Whether the cursor sits inside an unclosed `[[...` right now — and if so,
 * where that link starts and what's been typed so far. Powers the
 * autocomplete panel: it only appears while you're actively inside `[[ ]]`,
 * not any time `[[` appears earlier in the note.
 *
 * Walks back from the cursor to the nearest `[[`. If a `]]` (or a newline, or
 * another `[[`) shows up between that point and the cursor, the link already
 * closed or was abandoned, so this returns null rather than reopening it.
 */
export function findOpenWikiLink(text: string, cursor: number): OpenWikiLink | null {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf('[[');
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (query.includes(']]') || query.includes('\n') || query.includes('[[')) return null;
  return { start, query };
}

/** Flips the Nth checklist item (0-indexed among checklist lines only) in raw body text. */
export function toggleChecklistAt(body: string, checklistIndex: number): string {
  const rawLines = body.split('\n');
  let seen = -1;
  const nextLines = rawLines.map((raw) => {
    const match = raw.match(CHECKLIST_PATTERN);
    if (!match) return raw;
    seen += 1;
    if (seen !== checklistIndex) return raw;
    const checked = match[1].toLowerCase() === 'x';
    return raw.replace(CHECKLIST_PATTERN, `- [${checked ? ' ' : 'x'}] ${match[2]}`);
  });
  return nextLines.join('\n');
}

/**
 * Parse a recommendation's `detail` markdown into an ordered list of
 * subtasks the client can check off one by one.
 *
 * The Growth Agent writes `detail` as a step-by-step guide. Common shapes
 * we need to tolerate:
 *
 *   Shape A — numbered list:
 *     1. Paso uno...
 *     2. Paso dos...
 *
 *   Shape B — bullet list:
 *     - Paso uno
 *     - Paso dos
 *     * Paso tres
 *
 *   Shape C — section headings:
 *     ## Paso 1: descripción
 *     texto...
 *     ## Paso 2: descripción
 *
 *   Shape D — mix of prose + numbered list:
 *     Contexto general en prosa.
 *     1. Primera acción
 *     2. Segunda acción
 *     Cierre.
 *
 * Rules:
 *   - Strip markdown emphasis (**bold**, _italic_) from subtask text.
 *   - Skip empty lines and non-actionable prose paragraphs.
 *   - If the detail has no recognizable list, return [] — the caller falls
 *     back to showing the raw detail without subtasks.
 *   - Trim to 10 subtasks max (action plans of 10+ steps stop being plans).
 *   - Stable ids generated from position so re-parsing doesn't invalidate
 *     toggle state if the text is re-saved.
 */

export interface ParsedSubtask {
  id: string;            // "st-1", "st-2"...  stable across re-parses
  text: string;          // cleaned of markdown, ≤200 chars
  done: boolean;         // always false at parse time
  done_at?: string | null;
}

const MAX_SUBTASKS = 10;
const MAX_TEXT_LENGTH = 240;

/**
 * Strip inline markdown markers from a fragment, preserving the readable text.
 */
function cleanInline(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')   // bold
    .replace(/__(.*?)__/g, '$1')        // bold alt
    .replace(/\*(.*?)\*/g, '$1')        // italic
    .replace(/_(.*?)_/g, '$1')          // italic alt
    .replace(/`(.*?)`/g, '$1')          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → keep text
    .trim();
}

export function parseSubtasks(detail: string | null | undefined): ParsedSubtask[] {
  if (!detail || typeof detail !== 'string') return [];
  const lines = detail.split(/\r?\n/);
  const items: string[] = [];

  // Regexes for the different list shapes
  const numbered = /^\s*(\d{1,2})[.)]\s+(.+)$/;
  const bulletDash = /^\s*[-*•]\s+(.+)$/;
  const heading = /^\s*#{2,4}\s+(?:paso|step)\s*\d+[:.]?\s*(.+)$/i;

  let lastWasListItem = false;
  let pendingContinuation: string | null = null;

  function pushItem(raw: string) {
    const cleaned = cleanInline(raw).replace(/\s+/g, ' ').slice(0, MAX_TEXT_LENGTH);
    if (cleaned.length >= 3 && items.length < MAX_SUBTASKS) items.push(cleaned);
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00A0/g, ' '); // normalize nbsp
    const trimmed = line.trim();
    if (!trimmed) {
      // Empty line commits any pending continuation
      if (pendingContinuation != null) {
        // already applied — reset
        pendingContinuation = null;
      }
      lastWasListItem = false;
      continue;
    }

    const h = trimmed.match(heading);
    if (h) {
      pushItem(h[1]);
      lastWasListItem = true;
      pendingContinuation = null;
      continue;
    }

    const n = trimmed.match(numbered);
    if (n) {
      pushItem(n[2]);
      lastWasListItem = true;
      pendingContinuation = null;
      continue;
    }

    const b = trimmed.match(bulletDash);
    if (b) {
      pushItem(b[1]);
      lastWasListItem = true;
      pendingContinuation = null;
      continue;
    }

    // Continuation lines (indented after a list item) — append to previous
    if (lastWasListItem && items.length > 0 && /^\s{2,}/.test(line)) {
      const last = items[items.length - 1];
      const addition = cleanInline(trimmed);
      if (last.length + addition.length + 1 <= MAX_TEXT_LENGTH) {
        items[items.length - 1] = `${last} ${addition}`;
      }
      continue;
    }

    // Otherwise: prose line, ignored (we only surface the list structure)
    lastWasListItem = false;
  }

  return items.map((text, i) => ({
    id: `st-${i + 1}`,
    text,
    done: false,
    done_at: null,
  }));
}

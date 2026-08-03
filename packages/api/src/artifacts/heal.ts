/**
 * Artifact format healing (silent auto-healing) — backend-shared edition.
 *
 * This module mirrors `client/src/utils/artifactStream.ts`. The two
 * implementations must stay in sync: any healing rule added here must also
 * exist on the client (and vice-versa), so that messages persisted by the
 * backend render identically when replayed through the frontend.
 *
 * LLM-generated artifacts frequently arrive with structural issues:
 *  - missing closing `:::` (artifact never parses → no preview)
 *  - missing closing code fence inside the artifact
 *  - directive wrapped in a stray code fence (` ```artifact\n:::artifact{...}\n``` `)
 *  - redundant nested code fences around the content (``` ```html … ``` ```)
 *  - non-canonical / aliased `type` values (e.g. "html" instead of "text/html")
 *
 * All helpers are pure and idempotent: running them on already-healed text is
 * a no-op, so they are safe to call at every persistence boundary.
 */

const ARTIFACT_OPEN = ':::artifact';
const ARTIFACT_CLOSE_RE = /^\s{0,3}:::\s*$/;
/** Opening code fence: 3+ backticks optionally followed by an info/lang string. */
const FENCE_OPEN_RE = /^`{3,}/;
/** Closing code fence: 3+ backticks + trailing whitespace only (no info string). */
const FENCE_CLOSE_RE = /^`{3,}\s*$/;

/** Canonical artifact MIME types recognized by the rendering layer. */
export const ARTIFACT_TYPES = [
  'text/html',
  'image/svg+xml',
  'text/markdown',
  'text/md',
  'text/plain',
  'application/vnd.mermaid',
  'application/vnd.react',
  'application/vnd.code-html',
] as const;

/** Common alias → canonical coercion map. */
const TYPE_ALIASES: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  'image/svg': 'image/svg+xml',
  md: 'text/markdown',
  markdown: 'text/markdown',
  text: 'text/plain',
  txt: 'text/plain',
  plain: 'text/plain',
  mermaid: 'application/vnd.mermaid',
  'vnd.mermaid': 'application/vnd.mermaid',
  react: 'application/vnd.react',
  'vnd.react': 'application/vnd.react',
  'code-html': 'application/vnd.code-html',
};

/**
 * Coerce a (possibly invalid/aliased) artifact type to its canonical MIME form.
 * Returns the original value unchanged when no mapping is known, and `undefined`
 * for empty input so callers can fall back to a default.
 */
export function normalizeArtifactType(type: string | undefined | null): string | undefined {
  if (!type) {
    return undefined;
  }
  const trimmed = type.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if ((ARTIFACT_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }
  return TYPE_ALIASES[trimmed] ?? type;
}

/**
 * Artifact types whose content should keep wrapping code fences. Currently
 * empty: every renderer consumes raw content (HTML/SVG/markdown render the
 * markup directly; Mermaid's renderers feed raw syntax to the mermaid library,
 * which rejects ``` ``` wrappers).
 */
const PRESERVE_FENCE_TYPES = new Set<string>([]);

/**
 * Strip redundant wrapping code fences from artifact content. Only acts when
 * the *entire* content is wrapped (first non-empty line is a fence open AND
 * last non-empty line is a fence close); interior code blocks are untouched.
 */
export function normalizeArtifactContent(content: string | undefined, type?: string): string {
  if (!content) {
    return '';
  }
  if (type && PRESERVE_FENCE_TYPES.has(type)) {
    return content;
  }
  let result = content;
  for (let i = 0; i < 3; i++) {
    const stripped = stripOneFenceLayer(result);
    if (stripped === result) {
      break;
    }
    result = stripped;
  }
  return result;
}

function stripOneFenceLayer(text: string): string {
  const lines = text.split('\n');
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') {
    first++;
  }
  if (first >= lines.length || !FENCE_OPEN_RE.test(lines[first].trim())) {
    return text;
  }
  let last = lines.length - 1;
  while (last > first && lines[last].trim() === '') {
    last--;
  }
  if (last <= first || !FENCE_CLOSE_RE.test(lines[last].trim())) {
    return text;
  }
  return lines.slice(first + 1, last).join('\n');
}

type StreamPhase = 'outside' | 'header' | 'body' | 'fence';

/**
 * Strip code fences that wrap a `:::artifact{...}` directive line. Some LLMs
 * confuse the directive syntax with a code-block language and emit:
 *
 * ````
 * ```artifact
 * :::artifact{identifier="x" type="text/html" title="T"}
 * ```
 * ````
 *
 * The wrapping fence makes remark treat the directive as escaped code, so it
 * is never recognized. This helper removes that outer fence. Only matches when
 * the fence wraps a directive line, so it is safe on any message text.
 */
function unwrapDirectiveFences(text: string): string {
  return text.replace(/(`{3,})[^\n]*\n(\s*)(:::artifact\{[^\n]*\})\s*\n`{3,}/g, '$2$3');
}

/**
 * Complete unclosed artifacts in streaming markdown text so remark can parse
 * them, and strip any directive-wrapping code fence. Conservative and
 * idempotent: a fully closed document is returned unchanged.
 *
 * Appended suffix only ever contains the minimal closers (`\n``` ` and/or
 * `\n:::`); the document body is never mutated (apart from fence unwrapping).
 */
export function normalizeArtifactStream(text: string): string {
  if (!text || !text.includes(ARTIFACT_OPEN)) {
    return text;
  }

  const unwrapped = unwrapDirectiveFences(text);

  let phase: StreamPhase = 'outside';
  for (const line of unwrapped.split('\n')) {
    switch (phase) {
      case 'outside': {
        const openIdx = line.indexOf(ARTIFACT_OPEN);
        if (openIdx === -1) {
          break;
        }
        const after = line.slice(openIdx + ARTIFACT_OPEN.length);
        if (!after.includes('{')) {
          break;
        }
        phase = after.includes('}') ? 'body' : 'header';
        break;
      }
      case 'header': {
        if (line.includes('}')) {
          phase = 'body';
        }
        break;
      }
      case 'body': {
        if (ARTIFACT_CLOSE_RE.test(line)) {
          phase = 'outside';
        } else if (FENCE_OPEN_RE.test(line.trim())) {
          phase = 'fence';
        }
        break;
      }
      case 'fence': {
        if (FENCE_CLOSE_RE.test(line.trim())) {
          phase = 'body';
        }
        break;
      }
    }
  }

  if (phase === 'outside' || phase === 'header') {
    return unwrapped;
  }
  const suffix = phase === 'fence' ? '\n```\n:::' : '\n:::';
  return unwrapped + suffix;
}

/**
 * Shape of a structured message content part that carries text. Matches the
 * `TMessageContentParts` text variant used by the LibreChat persistence layer.
 */
interface TextContentPart {
  type: string;
  text?: string;
}

/**
 * Heal both the flat `text` field and each `{type:'text', text}` entry inside
 * a structured `content` array in-place-safe fashion (returns new objects).
 *
 * Use this at every persistence boundary (`db.saveMessage` callsites) so the
 * database and any downstream consumer (history loaders, external v2 callers,
 * share pages) see a consistently-formatted message regardless of which LLM
 * quirks the original response had.
 */
export function healMessagePayload<
  TText extends string | undefined,
  TContent extends readonly TextContentPart[] | undefined,
>(payload: {
  text?: TText;
  content?: TContent;
}): {
  text: TText extends string ? string : undefined;
  content: TextContentPart[];
} {
  const text = (
    payload.text ? normalizeArtifactStream(payload.text) : payload.text
  ) as TText extends string ? string : undefined;

  let content: TextContentPart[] = [];
  if (Array.isArray(payload.content)) {
    content = payload.content.map((part) => {
      if (part && part.type === 'text' && typeof part.text === 'string') {
        return { ...part, text: normalizeArtifactStream(part.text) };
      }
      return part;
    });
  }

  return { text, content };
}

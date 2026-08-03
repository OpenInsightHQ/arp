/**
 * Artifact streaming & format normalization (silent auto-healing).
 *
 * LLM-generated artifacts frequently arrive with structural issues that break
 * rendering, especially mid-stream:
 *  - missing closing `:::` (artifact never parses → no live preview)
 *  - missing closing code fence inside the artifact
 *  - redundant nested code fences (e.g. ``` ```html … ``` ``` on a text/html
 *    artifact) — the inner fence leaks into the rendered content
 *  - non-canonical / aliased `type` values (e.g. "html" instead of "text/html")
 *
 * Three pure, idempotent helpers:
 *  - {@link normalizeArtifactStream} completes unclosed artifacts in the raw
 *    streaming text so remark can parse them before the closing `:::` arrives.
 *  - {@link normalizeArtifactType} coerces common type aliases to canonical MIME.
 *  - {@link normalizeArtifactContent} strips redundant wrapping code fences.
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
 * empty: every renderer in this codebase consumes raw content.
 *  - HTML/SVG/text/markdown: fences are never part of the rendered output.
 *  - Mermaid: `buildMermaidHtml` and `Mermaid.tsx` feed raw syntax to the
 *    mermaid library, which rejects ``` ``` wrappers.
 * Add a type here if a future renderer expects fenced input.
 */
const PRESERVE_FENCE_TYPES = new Set<string>([]);

/**
 * Strip redundant wrapping code fences from artifact content. Handles singly-
 * and multiply-nested fences (the "extra ```html marker" problem) by removing
 * balanced outer fence layers. Only acts when the *entire* content is wrapped
 * (first non-empty line is a fence open AND last non-empty line is a fence
 * close); interior code blocks are left untouched.
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

/** Remove a single balanced fence layer if the whole text is wrapped; no-op otherwise. */
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
 * Strip code fences that wrap a `:::artifact{...}` directive line.
 *
 * Some LLMs confuse the directive syntax with a code-block language and emit:
 *
 * ````
 * ```artifact
 * :::artifact{identifier="x" type="text/html" title="T"}
 * ```
 * ```html
 * <!DOCTYPE html>…
 * ````
 *
 * The wrapping fence (``` ```artifact … ``` ```) makes remark treat the
 * directive as escaped code, so it is never recognized. This helper removes
 * that outer fence so the directive sits directly in the message body, where
 * remark-directive can parse it.
 *
 * Only matches when the fence wraps a directive line (not arbitrary code),
 * so it is safe to run on any message text. Idempotent.
 */
function unwrapDirectiveFences(text: string): string {
  return text.replace(/(`{3,})[^\n]*\n(\s*)(:::artifact\{[^\n]*\})\s*\n`{3,}/g, '$2$3');
}

/**
 * Complete unclosed artifacts in streaming markdown text so remark can parse
 * them before the closing `:::` arrives (enables live preview) and so the
 * "missing close" failure mode is healed. Conservative and idempotent: a fully
 * closed document is returned unchanged, and re-running on healed text is a
 * no-op.
 *
 * Also strips code fences that erroneously wrap `:::artifact` directives (see
 * {@link unwrapDirectiveFences}).
 *
 * Appended suffix only ever contains the minimal closers (`\n``` ` and/or
 * `\n:::`) — the document body is never mutated (apart from fence unwrapping).
 */
export function normalizeArtifactStream(text: string): string {
  if (!text || !text.includes(ARTIFACT_OPEN)) {
    return text;
  }

  // Preprocess: unwrap directives that are trapped inside a code fence.
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
          break; // no attribute block → remark won't parse it; leave untouched
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
    return unwrapped; // header never completed → can't safely synthesize a close
  }
  const suffix = phase === 'fence' ? '\n```\n:::' : '\n:::';
  return unwrapped + suffix;
}

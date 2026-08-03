import {
  normalizeArtifactType,
  normalizeArtifactContent,
  normalizeArtifactStream,
} from '../artifactStream';

describe('artifactStream', () => {
  describe('normalizeArtifactType', () => {
    it('returns undefined for empty/missing input', () => {
      expect(normalizeArtifactType(undefined)).toBeUndefined();
      expect(normalizeArtifactType(null)).toBeUndefined();
      expect(normalizeArtifactType('')).toBeUndefined();
      expect(normalizeArtifactType('   ')).toBeUndefined();
    });

    it('passes canonical types through (lowercased)', () => {
      expect(normalizeArtifactType('text/html')).toBe('text/html');
      expect(normalizeArtifactType('TEXT/HTML')).toBe('text/html');
      expect(normalizeArtifactType('application/vnd.mermaid')).toBe('application/vnd.mermaid');
    });

    it('coerces common aliases', () => {
      expect(normalizeArtifactType('html')).toBe('text/html');
      expect(normalizeArtifactType('svg')).toBe('image/svg+xml');
      expect(normalizeArtifactType('md')).toBe('text/markdown');
      expect(normalizeArtifactType('markdown')).toBe('text/markdown');
      expect(normalizeArtifactType('mermaid')).toBe('application/vnd.mermaid');
      expect(normalizeArtifactType('react')).toBe('application/vnd.react');
      expect(normalizeArtifactType('plain')).toBe('text/plain');
    });

    it('returns the original value for unknown types', () => {
      expect(normalizeArtifactType('application/x-unknown')).toBe('application/x-unknown');
    });
  });

  describe('normalizeArtifactContent', () => {
    it('returns empty string for empty input', () => {
      expect(normalizeArtifactContent(undefined)).toBe('');
      expect(normalizeArtifactContent('')).toBe('');
    });

    it('leaves unwrapped content untouched', () => {
      const html = '<!DOCTYPE html><html><body>hi</body></html>';
      expect(normalizeArtifactContent(html)).toBe(html);
    });

    it('strips a single wrapping fence (no lang)', () => {
      const content = '```\n<html>hi</html>\n```';
      expect(normalizeArtifactContent(content)).toBe('<html>hi</html>');
    });

    it('strips a single wrapping fence (with lang)', () => {
      const content = '```html\n<html>hi</html>\n```';
      expect(normalizeArtifactContent(content)).toBe('<html>hi</html>');
    });

    it('strips multiply-nested fences (the double-fence bug)', () => {
      const content = '```\n```html\n<html>hi</html>\n```\n```';
      expect(normalizeArtifactContent(content)).toBe('<html>hi</html>');
    });

    it('does not strip when there is no closing fence', () => {
      const content = '```html\n<html>hi</html>';
      expect(normalizeArtifactContent(content)).toBe(content);
    });

    it('preserves interior code blocks (only strips whole-content wrappers)', () => {
      const md = 'Some text\n\n```js\nconst x = 1;\n```\n\nMore text';
      expect(normalizeArtifactContent(md)).toBe(md);
    });

    it('strips for mermaid too (renderer consumes raw syntax)', () => {
      const content = '```mermaid\ngraph TD\nA-->B\n```';
      expect(normalizeArtifactContent(content)).toBe('graph TD\nA-->B');
    });
  });

  describe('normalizeArtifactStream', () => {
    it('fast-path: returns input unchanged when no artifact present', () => {
      const text = 'Just some **markdown** and nothing else.';
      expect(normalizeArtifactStream(text)).toBe(text);
    });

    it('is a no-op on a fully closed artifact (idempotent)', () => {
      const text =
        ':::artifact{identifier="x" type="text/html" title="T"}\n```\n<html>hi</html>\n```\n:::';
      expect(normalizeArtifactStream(text)).toBe(text);
    });

    it('appends closing ::: for an unclosed artifact', () => {
      const text = ':::artifact{identifier="x" type="text/html" title="T"}\n<html>hi</html>';
      expect(normalizeArtifactStream(text)).toBe(text + '\n:::');
    });

    it('appends closing fence AND ::: when both are unclosed', () => {
      const text = ':::artifact{identifier="x" type="text/html" title="T"}\n```\n<html>hi';
      expect(normalizeArtifactStream(text)).toBe(text + '\n```\n:::');
    });

    it('is idempotent after healing', () => {
      const text = ':::artifact{identifier="x" type="text/html" title="T"}\n```\n<html>hi';
      const healed = normalizeArtifactStream(text);
      expect(normalizeArtifactStream(healed)).toBe(healed);
    });

    it('does not synthesize a close when the attribute header is incomplete', () => {
      const text = ':::artifact{identifier="x" type="text/html"';
      expect(normalizeArtifactStream(text)).toBe(text);
    });

    it('handles a multi-line attribute header', () => {
      const text = ':::artifact{identifier="x"\n  type="text/html"\n  title="T"}\n<html>hi</html>';
      expect(normalizeArtifactStream(text)).toBe(text + '\n:::');
    });

    it('handles two sequential artifacts and only heals the unclosed one', () => {
      const closed = ':::artifact{identifier="a" type="text/plain" title="A"}\ncode-a\n:::';
      const open = ':::artifact{identifier="b" type="text/plain" title="B"}\ncode-b';
      const text = `${closed}\n\n${open}`;
      expect(normalizeArtifactStream(text)).toBe(text + '\n:::');
    });

    it('ignores a ::: that sits inside an open code fence', () => {
      const text =
        ':::artifact{identifier="x" type="text/plain" title="T"}\n```\nthis ::: is not a close\nstill in code';
      expect(normalizeArtifactStream(text)).toBe(text + '\n```\n:::');
    });

    it('does not treat :::artifact as a close', () => {
      const text = ':::artifact{identifier="x" type="text/plain" title="T"}\ncode';
      // close line absent → healed; ensure the opener itself isn\'t mistaken for a close
      const healed = normalizeArtifactStream(text);
      expect(healed.endsWith(':::')).toBe(true);
      expect(healed).toBe(text + '\n:::');
    });

    it('unwraps a directive trapped inside a ```artifact fence (the real-world bug)', () => {
      // Exact pattern reported by user: LLM wraps :::artifact in a code fence,
      // then opens a separate ```html fence for the content.
      const broken =
        '```artifact\n:::artifact{identifier="dashboard-report" type="text/html" title="Report"}\n```\n```html\n<!DOCTYPE html>\n<html>hi</html>';
      const healed = normalizeArtifactStream(broken);
      // Directive fence stripped; content fence preserved; closing ::: appended
      expect(healed).toContain(':::artifact{identifier="dashboard-report"');
      expect(healed).not.toMatch(/```artifact\n/);
      expect(healed.endsWith(':::')).toBe(true);
    });

    it('is idempotent after unwrapping + healing', () => {
      const broken =
        '```artifact\n:::artifact{identifier="x" type="text/html" title="T"}\n```\n```html\n<html>hi';
      const healed = normalizeArtifactStream(broken);
      expect(normalizeArtifactStream(healed)).toBe(healed);
    });

    it('does not strip fences that are NOT wrapping a directive', () => {
      const text = '```python\nprint("hello")\n```\n\nSome text.';
      expect(normalizeArtifactStream(text)).toBe(text);
    });

    it('unwraps a plain (no-lang) fence around a directive', () => {
      const broken = '```\n:::artifact{identifier="x" type="text/plain" title="T"}\n```\ncontent';
      const healed = normalizeArtifactStream(broken);
      expect(healed.startsWith(':::artifact{identifier="x"')).toBe(true);
      expect(healed).not.toMatch(/```\n:::artifact/);
    });
  });
});

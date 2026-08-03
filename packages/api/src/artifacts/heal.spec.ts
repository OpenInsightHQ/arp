import {
  normalizeArtifactType,
  normalizeArtifactContent,
  normalizeArtifactStream,
  healMessagePayload,
} from './heal';

describe('artifacts/heal', () => {
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
      expect(normalizeArtifactContent('```\n<html>hi</html>\n```')).toBe('<html>hi</html>');
    });

    it('strips a single wrapping fence (with lang)', () => {
      expect(normalizeArtifactContent('```html\n<html>hi</html>\n```')).toBe('<html>hi</html>');
    });

    it('strips multiply-nested fences', () => {
      expect(normalizeArtifactContent('```\n```html\n<html>hi</html>\n```\n```')).toBe(
        '<html>hi</html>',
      );
    });

    it('does not strip when there is no closing fence', () => {
      const content = '```html\n<html>hi</html>';
      expect(normalizeArtifactContent(content)).toBe(content);
    });

    it('preserves interior code blocks', () => {
      const md = 'Some text\n\n```js\nconst x = 1;\n```\n\nMore text';
      expect(normalizeArtifactContent(md)).toBe(md);
    });

    it('strips for mermaid too', () => {
      expect(normalizeArtifactContent('```mermaid\ngraph TD\nA-->B\n```')).toBe('graph TD\nA-->B');
    });
  });

  describe('normalizeArtifactStream', () => {
    it('returns input unchanged when no artifact present', () => {
      const text = 'Just some **markdown** and nothing else.';
      expect(normalizeArtifactStream(text)).toBe(text);
    });

    it('is a no-op on a fully closed artifact', () => {
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

    it('unwraps a directive trapped inside a ```artifact fence', () => {
      const broken =
        '```artifact\n:::artifact{identifier="dashboard" type="text/html" title="Report"}\n```\n```html\n<!DOCTYPE html><html>hi</html>';
      const healed = normalizeArtifactStream(broken);
      expect(healed).toContain(':::artifact{identifier="dashboard"');
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
  });

  describe('healMessagePayload', () => {
    it('heals the flat text field', () => {
      const result = healMessagePayload({
        text: ':::artifact{identifier="x" type="text/html" title="T"}\n<html>hi',
      });
      expect(result.text).toBe(
        ':::artifact{identifier="x" type="text/html" title="T"}\n<html>hi\n:::',
      );
    });

    it('returns undefined text for undefined input', () => {
      const result = healMessagePayload({});
      expect(result.text).toBeUndefined();
    });

    it('returns empty content array when content is undefined', () => {
      const result = healMessagePayload({ text: 'hello' });
      expect(result.content).toEqual([]);
    });

    it('heals each text part in the content array', () => {
      const result = healMessagePayload({
        content: [
          { type: 'text', text: ':::artifact{identifier="a" type="text/plain" title="A"}\ncode' },
          { type: 'tool_call', name: 'foo' },
          { type: 'text', text: 'plain text unaffected' },
        ],
      });
      expect(result.content[0].text).toBe(
        ':::artifact{identifier="a" type="text/plain" title="A"}\ncode\n:::',
      );
      expect(result.content[1]).toEqual({ type: 'tool_call', name: 'foo' });
      expect(result.content[2].text).toBe('plain text unaffected');
    });

    it('does not mutate the input', () => {
      const input = {
        text: ':::artifact{identifier="x" type="text/html" title="T"}\n<html>',
        content: [{ type: 'text', text: ':::artifact{identifier="y" type="text/plain"}\ncode' }],
      };
      const originalText = input.text;
      const originalPartText = input.content[0].text;
      healMessagePayload(input);
      expect(input.text).toBe(originalText);
      expect(input.content[0].text).toBe(originalPartText);
    });
  });
});

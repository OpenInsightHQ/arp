jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: jest.fn(),
  };
});

import { apiBaseUrl } from 'librechat-data-provider';
import { normalizeLocalPaths, buildMarkdownHtml, buildMermaidHtml } from '../artifacts';

describe('normalizeLocalPaths', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns empty input unchanged', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    expect(normalizeLocalPaths('')).toBe('');
  });

  it('returns content unchanged when base path is empty (root deployment)', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('');
    const html = '<script src="/assets/tailwind/tailwind.cdn.js"></script>';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('returns content unchanged when base path is just "/"', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/');
    const html = '<script src="/assets/tailwind/tailwind.cdn.js"></script>';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('prepends the base path to bare /assets/, /vendor/, /fonts/ URLs', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      '<script src="/assets/tailwind/tailwind.cdn.js"></script>\n' +
      '<link href="/fonts/inter.woff2" />\n' +
      "<script>fetch('/vendor/echarts-maps/china.json')</script>";
    const out = normalizeLocalPaths(html);
    expect(out).toContain('src="/arp/assets/tailwind/tailwind.cdn.js"');
    expect(out).toContain('href="/arp/fonts/inter.woff2"');
    expect(out).toContain("fetch('/arp/vendor/echarts-maps/china.json')");
  });

  it('does not touch already-prefixed paths (idempotent)', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<script src="/arp/assets/tailwind/tailwind.cdn.js"></script>';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('is idempotent across multiple invocations', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<script src="/assets/tailwind/tailwind.cdn.js"></script>';
    const once = normalizeLocalPaths(html);
    const twice = normalizeLocalPaths(once);
    expect(twice).toBe(once);
    expect(twice).toContain('src="/arp/assets/tailwind/tailwind.cdn.js"');
  });

  it('leaves external URLs alone', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      '<script src="https://cdn.tailwindcss.com/3.4.17"></script>' +
      '<img src="//cdn.example.com/x.png" />';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('leaves data: and blob: URIs alone', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      '<img src="data:image/png;base64,iVBORw0KGgo=" />' +
      '<img src="blob:https://example.com/abc-123" />';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('leaves hash links, relative paths, and other root paths alone', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      '<a href="#section">x</a>' +
      '<img src="../images/foo.png" />' +
      '<script src="/api/foo"></script>';
    expect(normalizeLocalPaths(html)).toBe(html);
  });

  it('respects an explicit basePath argument', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<script src="/assets/tailwind/tailwind.cdn.js"></script>';
    expect(normalizeLocalPaths(html, '/custom')).toBe(
      '<script src="/custom/assets/tailwind/tailwind.cdn.js"></script>',
    );
  });

  it('handles mixed single and double quotes', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = "<script src='/assets/a.js'></script>" + '<script src="/assets/b.js"></script>';
    const out = normalizeLocalPaths(html);
    expect(out).toContain("src='/arp/assets/a.js'");
    expect(out).toContain('src="/arp/assets/b.js"');
  });

  it('handles CSS url() references with mixed quotes', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      '<style>.a{background:url("/assets/bg.png");}' +
      ".b{background:url('/assets/bg2.png');}</style>";
    const out = normalizeLocalPaths(html);
    expect(out).toContain('url("/arp/assets/bg.png")');
    expect(out).toContain("url('/arp/assets/bg2.png')");
  });

  it('handles XMLHTTPRequest.open() string args', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html =
      "<script>var x=new XMLHttpRequest();x.open('GET','/vendor/echarts-maps/china.json',false);</script>";
    const out = normalizeLocalPaths(html);
    expect(out).toContain("'/arp/vendor/echarts-maps/china.json'");
  });

  it('handles markdown image/link paren syntax', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const md = '![pic](/assets/pic.png) and [docs](/assets/doc.pdf) and [external](https://x.com)';
    const out = normalizeLocalPaths(md);
    expect(out).toContain('![pic](/arp/assets/pic.png)');
    expect(out).toContain('[docs](/arp/assets/doc.pdf)');
    expect(out).toContain('[external](https://x.com)');
  });

  it('handles CSS url() without inner quotes', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<style>.a{background:url(/assets/bg.png);}</style>';
    const out = normalizeLocalPaths(html);
    expect(out).toContain('url(/arp/assets/bg.png)');
  });

  it('does not rewrite paths inside arbitrary prose', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const prose = 'see the /assets folder for details';
    expect(normalizeLocalPaths(prose)).toBe(prose);
  });

  it('handles multiple occurrences on the same line', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<link href="/assets/a.css"/><link href="/assets/b.css"/>';
    const out = normalizeLocalPaths(html);
    expect(out).toContain('"/arp/assets/a.css"');
    expect(out).toContain('"/arp/assets/b.css"');
  });

  it('preserves query strings and fragments', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const html = '<img src="/assets/pic.png?v=1#anchor"/>';
    const out = normalizeLocalPaths(html);
    expect(out).toContain('"/arp/assets/pic.png?v=1#anchor"');
  });
});

describe('buildMarkdownHtml / buildMermaidHtml integration', () => {
  afterEach(() => jest.resetAllMocks());

  it('buildMarkdownHtml rewrites user-content image URLs', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const md = '![pic](/assets/pic.png)';
    const html = buildMarkdownHtml(md);
    expect(html).toContain('/arp/assets/pic.png');
    expect(html).not.toContain('(//assets/pic.png)');
  });

  it('buildMermaidHtml rewrites user-content image URLs', () => {
    (apiBaseUrl as jest.Mock).mockReturnValue('/arp');
    const mermaid = 'flowchart TD\n  A[link](/assets/icon.png)';
    const html = buildMermaidHtml(mermaid);
    expect(html).toContain('/arp/assets/icon.png');
  });
});

import dedent from 'dedent';
import { apiBaseUrl, shadcnComponents } from 'librechat-data-provider';
import type {
  SandpackProviderProps,
  SandpackPredefinedTemplate,
} from '@codesandbox/sandpack-react';
import { markdownCSS } from '~/utils/markdown';
import { buildWatermarkHtml } from '~/utils/watermark';
import type { WatermarkStyleOptions } from '~/utils/watermark';
import {
  injectEchartsChinaMapHelpers,
  prepareArtifactHtmlForDownload as prepareArtifactHtmlForDownloadBase,
  rewriteFetchMapRegistration,
  rewriteGetMapToSyncLoad,
  rewriteInlineChinaDataLookup,
} from '~/utils/echartsMaps';

export type WatermarkInput = WatermarkStyleOptions & {
  text: string;
};

export function prepareArtifactHtmlForDownload(
  content: string,
  opts?: { watermark?: WatermarkInput },
): string {
  let result = normalizeLocalPaths(content);
  result = rewriteCDNScripts(result, ECHARTS_CDN_PATH);
  result = prepareArtifactHtmlForDownloadBase(result);
  result = rewriteTailwindCDN(result, TAILWIND_CDN_PATH);
  result = injectTailwind(result, TAILWIND_CDN_PATH);
  return injectWatermark(result, opts?.watermark);
}

const artifactFilename = {
  'application/vnd.react': 'App.tsx',
  'text/html': 'index.html',
  'application/vnd.code-html': 'index.html',
  // mermaid and markdown types are handled separately in useArtifactProps.ts
  default: 'index.html',
  // 'css': 'css',
  // 'javascript': 'js',
  // 'typescript': 'ts',
  // 'jsx': 'jsx',
  // 'tsx': 'tsx',
};

const artifactTemplate: Record<
  | keyof typeof artifactFilename
  | 'application/vnd.mermaid'
  | 'text/markdown'
  | 'text/md'
  | 'text/plain',
  SandpackPredefinedTemplate | undefined
> = {
  'text/html': 'static',
  'application/vnd.react': 'react-ts',
  'application/vnd.mermaid': 'react-ts',
  'application/vnd.code-html': 'static',
  'text/markdown': 'react-ts',
  'text/md': 'react-ts',
  'text/plain': 'react-ts',
  default: 'static',
  // 'css': 'css',
  // 'javascript': 'js',
  // 'typescript': 'ts',
  // 'jsx': 'jsx',
  // 'tsx': 'tsx',
};

export function getKey(type: string, language?: string): string {
  return `${type}${(language?.length ?? 0) > 0 ? `-${language}` : ''}`;
}

export function getArtifactFilename(type: string, language?: string): string {
  const key = getKey(type, language);
  return artifactFilename[key] ?? artifactFilename.default;
}

export function getTemplate(type: string, language?: string): SandpackPredefinedTemplate {
  const key = getKey(type, language);
  return artifactTemplate[key] ?? (artifactTemplate.default as SandpackPredefinedTemplate);
}

const standardDependencies = {
  three: '^0.167.1',
  'lucide-react': '^0.394.0',
  'react-router-dom': '^6.11.2',
  'class-variance-authority': '^0.6.0',
  clsx: '^1.2.1',
  'date-fns': '^3.3.1',
  'tailwind-merge': '^1.9.1',
  'tailwindcss-animate': '^1.0.5',
  recharts: '2.12.7',
  '@radix-ui/react-accordion': '^1.1.2',
  '@radix-ui/react-alert-dialog': '^1.0.2',
  '@radix-ui/react-aspect-ratio': '^1.1.0',
  '@radix-ui/react-avatar': '^1.1.0',
  '@radix-ui/react-checkbox': '^1.0.3',
  '@radix-ui/react-collapsible': '^1.0.3',
  '@radix-ui/react-dialog': '^1.0.2',
  '@radix-ui/react-dropdown-menu': '^2.1.1',
  '@radix-ui/react-hover-card': '^1.0.5',
  '@radix-ui/react-label': '^2.0.0',
  '@radix-ui/react-menubar': '^1.1.1',
  '@radix-ui/react-navigation-menu': '^1.2.0',
  '@radix-ui/react-popover': '^1.0.7',
  '@radix-ui/react-progress': '^1.1.0',
  '@radix-ui/react-radio-group': '^1.1.3',
  '@radix-ui/react-select': '^2.0.0',
  '@radix-ui/react-separator': '^1.0.3',
  '@radix-ui/react-slider': '^1.1.1',
  '@radix-ui/react-switch': '^1.0.3',
  '@radix-ui/react-tabs': '^1.0.3',
  '@radix-ui/react-toast': '^1.1.5',
  '@radix-ui/react-slot': '^1.1.0',
  '@radix-ui/react-toggle': '^1.1.0',
  '@radix-ui/react-toggle-group': '^1.1.0',
  '@radix-ui/react-tooltip': '^1.2.8',
  'embla-carousel-react': '^8.2.0',
  'react-day-picker': '^9.0.8',
  'dat.gui': '^0.7.9',
  vaul: '^0.9.1',
};

const mermaidDependencies = {
  mermaid: '^11.4.1',
  'react-zoom-pan-pinch': '^3.6.1',
  'class-variance-authority': '^0.6.0',
  clsx: '^1.2.1',
  'tailwind-merge': '^1.9.1',
  '@radix-ui/react-slot': '^1.1.0',
};

const markdownDependencies = {
  'marked-react': '^2.0.0',
};

const dependenciesMap: Record<
  | keyof typeof artifactFilename
  | 'application/vnd.mermaid'
  | 'text/markdown'
  | 'text/md'
  | 'text/plain',
  Record<string, string>
> = {
  'application/vnd.mermaid': mermaidDependencies,
  'application/vnd.react': standardDependencies,
  'text/html': standardDependencies,
  'application/vnd.code-html': standardDependencies,
  'text/markdown': markdownDependencies,
  'text/md': markdownDependencies,
  'text/plain': markdownDependencies,
  default: standardDependencies,
};

export function getDependencies(type: string): Record<string, string> {
  return dependenciesMap[type] ?? standardDependencies;
}

export function getProps(type: string): Partial<SandpackProviderProps> {
  return {
    customSetup: {
      dependencies: getDependencies(type),
    },
  };
}

export const TAILWIND_CDN_PATH = '/arp/assets/tailwind/tailwind.cdn.js';
export const TAILWIND_CDN = 'https://cdn.tailwindcss.com/3.4.17';
export const TAILWIND_CDN_PATTERN = /https?:\/\/cdn\.tailwindcss\.com(?:\/[\d.]+)?/gi;
export const ECHARTS_CDN_PATH = '/arp/assets/echarts/echarts.min.js';
export const ECHARTS_MAPS_PATH = '/arp/vendor/echarts-maps';
export const ECHARTS_CDN_PATTERNS = [
  /https?:\/\/(?:(?:cdnjs\.cloudflare\.com\/ajax\/libs)|(?:fastly\.jsdelivr\.net|cdn\.jsdelivr\.net)\/npm)\/echarts(?:@|\/)[\d.]+\/(?:dist\/)?echarts(?:\.min)?\.js/gi,
  /https?:\/\/unpkg\.com\/echarts@[^/'"\s]+\/dist\/echarts(?:\.min)?\.js/gi,
] as const;
/** @deprecated Use ECHARTS_CDN_PATTERNS */
export const ECHARTS_CDN_PATTERN = ECHARTS_CDN_PATTERNS[0];
const ECHARTS_MAP_CDN_PATTERN =
  /https?:\/\/(?:(?:cdnjs\.cloudflare\.com\/ajax\/libs\/echarts[^/'"\s]*|(?:fastly\.jsdelivr\.net|cdn\.jsdelivr\.net)\/npm\/echarts(?:@[^/'"\s]+|\/[^/'"\s]+)?|unpkg\.com\/echarts(?:@[^/'"\s]+|\/[^/'"\s]+)?)\/map\/(?:json|js)\/(china|world|australia)(?:\.(?:json|js))?|geo\.datav\.aliyun\.com\/areas_v3\/bound\/100000_full\.json)/gi;

export const sharedOptions: SandpackProviderProps['options'] = {
  externalResources: [TAILWIND_CDN],
};

/** Resolve a possibly-relative URL to an absolute one (required for iframe / Sandpack contexts) */
export function resolveUrl(url?: string, fallback?: string): string {
  const path = url ?? fallback ?? '';
  if (!path || /^https?:\/\//i.test(path)) {
    return path;
  }
  return window.location.origin + (path.startsWith('/') ? path : '/' + path);
}

/**
 * Root-relative paths that point at our own static assets. PI-generated
 * artifacts (and any other content unaware of the `/arp/` subpath deployment)
 * may emit bare URLs like `/assets/tailwind/tailwind.cdn.js`. In the main SPA
 * these resolve correctly thanks to `<base href="/arp/">`, but blob iframes
 * used for artifact preview have no base href, so they 404.
 */
const LOCAL_ASSET_PREFIXES = ['assets', 'vendor', 'fonts'] as const;

/**
 * Prefix bare root-relative local asset URLs with the app base path
 * (e.g. `/assets/...` → `/arp/assets/...`). Idempotent: paths already starting
 * with the base are left untouched. External URLs, data/blob URIs, hash links,
 * and relative paths are not affected.
 *
 * Covers three URL contexts:
 *  - Quoted HTML/JS/CSS values: `src="..."`, `fetch('...')`, `url("...")`
 *  - Parenthesized values: `url(/assets/...)`, markdown `![alt](/assets/...)`
 *
 * PI-generated artifacts (and any content unaware of the `/arp/` subpath
 * deployment) emit bare URLs like `/assets/tailwind/tailwind.cdn.js`. In the
 * main SPA these resolve correctly thanks to `<base href="/arp/">`, but blob
 * iframes used for artifact preview have no base href, so they 404.
 */
export function normalizeLocalPaths(content: string, basePath?: string): string {
  if (!content) {
    return content;
  }
  const base = (basePath ?? apiBaseUrl() ?? '').replace(/\/+$/, '');
  if (!base) {
    return content;
  }
  const prefixGroup = LOCAL_ASSET_PREFIXES.join('|');
  const pathFragment = `/(?:${prefixGroup})/[^"'<>\\s)]*`;
  const pattern = new RegExp(`(["'])(${pathFragment})\\1|\\((${pathFragment})\\)`, 'g');
  return content.replace(
    pattern,
    (match, quote?: string, quotedPath?: string, parenPath?: string) => {
      if (quote !== undefined && quotedPath !== undefined) {
        if (quotedPath.startsWith(`${base}/`) || quotedPath.startsWith(`${base}?`)) {
          return match;
        }
        return `${quote}${base}${quotedPath}${quote}`;
      }
      if (parenPath !== undefined) {
        if (parenPath.startsWith(`${base}/`) || parenPath.startsWith(`${base}?`)) {
          return match;
        }
        return `(${base}${parenPath})`;
      }
      return match;
    },
  );
}

/** Backwards-compatible alias */
export function resolveTailwindUrl(url?: string): string {
  return resolveUrl(url, TAILWIND_CDN_PATH);
}

export function getSharedOptions(tailwindCDNURL?: string): SandpackProviderProps['options'] {
  const url = resolveTailwindUrl(tailwindCDNURL);
  if (url === TAILWIND_CDN) {
    return sharedOptions;
  }
  return {
    ...sharedOptions,
    externalResources: [url],
  };
}

/**
 * Replace CDN <script src="..."> URLs with local equivalents.
 * Currently handles ECharts (cdnjs.cloudflare.com → local).
 */
export function rewriteCDNScripts(content: string, echartsCDNURL?: string): string {
  if (!content) {
    return content;
  }
  const echartsUrl = resolveUrl(echartsCDNURL, ECHARTS_CDN_PATH);
  if (!echartsUrl) {
    return content;
  }
  let rewritten = content;
  for (const pattern of ECHARTS_CDN_PATTERNS) {
    rewritten = rewritten.replace(pattern, echartsUrl);
  }
  return rewritten;
}

/** Replace Tailwind CDN script URLs with the local vendored copy. */
export function rewriteTailwindCDN(content: string, tailwindCDNURL?: string): string {
  if (!content) {
    return content;
  }
  const tailwindUrl = resolveTailwindUrl(tailwindCDNURL);
  if (!tailwindUrl) {
    return content;
  }
  return content.replace(TAILWIND_CDN_PATTERN, tailwindUrl);
}

const resolveEchartsMapFile = (mapName: string): string => {
  const normalized = mapName.toLowerCase();
  if (normalized === 'australia') {
    return 'australia.js';
  }
  return `${normalized}.json`;
};

/** Replace ECharts map GeoJSON/JS CDN URLs with local vendored copies. */
export function rewriteEchartsMapSources(content: string, mapsBasePath?: string): string {
  if (!content) {
    return content;
  }
  const mapsBase = resolveUrl(mapsBasePath, ECHARTS_MAPS_PATH);
  if (!mapsBase) {
    return content;
  }
  return content.replace(ECHARTS_MAP_CDN_PATTERN, (_match, mapName?: string) => {
    if (!mapName) {
      return `${mapsBase}/china.json`;
    }
    return `${mapsBase}/${resolveEchartsMapFile(mapName)}`;
  });
}

/** Insert a watermark snippet into an HTML document just before `</body>` (or append). */
function injectWatermark(content: string, watermark?: WatermarkInput): string {
  const snippet = watermark
    ? buildWatermarkHtml(watermark.text, {
        opacity: watermark.opacity,
        fontSize: watermark.fontSize,
      })
    : '';
  if (!content || !snippet) {
    return content;
  }
  if (/<\/body>/i.test(content)) {
    return content.replace(/<\/body>/i, `${snippet}</body>`);
  }
  return `${content}${snippet}`;
}

/**
 * Process HTML artifact content for direct iframe rendering:
 * 0. Normalize bare local asset paths (`/assets/...` → `/arp/assets/...`)
 * 1. Rewrite external CDN script URLs to local equivalents
 * 2. Rewrite ECharts map GeoJSON CDN URLs to local equivalents
 * 3. Rewrite fetch()+registerMap() to synchronous local XHR
 * 4. Fix province name lookups (浙江省 vs 浙江)
 * 5. Inject ECharts map helpers
 * 6. Rewrite Tailwind CDN URLs to local equivalents
 * 7. Inject Tailwind CDN if Tailwind utility classes are detected
 * 8. Inject a watermark when `watermark` text is provided
 */
export function prepareArtifactHtml(
  content: string,
  opts?: {
    tailwindCDNURL?: string;
    echartsCDNURL?: string;
    echartsMapsPath?: string;
    watermark?: WatermarkInput;
  },
): string {
  if (!content) {
    return content;
  }
  let rewritten = normalizeLocalPaths(content);
  rewritten = rewriteCDNScripts(rewritten, opts?.echartsCDNURL);
  const mapsPath = resolveUrl(opts?.echartsMapsPath, ECHARTS_MAPS_PATH);
  rewritten = rewriteEchartsMapSources(rewritten, mapsPath);
  rewritten = rewriteFetchMapRegistration(rewritten, mapsPath);
  rewritten = rewriteGetMapToSyncLoad(rewritten, mapsPath);
  rewritten = rewriteInlineChinaDataLookup(rewritten);
  rewritten = injectEchartsChinaMapHelpers(rewritten, mapsPath);
  rewritten = rewriteTailwindCDN(rewritten, opts?.tailwindCDNURL);
  const withTailwind = injectTailwind(rewritten, opts?.tailwindCDNURL);
  return injectWatermark(withTailwind, opts?.watermark);
}

/**
 * Detect whether HTML content uses Tailwind utility classes in `class=`
 * attributes. Only common, high-signal patterns are matched to avoid
 * false positives from custom CSS frameworks (e.g. Bootstrap).
 */
const TAILWIND_CLASS_PATTERN =
  /\bclass\s*=\s*["'][^"']*\b(?:flex|grid|hidden|inline-flex|inline-block|absolute|relative|fixed|sticky|container|truncate|antialiased|mx-auto|items-(?:start|center|end|between|around|evenly)|justify-(?:start|center|end|between|around|evenly)|[pmwh](?:[trblxy])?-\d|min-[wh]-\d|max-[wh]-\d|(?:text|bg|border|ring|shadow|rounded|gap|from|to|via)-\w|space-[xy]-\d|grid-cols-\d|font-(?:thin|light|normal|medium|semibold|bold|extrabold|black|mono|sans|serif))\b/i;

export function hasTailwindClasses(content: string): boolean {
  return TAILWIND_CLASS_PATTERN.test(content);
}

/**
 * Injects the Tailwind CDN script into an HTML document string when:
 * 1. Tailwind is not already referenced (CDN or local), AND
 * 2. The content actually uses Tailwind utility classes.
 * Used for direct iframe rendering of `text/html` artifacts (bypassing Sandpack)
 * and for HTML export, ensuring both paths render identically.
 */
export function injectTailwind(content: string, cdnUrl?: string): string {
  const cdn = resolveTailwindUrl(cdnUrl);
  if (!content || content.includes('cdn.tailwindcss.com') || content.includes(cdn)) {
    return content;
  }
  if (!hasTailwindClasses(content)) {
    return content;
  }
  const scriptTag = `<script src="${cdn}"></script>`;
  if (/<\/head>/i.test(content)) {
    return content.replace(/<\/head>/i, `${scriptTag}</head>`);
  }
  if (/<html[^>]*>/i.test(content)) {
    return content.replace(/<html[^>]*>/i, `$&<head>${scriptTag}</head>`);
  }
  return `<!DOCTYPE html><html><head>${scriptTag}</head><body>${content}</body></html>`;
}

export const MARKED_CDN_PATH = '/arp/assets/marked/marked.min.js';
export const MERMAID_CDN_PATH = '/arp/assets/mermaid/mermaid.min.js';

/**
 * Build a self-contained HTML document for rendering Markdown content
 * via marked.js. Used for direct iframe blob rendering (bypassing Sandpack).
 */
export function buildMarkdownHtml(
  content: string,
  markedCDNURL?: string,
  watermark?: WatermarkInput,
): string {
  const markedUrl = resolveUrl(markedCDNURL, MARKED_CDN_PATH);
  const normalized = normalizeLocalPaths(content ?? '');
  const escaped = normalized.replace(/<\//g, '<\\/'); // prevent </script> breakout
  const watermarkSnippet = watermark
    ? buildWatermarkHtml(watermark.text, {
        opacity: watermark.opacity,
        fontSize: watermark.fontSize,
      })
    : '';
  return dedent`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${markdownCSS}</style>
<script src="${markedUrl}"></script>
</head>
<body>
<div class="markdown-body" style="padding:2rem;margin:1rem;min-height:100vh;">
<div id="content" style="display:none;">${escaped}</div>
<div id="rendered"></div>
</div>
<script>
(function(){
  var raw = document.getElementById('content').textContent;
  document.getElementById('rendered').innerHTML = marked.parse(raw, { gfm:true, breaks:true });
})();
</script>
${watermarkSnippet}</body>
</html>`;
}

/**
 * Build a self-contained HTML document for rendering Mermaid diagrams
 * via mermaid.js. Used for direct iframe blob rendering (bypassing Sandpack).
 */
export function buildMermaidHtml(
  content: string,
  mermaidCDNURL?: string,
  watermark?: WatermarkInput,
): string {
  const mermaidUrl = resolveUrl(mermaidCDNURL, MERMAID_CDN_PATH);
  const normalized = normalizeLocalPaths(content ?? '');
  const escaped = normalized.replace(/<\//g, '<\\/');
  const watermarkSnippet = watermark
    ? buildWatermarkHtml(watermark.text, {
        opacity: watermark.opacity,
        fontSize: watermark.fontSize,
      })
    : '';
  return dedent`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{background-color:#282C34;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;}</style>
<script src="${mermaidUrl}"></script>
</head>
<body>
<pre class="mermaid" style="background:transparent;border:none;">${escaped}</pre>
<script>
mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
${watermarkSnippet}</body>
</html>`;
}

export const sharedFiles = {
  '/lib/utils.ts': shadcnComponents.utils,
  '/components/ui/accordion.tsx': shadcnComponents.accordian,
  '/components/ui/alert-dialog.tsx': shadcnComponents.alertDialog,
  '/components/ui/alert.tsx': shadcnComponents.alert,
  '/components/ui/avatar.tsx': shadcnComponents.avatar,
  '/components/ui/badge.tsx': shadcnComponents.badge,
  '/components/ui/breadcrumb.tsx': shadcnComponents.breadcrumb,
  '/components/ui/button.tsx': shadcnComponents.button,
  '/components/ui/calendar.tsx': shadcnComponents.calendar,
  '/components/ui/card.tsx': shadcnComponents.card,
  '/components/ui/carousel.tsx': shadcnComponents.carousel,
  '/components/ui/checkbox.tsx': shadcnComponents.checkbox,
  '/components/ui/collapsible.tsx': shadcnComponents.collapsible,
  '/components/ui/dialog.tsx': shadcnComponents.dialog,
  '/components/ui/drawer.tsx': shadcnComponents.drawer,
  '/components/ui/dropdown-menu.tsx': shadcnComponents.dropdownMenu,
  '/components/ui/input.tsx': shadcnComponents.input,
  '/components/ui/label.tsx': shadcnComponents.label,
  '/components/ui/menubar.tsx': shadcnComponents.menuBar,
  '/components/ui/navigation-menu.tsx': shadcnComponents.navigationMenu,
  '/components/ui/pagination.tsx': shadcnComponents.pagination,
  '/components/ui/popover.tsx': shadcnComponents.popover,
  '/components/ui/progress.tsx': shadcnComponents.progress,
  '/components/ui/radio-group.tsx': shadcnComponents.radioGroup,
  '/components/ui/select.tsx': shadcnComponents.select,
  '/components/ui/separator.tsx': shadcnComponents.separator,
  '/components/ui/skeleton.tsx': shadcnComponents.skeleton,
  '/components/ui/slider.tsx': shadcnComponents.slider,
  '/components/ui/switch.tsx': shadcnComponents.switchComponent,
  '/components/ui/table.tsx': shadcnComponents.table,
  '/components/ui/tabs.tsx': shadcnComponents.tabs,
  '/components/ui/textarea.tsx': shadcnComponents.textarea,
  '/components/ui/toast.tsx': shadcnComponents.toast,
  '/components/ui/toaster.tsx': shadcnComponents.toaster,
  '/components/ui/toggle-group.tsx': shadcnComponents.toggleGroup,
  '/components/ui/toggle.tsx': shadcnComponents.toggle,
  '/components/ui/tooltip.tsx': shadcnComponents.tooltip,
  '/components/ui/use-toast.tsx': shadcnComponents.useToast,
  '/public/index.html': dedent`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Document</title>
        <script src="https://cdn.tailwindcss.com/3.4.17"></script>
      </head>
      <body>
        <div id="root"></div>
      </body>
    </html>
  `,
};

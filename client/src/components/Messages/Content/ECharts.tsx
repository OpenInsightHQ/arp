import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import { normalizeMapOption } from '~/utils/echartsMaps';
import useDebounce from '~/hooks/Input/useDebounce';

const DEFAULT_HEIGHT = 420;
const DEBOUNCE_MS = 200;
const MAP_SOURCE_URLS: Record<string, string[]> = {
  world: ['/arp/vendor/echarts-maps/world.json'],
  china: ['/arp/vendor/echarts-maps/china.json'],
  australia: ['/arp/vendor/echarts-maps/australia.js'],
};

type ParseResult = {
  option: Record<string, unknown> | null;
  error: string | null;
  height: number;
};

const mapLoadTasks = new Map<string, Promise<void>>();

const resolveCanonicalMapName = (mapName: string): string => {
  const trimmed = mapName.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized === 'china' || trimmed === '中国' || trimmed === '中华人民共和国') {
    return 'china';
  }

  if (normalized === 'world' || trimmed === '世界') {
    return 'world';
  }

  if (
    normalized === 'australia' ||
    normalized === 'au' ||
    trimmed === '澳大利亚' ||
    trimmed === '澳洲'
  ) {
    return 'australia';
  }

  return normalized;
};

const getRegisteredGeoJSON = (name: string): unknown | null => {
  const record = echarts.getMap(name) as unknown as
    | { geoJSON?: unknown; geoJson?: unknown }
    | undefined;
  return record?.geoJSON ?? record?.geoJson ?? null;
};

const registerMapAliases = (
  canonicalName: string,
  geoJSON: unknown,
  extraAliases: string[] = [],
) => {
  const aliases =
    canonicalName === 'world'
      ? ['world', 'World', '世界']
      : canonicalName === 'china'
        ? ['china', 'China', '中国']
        : canonicalName === 'australia'
          ? ['australia', 'Australia', 'AU', '澳大利亚', '澳洲']
          : [canonicalName];

  // Include the original requested key so `map: "AUSTRALIA"` (or any other casing) still works.
  const unique = new Set<string>([...aliases, ...extraAliases].filter((value) => value.trim()));

  for (const alias of unique) {
    if (!echarts.getMap(alias)) {
      echarts.registerMap(alias, geoJSON as never);
    }
  }
};

const loadScript = (src: string): Promise<void> => {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Cannot load map script: document is not available'));
  }

  const existing = document.querySelector<HTMLScriptElement>(`script[data-echarts-map="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === 'true') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.echartsMap = src;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true },
    );
    script.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
};

const ensureMapRegistered = async (mapName: string) => {
  const trimmed = mapName.trim();
  if (!trimmed || echarts.getMap(trimmed)) {
    return;
  }

  const canonicalName = resolveCanonicalMapName(trimmed);

  // If the canonical map already exists, register aliases without re-fetching.
  if (canonicalName !== trimmed && echarts.getMap(canonicalName)) {
    const geoJSON = getRegisteredGeoJSON(canonicalName);
    if (geoJSON) {
      registerMapAliases(canonicalName, geoJSON, [trimmed]);
      return;
    }
  }

  const mapURLs = MAP_SOURCE_URLS[canonicalName];
  if (!mapURLs?.length) {
    throw new Error(
      `Map "${trimmed}" is not supported. Supported maps: ${Object.keys(MAP_SOURCE_URLS).join(', ')}`,
    );
  }

  let task = mapLoadTasks.get(canonicalName);
  if (!task) {
    task = (async () => {
      let lastStatus = '';
      for (const mapURL of mapURLs) {
        try {
          if (mapURL.endsWith('.js')) {
            // Some community maps ship as a UMD bundle which registers itself via window.echarts.
            (window as unknown as { echarts?: typeof echarts }).echarts ??= echarts;
            await loadScript(mapURL);

            // The bundled map may register itself under a localized name; try common aliases.
            const geoJSON =
              getRegisteredGeoJSON(canonicalName) ??
              (canonicalName === 'australia' ? getRegisteredGeoJSON('澳大利亚') : null);

            if (!geoJSON) {
              lastStatus = 'Script loaded but map was not registered';
              continue;
            }

            registerMapAliases(canonicalName, geoJSON, [trimmed]);
            return;
          }

          const response = await fetch(mapURL);
          if (!response.ok) {
            lastStatus = `${response.status} ${response.statusText}`.trim();
            continue;
          }
          const geoJSON = await response.json();
          registerMapAliases(canonicalName, geoJSON, [trimmed]);
          return;
        } catch (err) {
          lastStatus = err instanceof Error ? err.message : String(err);
          continue;
        }
      }
      throw new Error(
        `Failed to load map "${canonicalName}": ${lastStatus || 'No source available'}`,
      );
    })().catch((error) => {
      mapLoadTasks.delete(canonicalName);
      throw error;
    });

    mapLoadTasks.set(canonicalName, task);
  }

  await task;
};

const extractMapNames = (option: Record<string, unknown>): string[] => {
  const names = new Set<string>();
  const collectMapName = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      names.add(value.trim());
    }
  };

  const series = option.series;
  const seriesList = Array.isArray(series) ? series : series ? [series] : [];
  for (const entry of seriesList) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (record.type === 'map') {
      collectMapName(record.map);
    }
  }

  const geo = option.geo;
  const geos = Array.isArray(geo) ? geo : geo ? [geo] : [];
  for (const entry of geos) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    collectMapName((entry as Record<string, unknown>).map);
  }

  return [...names];
};

const ensureMapsReady = async (option: Record<string, unknown>) => {
  const mapNames = extractMapNames(option);
  if (mapNames.length === 0) {
    return;
  }

  await Promise.all(mapNames.map((name) => ensureMapRegistered(name)));
};

const formatRuntimeError = (error: unknown): string => {
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    if (stack) {
      return stack;
    }
    return error.message || String(error);
  }

  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
  } catch (err) {
    return String(error ?? err);
  }
};

const skipQuotedString = (source: string, start: number): number => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const current = source[index];
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
};

const skipLineComment = (source: string, start: number): number => {
  let index = start + 2;
  while (index < source.length && source[index] !== '\n') {
    index += 1;
  }
  return index;
};

const skipBlockComment = (source: string, start: number): number => {
  let index = start + 2;
  while (index < source.length) {
    if (source[index] === '*' && source[index + 1] === '/') {
      return index + 2;
    }
    index += 1;
  }
  return source.length;
};

const extractFirstJSONObject = (source: string): string | null => {
  const start = source.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let index = start;
  while (index < source.length) {
    const current = source[index];

    if (current === '"' || current === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }

    if (current === '{') {
      depth += 1;
      index += 1;
      continue;
    }

    if (current === '}') {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return source.slice(start, index);
      }
      continue;
    }

    index += 1;
  }

  return null;
};

const findFunctionExpressionEnd = (source: string, start: number): number => {
  let index = start + 'function'.length;

  while (index < source.length) {
    const current = source[index];

    if (current === '"' || current === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }

    if (current === '{') {
      break;
    }

    index += 1;
  }

  if (source[index] !== '{') {
    return -1;
  }

  let depth = 1;
  index += 1;
  while (index < source.length) {
    const current = source[index];

    if (current === '"' || current === "'") {
      index = skipQuotedString(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }

    if (current === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }

    if (current === '{') {
      depth += 1;
      index += 1;
      continue;
    }

    if (current === '}') {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index;
      }
      continue;
    }

    index += 1;
  }

  return -1;
};

const replaceFunctionValuesWithNull = (
  source: string,
): { normalized: string; replaced: boolean } => {
  let index = 0;
  let replaced = false;
  let output = '';

  while (index < source.length) {
    const current = source[index];

    if (current === '"' || current === "'") {
      const end = skipQuotedString(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    if (current === '/' && source[index + 1] === '/') {
      const end = skipLineComment(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    if (current === '/' && source[index + 1] === '*') {
      const end = skipBlockComment(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    output += current;
    if (current !== ':') {
      index += 1;
      continue;
    }

    index += 1;
    const spaceStart = index;
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }
    output += source.slice(spaceStart, index);

    if (!source.startsWith('function', index)) {
      continue;
    }

    const functionEnd = findFunctionExpressionEnd(source, index);
    if (functionEnd === -1) {
      continue;
    }

    output += 'null';
    index = functionEnd;
    replaced = true;
  }

  return { normalized: output, replaced };
};

const parseJSONObject = (
  source: string,
): { parsed: Record<string, unknown> | null; error: string | null } => {
  try {
    const parsed = JSON.parse(source);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { parsed: null, error: 'ECharts option must be a JSON object.' };
    }
    return { parsed: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return { parsed: null, error: `Invalid JSON: ${message}` };
  }
};

const normalizeNullCallbacks = (value: unknown): void => {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => normalizeNullCallbacks(entry));
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if ((key === 'formatter' || key === 'symbolSize') && child === null) {
      delete record[key];
      continue;
    }
    normalizeNullCallbacks(child);
  }
};

const parseOption = (content: string): ParseResult => {
  const trimmed = content.trim();
  if (!trimmed) {
    return { option: null, error: null, height: DEFAULT_HEIGHT };
  }

  const extracted = extractFirstJSONObject(trimmed);
  const candidate = extracted ?? trimmed;

  const strictResult = parseJSONObject(candidate);
  let parsedObject = strictResult.parsed;

  if (!parsedObject) {
    const fallback = replaceFunctionValuesWithNull(candidate);
    if (fallback.replaced) {
      const fallbackResult = parseJSONObject(fallback.normalized);
      parsedObject = fallbackResult.parsed;
    }
  }

  if (!parsedObject) {
    const errorMessage =
      strictResult.error ??
      'Invalid JSON: failed to parse ECharts option. Please return valid JSON only.';
    return { option: null, error: errorMessage, height: DEFAULT_HEIGHT };
  }

  const rawHeight = parsedObject.__height;
  const height =
    typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
      ? Math.round(rawHeight)
      : DEFAULT_HEIGHT;

  const { __height: _ignored, __echarts: _ignoredFlag, ...option } = parsedObject;
  normalizeNullCallbacks(option);

  return { option, error: null, height };
};

const ECharts: React.FC<{ children: string }> = memo(({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const applyTokenRef = useRef(0);
  const debouncedContent = useDebounce(children, DEBOUNCE_MS);
  const [showCode, setShowCode] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const { option, error, height } = useMemo(
    () => parseOption(debouncedContent),
    [debouncedContent],
  );
  const isStreaming = children !== debouncedContent;
  const isPending = Boolean(error) && isStreaming;
  const showError = Boolean(error) && !isPending;
  const showChart = Boolean(option) && !isStreaming && !showCode;
  const showCodePanel = showCode || isStreaming || !option;

  const handleToggleCode = useCallback(() => {
    setShowCode((prev) => !prev);
  }, []);

  const applyOption = useCallback(
    async (chart: echarts.EChartsType, chartOption: Record<string, unknown>) => {
      const token = ++applyTokenRef.current;
      await ensureMapsReady(chartOption);
      if (chartRef.current !== chart || token !== applyTokenRef.current) {
        return;
      }
      chart.setOption(normalizeMapOption(chartOption), { notMerge: true, lazyUpdate: true });
      setRuntimeError(null);
    },
    [],
  );

  useEffect(() => {
    if (!showCodePanel || !isStreaming || !codeRef.current) {
      return;
    }
    const scrollContainer = codeRef.current.querySelector<HTMLElement>('.echarts-code-scroll');
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }, [children, isStreaming, showCodePanel]);

  useEffect(() => {
    if (!showChart || !containerRef.current || chartRef.current) {
      return;
    }

    chartRef.current = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    let cancelled = false;
    if (option) {
      void applyOption(chartRef.current, option).catch((err) => {
        if (!cancelled) {
          setRuntimeError(formatRuntimeError(err));
        }
      });
    }

    return () => {
      cancelled = true;
      applyTokenRef.current += 1;
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [applyOption, option, showChart]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !showChart) {
      return;
    }

    if (!option) {
      chart.clear();
      return;
    }

    let cancelled = false;
    void applyOption(chart, option).catch((err) => {
      if (!cancelled) {
        setRuntimeError(formatRuntimeError(err));
        console.error('ECharts setOption error:', err);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyOption, option, showChart]);

  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container || !showChart) {
      return;
    }

    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener('resize', resize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [showChart]);

  useEffect(() => {
    if (chartRef.current && showChart) {
      chartRef.current.resize();
    }
  }, [height, showChart]);

  return (
    <div className="w-full overflow-hidden rounded-md border border-border-light">
      <div className="flex items-center justify-between border-b border-border-light bg-gray-700 px-4 py-2 text-xs text-gray-200">
        <span>echarts</span>
        <div className="flex items-center gap-2">
          {!showChart && isStreaming && (
            <span className="text-gray-400">Waiting for complete JSON...</span>
          )}
          {option && !isStreaming && (
            <button
              type="button"
              onClick={handleToggleCode}
              className="rounded px-2 py-1 text-xs text-gray-100 hover:bg-gray-600"
            >
              {showCode ? 'Show chart' : 'Show code'}
            </button>
          )}
        </div>
      </div>
      {showChart && <div ref={containerRef} className="w-full" style={{ height }} />}
      {showCodePanel && (
        <div ref={codeRef}>
          <CodeBlock
            lang="json"
            codeChildren={children}
            allowExecution={false}
            blockIndex={0}
            classProp="max-h-[520px] echarts-code-scroll"
          />
        </div>
      )}
      {(showError || runtimeError) && (
        <details className="border-t border-border-light bg-surface-secondary px-3 py-2 text-xs text-text-secondary">
          <summary className="cursor-pointer select-none">
            {showError ? 'Invalid JSON (details)' : 'Render error (details)'}
          </summary>
          <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap text-xs">
            {showError ? error : runtimeError}
          </pre>
        </details>
      )}
    </div>
  );
});

export default ECharts;

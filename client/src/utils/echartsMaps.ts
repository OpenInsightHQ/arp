import { getEmbeddedMapGeoJSON } from '~/utils/echartsMapData';
import type { EchartsMapName } from '~/utils/echartsMapData';

export const CHINA_PROVINCE_SUFFIXES = [
  '特别行政区',
  '壮族自治区',
  '回族自治区',
  '维吾尔自治区',
  '自治区',
  '省',
  '市',
] as const;

export const normalizeChinaProvinceName = (name: string): string => {
  const trimmed = name.trim();
  for (const suffix of CHINA_PROVINCE_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
};

export const isChinaMapKey = (mapKey: unknown): boolean => {
  if (typeof mapKey !== 'string') {
    return false;
  }
  const trimmed = mapKey.trim();
  return trimmed === 'china' || trimmed === 'China' || trimmed === '中国';
};

export const hasMapDataValue = (value: unknown): boolean => {
  if (value == null || value === '') {
    return false;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
};

type MapLabelParams = {
  data?: { value?: unknown };
  name?: string;
};

const wrapMapLabelFormatter = (
  label: Record<string, unknown> | undefined,
  showWhenEmpty = false,
): Record<string, unknown> => {
  const labelRecord = { ...(label ?? {}) };
  if (labelRecord.show === false && !showWhenEmpty) {
    return labelRecord;
  }

  const existingFormatter = labelRecord.formatter;

  labelRecord.formatter = (params: MapLabelParams) => {
    if (!params.data || !hasMapDataValue(params.data.value)) {
      return '';
    }
    if (typeof existingFormatter === 'function') {
      return String(existingFormatter(params));
    }
    if (typeof existingFormatter === 'string') {
      return existingFormatter;
    }
    return params.name ?? '';
  };

  return labelRecord;
};

const enhanceMapSeries = (series: Record<string, unknown>): Record<string, unknown> => {
  if (series.type !== 'map' || !Array.isArray(series.data)) {
    return series;
  }

  const next: Record<string, unknown> = { ...series };

  if (isChinaMapKey(series.map)) {
    next.data = series.data.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== 'string') {
        return entry;
      }
      return {
        ...record,
        name: normalizeChinaProvinceName(record.name),
      };
    });
  }

  const showLabels =
    series.label &&
    typeof series.label === 'object' &&
    !Array.isArray(series.label) &&
    (series.label as Record<string, unknown>).show === true;

  next.label = wrapMapLabelFormatter(
    series.label && typeof series.label === 'object' && !Array.isArray(series.label)
      ? (series.label as Record<string, unknown>)
      : { show: true },
    showLabels,
  );

  const emphasis = series.emphasis;
  if (emphasis && typeof emphasis === 'object' && !Array.isArray(emphasis)) {
    const emphasisRecord = { ...(emphasis as Record<string, unknown>) };
    const emphasisLabel = emphasisRecord.label;
    if (emphasisLabel && typeof emphasisLabel === 'object' && !Array.isArray(emphasisLabel)) {
      emphasisRecord.label = wrapMapLabelFormatter(
        emphasisLabel as Record<string, unknown>,
        true,
      );
    }
    next.emphasis = emphasisRecord;
  }

  return next;
};

const fixVisualMapDimension = (option: Record<string, unknown>): void => {
  const visualMap = option.visualMap;
  if (!visualMap) {
    return;
  }

  const fixOne = (entry: Record<string, unknown>) => {
    if (entry.dimension === 0) {
      delete entry.dimension;
    }
  };

  if (Array.isArray(visualMap)) {
    for (const entry of visualMap) {
      if (entry && typeof entry === 'object') {
        fixOne(entry as Record<string, unknown>);
      }
    }
    return;
  }

  if (typeof visualMap === 'object') {
    fixOne(visualMap as Record<string, unknown>);
  }
};

export const normalizeMapOption = (option: Record<string, unknown>): Record<string, unknown> => {
  const series = option.series;
  const seriesList = Array.isArray(series) ? series : series ? [series] : [];
  let hasMapSeries = false;

  const normalizedSeries = seriesList.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    if (record.type !== 'map') {
      return entry;
    }
    hasMapSeries = true;
    return enhanceMapSeries(record);
  });

  const next: Record<string, unknown> = {
    ...option,
    series: Array.isArray(series)
      ? normalizedSeries
      : series && typeof series === 'object'
        ? normalizedSeries[0]
        : series,
  };

  if (hasMapSeries) {
    fixVisualMapDimension(next);
  }

  return next;
};

/** @deprecated Use normalizeMapOption */
export const normalizeChinaMapOption = normalizeMapOption;

const ECHARTS_MAP_SCRIPT_TAG_PATTERN =
  /<script\b[^>]*\ssrc=(["'])(?:https?:\/\/)?[^"']*(?:\/map\/(?:json|js)\/|\/echarts-maps\/)(china|world|australia)\.(?:js|json)\1[^>]*>\s*<\/script>/gi;

export const buildEchartsMapLoaderTag = (mapsBase: string, mapName: string): string => {
  const normalized = mapName.toLowerCase();
  const file = normalized === 'australia' ? 'australia.js' : `${normalized}.json`;
  const base = mapsBase.endsWith('/') ? mapsBase.slice(0, -1) : mapsBase;
  const url = `${base}/${file}`;

  if (file.endsWith('.js')) {
    return `<script src="${url}"></script>`;
  }

  return `<script>(function(){try{var xhr=new XMLHttpRequest();xhr.open('GET','${url}',false);xhr.send(null);if(xhr.status>=200&&xhr.status<300&&typeof echarts!=='undefined'&&!echarts.getMap('${normalized}')){echarts.registerMap('${normalized}',JSON.parse(xhr.responseText));}}catch(e){console.error('Failed to load ${normalized} map',e);}})();</script>`;
};

export const rewriteEchartsMapScriptTags = (content: string, mapsBasePath: string): string => {
  if (!content) {
    return content;
  }
  return content.replace(ECHARTS_MAP_SCRIPT_TAG_PATTERN, (_match, _quote, mapName: string) =>
    buildEchartsMapLoaderTag(mapsBasePath, mapName),
  );
};

const ECHARTS_MAP_ENHANCER_MARKER = '__LC_ECHARTS_MAP_ENHANCER__';

export const ECHARTS_MAP_ENHANCER_SCRIPT = `<script>(function(){if(typeof echarts==='undefined'||typeof echarts.init!=='function')return;var S=['特别行政区','壮族自治区','回族自治区','维吾尔自治区','自治区','省','市'];function norm(n){for(var i=0;i<S.length;i++){if(n.endsWith(S[i]))return n.slice(0,-S[i].length);}return n;}window.__lcNormChina=norm;function hasVal(v){if(v==null||v==='')return false;if(typeof v==='number')return isFinite(v)&&v!==0;if(Array.isArray(v))return v.length>0;return true;}function isChina(m){return m==='china'||m==='China'||m==='中国';}function wrapLabel(label,showWhenEmpty){var l=Object.assign({show:!!showWhenEmpty},label||{});if(l.show===false&&!showWhenEmpty)return l;var old=l.formatter;l.formatter=function(p){if(!p.data||!hasVal(p.data.value))return'';if(typeof old==='function')return old(p);return old!=null?String(old):(p.name||'');};return l;}function fix(o){if(!o||typeof o!=='object')return;var list=o.series,sl=Array.isArray(list)?list:list?[list]:[];var hasMap=false;sl.forEach(function(ser){if(!ser||ser.type!=='map'||!Array.isArray(ser.data))return;hasMap=true;if(isChina(ser.map)){ser.data=ser.data.map(function(d){return d&&d.name?Object.assign({},d,{name:norm(String(d.name))}):d;});}var showLabels=ser.label&&ser.label.show===true;ser.label=wrapLabel(ser.label,showLabels);if(ser.emphasis){ser.emphasis=Object.assign({},ser.emphasis);if(ser.emphasis.label){ser.emphasis.label=wrapLabel(ser.emphasis.label,true);}}});if(hasMap&&o.visualMap){var vms=Array.isArray(o.visualMap)?o.visualMap:[o.visualMap];vms.forEach(function(vm){if(vm&&vm.dimension===0)delete vm.dimension;});}}var origInit=echarts.init;echarts.init=function(){var chart=origInit.apply(this,arguments);var origSet=chart.setOption.bind(chart);chart.setOption=function(o){if(o&&typeof o==='object'&&!Array.isArray(o))fix(o);return origSet.apply(chart,arguments);};return chart;};})();/*${ECHARTS_MAP_ENHANCER_MARKER}*/</script>`;

export const injectEchartsMapEnhancerOnly = (content: string): string => {
  if (!content.includes('echarts') || content.includes(ECHARTS_MAP_ENHANCER_MARKER)) {
    return content;
  }

  const echartsScriptPattern =
    /(<script\b[^>]*\ssrc=(["'])[^"']*echarts(?:\.min)?\.js\2[^>]*>\s*<\/script>)/i;
  if (echartsScriptPattern.test(content)) {
    return content.replace(echartsScriptPattern, `$1${ECHARTS_MAP_ENHANCER_SCRIPT}`);
  }

  return content;
};

export const injectEchartsChinaMapHelpers = (content: string, mapsBasePath: string): string => {
  if (!content.includes('echarts')) {
    return content;
  }

  const result = rewriteEchartsMapScriptTags(content, mapsBasePath);
  return injectEchartsMapEnhancerOnly(result);
};

const FETCH_MAP_REGISTER_PATTERN =
  /const\s+\w+\s*=\s*await\s+fetch\(\s*(['"])([^'"]+)\1\s*\)\s*;\s*const\s+(\w+)\s*=\s*await\s+\w+\.json\(\)\s*;\s*echarts\.registerMap\(\s*(['"])(china|world|australia)\4\s*,\s*\3\s*\)\s*;/gi;

const MAP_LOOKUP_PATCH_MARKER = '__LC_CHINA_LOOKUP_PATCH__';

const resolveMapFileUrl = (mapsBase: string, mapName: string): string => {
  const normalized = mapName.toLowerCase();
  const file = normalized === 'australia' ? 'australia.js' : `${normalized}.json`;
  const base = mapsBase.endsWith('/') ? mapsBase.slice(0, -1) : mapsBase;
  return `${base}/${file}`;
};

const buildSyncMapLoadSnippet = (
  jsonVar: string,
  mapName: string,
  mapUrl: string,
  embeddedGeoJSON?: object,
): string => {
  if (embeddedGeoJSON) {
    const serialized = JSON.stringify(embeddedGeoJSON);
    return `const ${jsonVar}=${serialized};if(typeof echarts!=='undefined'&&!echarts.getMap('${mapName}')){echarts.registerMap('${mapName}',${jsonVar});}if(!${jsonVar}){console.error('${mapName} map failed to load');return;}`;
  }

  return `const ${jsonVar}=(function(){try{var xhr=new XMLHttpRequest();xhr.open('GET','${mapUrl}',false);xhr.send(null);if(xhr.status<200||xhr.status>=300)return null;var geo=JSON.parse(xhr.responseText);if(typeof echarts!=='undefined')echarts.registerMap('${mapName}',geo);return geo;}catch(e){console.error('Failed to load ${mapName} map',e);return null;}})();if(!${jsonVar}){console.error('${mapName} map failed to load');return;}`;
};

/** Replace async fetch()+registerMap() with synchronous XHR for iframe/CSP compatibility. */
export const rewriteFetchMapRegistration = (
  content: string,
  mapsBasePath: string,
  embeddedMaps?: Partial<Record<EchartsMapName, object>>,
): string => {
  if (!content) {
    return content;
  }

  return content.replace(
    FETCH_MAP_REGISTER_PATTERN,
    (_match, _quote, _url, jsonVar, _mapQuote, mapName: EchartsMapName) => {
      const mapUrl = resolveMapFileUrl(mapsBasePath, mapName);
      const embedded = embeddedMaps?.[mapName];
      return buildSyncMapLoadSnippet(jsonVar, mapName, mapUrl, embedded);
    },
  );
};

/** Fix inline lookups when geo uses 浙江 but data uses 浙江省. */
export const rewriteInlineChinaDataLookup = (content: string): string => {
  if (!content || content.includes(MAP_LOOKUP_PATCH_MARKER)) {
    return content;
  }

  let result = content.replace(
    /(\w+)\.find\(\s*(\w+)\s*=>\s*\2\.name\s*===\s*(\w+)\s*\)/g,
    (_match, arrayName, itemVar, nameVar) =>
      `${arrayName}.find(${itemVar} => ${itemVar}.name === ${nameVar} || (window.__lcNormChina?window.__lcNormChina(${itemVar}.name):${itemVar}.name) === ${nameVar} || (window.__lcNormChina?window.__lcNormChina(${nameVar}):${nameVar}) === ${itemVar}.name)/*${MAP_LOOKUP_PATCH_MARKER}*/`,
  );

  result = result.replace(
    /(\w+)\.find\(\s*(\w+)\s*=>\s*\2\.name\s*===\s*(\w+)\s*\|\|\s*\2\.name\s*===\s*(\w+)\s*\)/g,
    (_match, arrayName, itemVar, nameVarA, nameVarB) =>
      `${arrayName}.find(${itemVar} => ${itemVar}.name === ${nameVarA} || ${itemVar}.name === ${nameVarB} || (window.__lcNormChina?window.__lcNormChina(${itemVar}.name):${itemVar}.name) === ${nameVarA} || (window.__lcNormChina?window.__lcNormChina(${itemVar}.name):${itemVar}.name) === ${nameVarB})/*${MAP_LOOKUP_PATCH_MARKER}*/`,
  );

  return result;
};

const MAP_NAMES: EchartsMapName[] = ['china', 'world', 'australia'];

export const detectRequiredMaps = (content: string): EchartsMapName[] => {
  if (!content) {
    return [];
  }

  const maps = new Set<EchartsMapName>();
  for (const mapName of MAP_NAMES) {
    const patterns = [
      new RegExp(`(?:getMap|registerMap)\\s*\\(\\s*['"]${mapName}['"]`, 'i'),
      new RegExp(`map\\s*:\\s*['"]${mapName}['"]`, 'i'),
      new RegExp(`/map/(?:json|js)/${mapName}\\.(?:json|js)`, 'i'),
      new RegExp(`/echarts-maps/${mapName}\\.(?:json|js)`, 'i'),
    ];
    if (patterns.some((pattern) => pattern.test(content))) {
      maps.add(mapName);
    }
  }
  return [...maps];
};

const GET_MAP_LOAD_PATTERN =
  /const\s+(\w+)\s*=\s*\(function\(\)\{var\s+m\s*=\s*echarts\.getMap\(\s*(['"])(china|world|australia)\2\s*\)\s*;return\s*m\s*&&\s*\(\s*m\.geoJson\s*\|\|\s*m\.geoJSON\s*\)\s*\|\|\s*null\s*;\}\)\(\)\s*;if\s*\(\s*!\s*\1\s*\)\s*\{[^}]*\}\s*;?/gi;

/** Replace echarts.getMap() loads with sync XHR or embedded GeoJSON (file:// safe). */
export const rewriteGetMapToSyncLoad = (
  content: string,
  mapsBasePath: string,
  embeddedMaps?: Partial<Record<EchartsMapName, object>>,
): string => {
  if (!content) {
    return content;
  }

  return content.replace(
    GET_MAP_LOAD_PATTERN,
    (_match, jsonVar, _quote, mapName: EchartsMapName) => {
      const mapUrl = resolveMapFileUrl(mapsBasePath, mapName);
      const embedded = embeddedMaps?.[mapName];
      return buildSyncMapLoadSnippet(jsonVar, mapName, mapUrl, embedded);
    },
  );
};

const stripExternalMapScriptTags = (content: string): string => {
  if (!content) {
    return content;
  }
  return content.replace(ECHARTS_MAP_SCRIPT_TAG_PATTERN, '');
};

const buildInlineMapEmbedScripts = (
  mapNames: EchartsMapName[],
  embeddedMaps: Partial<Record<EchartsMapName, object>>,
): string => {
  return mapNames
    .map((mapName) => {
      const geoJSON = embeddedMaps[mapName] ?? getEmbeddedMapGeoJSON(mapName);
      if (!geoJSON) {
        return '';
      }
      const serialized = JSON.stringify(geoJSON);
      return `<script>(function(){if(typeof echarts==='undefined')return;var geo=${serialized};if(!echarts.getMap('${mapName}'))echarts.registerMap('${mapName}',geo);window.__lcEmbedMap=window.__lcEmbedMap||{};window.__lcEmbedMap['${mapName}']=geo;})();</script>`;
    })
    .join('');
};

/** Prepare HTML for download: embed local map GeoJSON inline (works on file://). */
export const prepareArtifactHtmlForDownload = (content: string): string => {
  if (!content) {
    return content;
  }

  const requiredMaps = detectRequiredMaps(content);
  const embeddedMaps: Partial<Record<EchartsMapName, object>> = {};
  for (const mapName of requiredMaps) {
    const geoJSON = getEmbeddedMapGeoJSON(mapName);
    if (geoJSON) {
      embeddedMaps[mapName] = geoJSON;
    }
  }

  let rewritten = stripExternalMapScriptTags(content);
  rewritten = rewriteFetchMapRegistration(rewritten, '/arp/vendor/echarts-maps', embeddedMaps);
  rewritten = rewriteGetMapToSyncLoad(rewritten, '/arp/vendor/echarts-maps', embeddedMaps);
  rewritten = rewriteInlineChinaDataLookup(rewritten);
  rewritten = injectEchartsMapEnhancerOnly(rewritten);

  const inlineMapScripts = buildInlineMapEmbedScripts(requiredMaps, embeddedMaps);
  if (!inlineMapScripts) {
    return rewritten;
  }

  const echartsScriptPattern =
    /(<script\b[^>]*\ssrc=(["'])[^"']*echarts(?:\.min)?\.js\2[^>]*>\s*<\/script>)/i;
  if (echartsScriptPattern.test(rewritten)) {
    return rewritten.replace(echartsScriptPattern, `$1${inlineMapScripts}`);
  }

  return rewritten;
};

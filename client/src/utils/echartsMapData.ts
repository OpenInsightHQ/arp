import chinaGeoJSON from '../../public/vendor/echarts-maps/china.json';
import worldGeoJSON from '../../public/vendor/echarts-maps/world.json';

export type EchartsMapName = 'china' | 'world' | 'australia';

export const ECHARTS_EMBEDDED_MAP_DATA: Partial<Record<EchartsMapName, object>> = {
  china: chinaGeoJSON as object,
  world: worldGeoJSON as object,
};

export const getEmbeddedMapGeoJSON = (mapName: string): object | null => {
  const normalized = mapName.toLowerCase() as EchartsMapName;
  return ECHARTS_EMBEDDED_MAP_DATA[normalized] ?? null;
};

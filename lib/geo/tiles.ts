import { canvasToGps, gpsToCanvas } from "./projection";

/**
 * Web-Mercator XYZ tile helpers for the satellite basemap.
 *
 * The campus canvas uses a local equirectangular projection, so tiles are placed
 * by projecting each tile's own corners through `gpsToCanvas`. Over a few hundred
 * metres the difference from true Mercator is sub-metre, well under the accuracy
 * of the imagery itself.
 */

/**
 * Esri Wayback release 49059 (captured 2026-04-30). The current World_Imagery
 * layer has heavy cloud over this campus; this dated release is clear, which
 * matters because the imagery is what buildings are traced against.
 */
export const WAYBACK_RELEASE = "49059";
export const WAYBACK_RELEASE_DATE = "2026-04-30";

export const DEFAULT_TILE_URL =
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/` +
  `default028mm/MapServer/tile/${WAYBACK_RELEASE}/{z}/{y}/{x}`;

export const DEFAULT_TILE_ATTRIBUTION =
  `Imagery © Esri, Maxar, Earthstar Geographics (${WAYBACK_RELEASE_DATE})`;

export const MAX_TILE_ZOOM = 19;

export function lngToTileX(lng: number, zoom: number) {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

export function latToTileY(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom);
}

export function tileXToLng(x: number, zoom: number) {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export type PlacedTile = {
  key: string;
  url: string;
  /** Canvas-space placement of the tile's north-west corner. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Tiles covering a canvas-space rectangle, already positioned in canvas units.
 * `maxTiles` caps the request volume so a zoomed-out view cannot fetch hundreds.
 */
export function getTilesForCanvasRect(
  rect: { x: number; y: number; w: number; h: number },
  { urlTemplate = DEFAULT_TILE_URL, maxTiles = 48 }: { urlTemplate?: string; maxTiles?: number } = {}
): { tiles: PlacedTile[]; zoom: number } {
  const nw = canvasToGps(rect.x, rect.y);
  const se = canvasToGps(rect.x + rect.w, rect.y + rect.h);

  const minLng = Math.min(nw.lng, se.lng);
  const maxLng = Math.max(nw.lng, se.lng);
  const minLat = Math.min(nw.lat, se.lat);
  const maxLat = Math.max(nw.lat, se.lat);

  // Highest zoom whose tile count still fits the budget.
  let zoom = MAX_TILE_ZOOM;
  for (; zoom > 10; zoom--) {
    const cols = Math.floor(lngToTileX(maxLng, zoom)) - Math.floor(lngToTileX(minLng, zoom)) + 1;
    const rows = Math.floor(latToTileY(minLat, zoom)) - Math.floor(latToTileY(maxLat, zoom)) + 1;
    if (cols * rows <= maxTiles) break;
  }

  const xStart = Math.floor(lngToTileX(minLng, zoom));
  const xEnd = Math.floor(lngToTileX(maxLng, zoom));
  const yStart = Math.floor(latToTileY(maxLat, zoom));
  const yEnd = Math.floor(latToTileY(minLat, zoom));

  const tiles: PlacedTile[] = [];
  for (let x = xStart; x <= xEnd; x++) {
    for (let y = yStart; y <= yEnd; y++) {
      const tileNw = gpsToCanvas(tileYToLat(y, zoom), tileXToLng(x, zoom));
      const tileSe = gpsToCanvas(tileYToLat(y + 1, zoom), tileXToLng(x + 1, zoom));
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: urlTemplate
          .replace("{z}", String(zoom))
          .replace("{x}", String(x))
          .replace("{y}", String(y)),
        x: tileNw.x,
        y: tileNw.y,
        // +1 closes hairline seams caused by rounding to integer canvas units.
        width: Math.abs(tileSe.x - tileNw.x) + 1,
        height: Math.abs(tileSe.y - tileNw.y) + 1,
      });
    }
  }
  return { tiles, zoom };
}

import { gpsToCanvas, type AffineMatrix } from "./affine";

export interface GPSPosition {
  lat: number;
  lng: number;
  accuracy: number;
  canvasX?: number;
  canvasY?: number;
}

export type GPSPositionCallback = (pos: GPSPosition) => void;

export class GPSWatcher {
  private watchId: number | null = null;
  private matrix: AffineMatrix | null = null;
  private history: { lat: number; lng: number }[] = [];
  private windowSize = 5;
  private lastEmaLat: number | null = null;
  private lastEmaLng: number | null = null;
  private alpha = 0.35; // Exponential Moving Average smoothing factor

  constructor(matrix?: AffineMatrix) {
    if (matrix) this.matrix = matrix;
  }

  public setCalibrationMatrix(matrix: AffineMatrix): void {
    this.matrix = matrix;
  }

  public start(onPosition: GPSPositionCallback, onError?: (err: GeolocationPositionError) => void): boolean {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      return false;
    }

    this.stop();

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;

        // Apply moving average smoothing over window
        this.history.push({ lat: rawLat, lng: rawLng });
        if (this.history.length > this.windowSize) {
          this.history.shift();
        }

        const avgLat = this.history.reduce((sum, p) => sum + p.lat, 0) / this.history.length;
        const avgLng = this.history.reduce((sum, p) => sum + p.lng, 0) / this.history.length;

        // Apply Exponential Moving Average for extra stability against GPS jitter
        let smoothedLat = avgLat;
        let smoothedLng = avgLng;
        if (this.lastEmaLat !== null && this.lastEmaLng !== null) {
          smoothedLat = this.alpha * avgLat + (1 - this.alpha) * this.lastEmaLat;
          smoothedLng = this.alpha * avgLng + (1 - this.alpha) * this.lastEmaLng;
        }
        this.lastEmaLat = smoothedLat;
        this.lastEmaLng = smoothedLng;

        const res: GPSPosition = {
          lat: smoothedLat,
          lng: smoothedLng,
          accuracy: pos.coords.accuracy,
        };

        if (this.matrix) {
          const { x, y } = gpsToCanvas(smoothedLat, smoothedLng, this.matrix);
          res.canvasX = x;
          res.canvasY = y;
        }

        onPosition(res);
      },
      (err) => {
        if (onError) onError(err);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 2000,
      }
    );

    return true;
  }

  public stop(): void {
    if (this.watchId !== null && typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

/**
 * Spatial Grid Index for fast O(1) nearest node lookups
 */
export interface SpatialGridIndex<T extends { x: number; y: number }> {
  cellSize: number;
  grid: Map<string, T[]>;
}

export function buildSpatialGridIndex<T extends { x: number; y: number }>(
  items: T[],
  cellSize = 100
): SpatialGridIndex<T> {
  const grid = new Map<string, T[]>();
  for (const item of items) {
    const cx = Math.floor(item.x / cellSize);
    const cy = Math.floor(item.y / cellSize);
    const key = `${cx},${cy}`;
    const cell = grid.get(key) ?? [];
    cell.push(item);
    grid.set(key, cell);
  }
  return { cellSize, grid };
}

export function findNearestSpatialItem<T extends { x: number; y: number }>(
  spatialIndex: SpatialGridIndex<T>,
  x: number,
  y: number,
  fallbackItems: T[] = []
): { item: T; distance: number } | null {
  const { cellSize, grid } = spatialIndex;
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);

  let nearestItem: T | null = null;
  let minDistance = Infinity;

  // Search current cell and 8 neighboring cells
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      const cell = grid.get(key);
      if (!cell) continue;
      for (const item of cell) {
        const dist = Math.hypot(item.x - x, item.y - y);
        if (dist < minDistance) {
          minDistance = dist;
          nearestItem = item;
        }
      }
    }
  }

  // Fallback to full search if no item was in 3x3 neighborhood
  if (!nearestItem && fallbackItems.length > 0) {
    for (const item of fallbackItems) {
      const dist = Math.hypot(item.x - x, item.y - y);
      if (dist < minDistance) {
        minDistance = dist;
        nearestItem = item;
      }
    }
  }

  return nearestItem ? { item: nearestItem, distance: minDistance } : null;
}

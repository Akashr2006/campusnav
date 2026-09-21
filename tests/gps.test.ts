import { describe, it, expect } from "vitest";
import {
  isValidCoordinate,
  isStalePosition,
  isAccuracyAcceptable,
  shouldUpdatePosition,
  mapGeolocationError,
  mapErrorToStatus,
  normalizePosition,
} from "../features/location/utils";
import { useLocationStore } from "../features/location/location-store";
import { findNearestNodeByGps } from "../lib/geo/haversine";

// ── isValidCoordinate ─────────────────────────────────────────────────────────

describe("isValidCoordinate", () => {
  it("accepts valid coordinates within GPS bounds", () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(11.4965, 77.2774)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(45.5, -73.6)).toBe(true);
  });

  it("rejects latitude outside -90..90 bounds", () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(100, 50)).toBe(false);
  });

  it("rejects longitude outside -180..180 bounds", () => {
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(10, 200)).toBe(false);
  });

  it("rejects NaN, Infinity, and non-number values", () => {
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, NaN)).toBe(false);
    expect(isValidCoordinate(NaN, NaN)).toBe(false);
    expect(isValidCoordinate(Infinity, 0)).toBe(false);
    expect(isValidCoordinate(0, -Infinity)).toBe(false);
  });
});

// ── isStalePosition ───────────────────────────────────────────────────────────

describe("isStalePosition", () => {
  it("marks a recent timestamp as not stale", () => {
    expect(isStalePosition(Date.now() - 1000, 30000)).toBe(false);
    expect(isStalePosition(Date.now(), 30000)).toBe(false);
  });

  it("marks an old timestamp as stale", () => {
    expect(isStalePosition(Date.now() - 60000, 30000)).toBe(true);
    expect(isStalePosition(Date.now() - 31000, 30000)).toBe(true);
  });

  it("uses custom threshold", () => {
    expect(isStalePosition(Date.now() - 5000, 3000)).toBe(true);
    expect(isStalePosition(Date.now() - 2000, 3000)).toBe(false);
  });
});

// ── isAccuracyAcceptable ──────────────────────────────────────────────────────

describe("isAccuracyAcceptable", () => {
  it("accepts accuracy within bounds", () => {
    expect(isAccuracyAcceptable(10, 200)).toBe(true);
    expect(isAccuracyAcceptable(50, 200)).toBe(true);
    expect(isAccuracyAcceptable(200, 200)).toBe(true);
  });

  it("rejects accuracy worse than the maximum", () => {
    expect(isAccuracyAcceptable(201, 200)).toBe(false);
    expect(isAccuracyAcceptable(500, 200)).toBe(false);
  });

  it("accepts null accuracy (no info available)", () => {
    expect(isAccuracyAcceptable(null, 200)).toBe(true);
  });

  it("rejects NaN and zero accuracy", () => {
    expect(isAccuracyAcceptable(NaN, 200)).toBe(false);
    expect(isAccuracyAcceptable(0, 200)).toBe(false);
  });
});

// ── shouldUpdatePosition (jitter filtering) ──────────────────────────────────

describe("shouldUpdatePosition", () => {
  it("always accepts the first position (prev is null)", () => {
    expect(
      shouldUpdatePosition(null, { latitude: 11.4965, longitude: 77.2774 }, 3)
    ).toBe(true);
  });

  it("rejects movement below jitter threshold", () => {
    // ~1 meter difference — well below the 3m threshold
    expect(
      shouldUpdatePosition(
        { latitude: 11.496500, longitude: 77.277400 },
        { latitude: 11.496501, longitude: 77.277401 },
        3
      )
    ).toBe(false);
  });

  it("accepts movement above jitter threshold", () => {
    // ~111 meter difference — well above the 3m threshold
    expect(
      shouldUpdatePosition(
        { latitude: 11.496500, longitude: 77.277400 },
        { latitude: 11.497500, longitude: 77.277400 },
        3
      )
    ).toBe(true);
  });

  it("uses configurable threshold", () => {
    // ~15 meters apart, threshold = 20m → should reject
    expect(
      shouldUpdatePosition(
        { latitude: 11.49650, longitude: 77.27740 },
        { latitude: 11.49663, longitude: 77.27740 },
        20
      )
    ).toBe(false);

    // Same points with threshold = 10m → should accept
    expect(
      shouldUpdatePosition(
        { latitude: 11.49650, longitude: 77.27740 },
        { latitude: 11.49663, longitude: 77.27740 },
        10
      )
    ).toBe(true);
  });
});

// ── mapGeolocationError ───────────────────────────────────────────────────────

describe("mapGeolocationError", () => {
  it("maps PERMISSION_DENIED to denied status and friendly message", () => {
    const error = {
      code: 1,
      message: "User denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;

    const result = mapGeolocationError(error);
    expect(result.code).toBe("PERMISSION_DENIED");
    expect(result.userMessage).toContain("Location access is required");

    expect(mapErrorToStatus(error)).toBe("denied");
  });

  it("maps POSITION_UNAVAILABLE to unavailable status", () => {
    const error = {
      code: 2,
      message: "Position unavailable",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;

    const result = mapGeolocationError(error);
    expect(result.code).toBe("POSITION_UNAVAILABLE");
    expect(result.userMessage).toContain("could not be determined");

    expect(mapErrorToStatus(error)).toBe("unavailable");
  });

  it("maps TIMEOUT to error status", () => {
    const error = {
      code: 3,
      message: "Timeout",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;

    const result = mapGeolocationError(error);
    expect(result.code).toBe("TIMEOUT");
    expect(result.userMessage).toContain("timed out");

    expect(mapErrorToStatus(error)).toBe("error");
  });
});

// ── normalizePosition ─────────────────────────────────────────────────────────

describe("normalizePosition", () => {
  it("correctly normalizes a GeolocationPosition to GPSLocation", () => {
    const mockPosition = {
      coords: {
        latitude: 11.4965,
        longitude: 77.2774,
        accuracy: 12,
        altitude: 285,
        altitudeAccuracy: 10,
        heading: 45,
        speed: 1.2,
      },
      timestamp: 1700000000000,
    } as GeolocationPosition;

    const result = normalizePosition(mockPosition);
    expect(result.latitude).toBe(11.4965);
    expect(result.longitude).toBe(77.2774);
    expect(result.accuracy).toBe(12);
    expect(result.altitude).toBe(285);
    expect(result.altitudeAccuracy).toBe(10);
    expect(result.heading).toBe(45);
    expect(result.speed).toBe(1.2);
    expect(result.timestamp).toBe(1700000000000);
  });

  it("handles null optional fields gracefully", () => {
    const mockPosition = {
      coords: {
        latitude: 0,
        longitude: 0,
        accuracy: 100,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: 1700000000000,
    } as GeolocationPosition;

    const result = normalizePosition(mockPosition);
    expect(result.altitude).toBeNull();
    expect(result.altitudeAccuracy).toBeNull();
    expect(result.heading).toBeNull();
    expect(result.speed).toBeNull();
  });
});

// ── Location Store & Map Matching Integration Tests ─────────────────────────

describe("Location Store & Map Matching Integration", () => {
  it("updates useLocationStore state correctly", () => {
    useLocationStore.getState().setLocationState({
      lat: 11.4965,
      lng: 77.2774,
      accuracy: 10,
      status: "active",
      isTracking: true,
      isGpsActive: true,
      matchedNodeId: "n-outdoor-1",
    });

    const state = useLocationStore.getState();
    expect(state.lat).toBe(11.4965);
    expect(state.lng).toBe(77.2774);
    expect(state.status).toBe("active");
    expect(state.matchedNodeId).toBe("n-outdoor-1");
  });

  it("matches real GPS coordinates to the nearest outdoor graph node", () => {
    const sampleNodes = [
      { id: "n-out-1", floorId: "f-out", type: "OUTDOOR_PATH", lat: 11.4965, lng: 77.2774, x: 400, y: 300 },
      { id: "n-out-2", floorId: "f-out", type: "BUILDING_ENTRANCE", lat: 11.4980, lng: 77.2790, x: 600, y: 500 },
      { id: "n-indoor-1", floorId: "f-101", type: "ROOM", lat: 11.4965, lng: 77.2774, x: 400, y: 300 },
    ];

    const match = findNearestNodeByGps(11.49651, 77.27741, sampleNodes as any, "f-out");
    expect(match.node).not.toBeNull();
    expect(match.node?.id).toBe("n-out-1");
    expect(match.distanceMeters).toBeLessThan(10);
  });

  it("correctly reflects location turned off / stopped state in location store", () => {
    useLocationStore.getState().resetLocationState();
    const state = useLocationStore.getState();
    expect(state.isGpsActive).toBe(false);
    expect(state.isTracking).toBe(false);
    expect(state.status).toBe("idle");
    expect(state.lat).toBe(0);
    expect(state.lng).toBe(0);
  });

  it("handles location error and permission denied by setting isGpsActive and isTracking to false", () => {
    const mockError: GeolocationPositionError = {
      code: 1, // PERMISSION_DENIED
      message: "User denied Geolocation",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };

    const gpsErr = mapGeolocationError(mockError);
    const status = mapErrorToStatus(mockError);

    expect(status).toBe("denied");
    expect(gpsErr.code).toBe("PERMISSION_DENIED");

    useLocationStore.getState().setLocationState({
      status,
      isTracking: false,
      isGpsActive: false,
      error: gpsErr.userMessage,
      gpsError: gpsErr,
    });

    const state = useLocationStore.getState();
    expect(state.isGpsActive).toBe(false);
    expect(state.isTracking).toBe(false);
    expect(state.status).toBe("denied");
  });
});

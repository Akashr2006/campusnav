import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampus3D } from "../features/navigation-3d/lib/campus-3d";
import { createPathRouter, type PathNetworkFile, type RoutePlace } from "../features/navigation/lib/path-network";
import { getValidNavigationDestinations } from "../shared/lib/destination-utils";

// The place names put on the drone survey from GeoBITs (the BIT students' campus
// map) on 2026-10-14: every rib of the two academic combs, the gates and the
// small places, all findable and all reachable.
const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
const graph = raw.snapshot ?? raw;
const campus = buildCampus3D(graph);
const footprints = JSON.parse(readFileSync(resolve(__dirname, "../public/drone/footprints.json"), "utf-8")).footprints as {
  outline: [number, number][];
  buildingId: string | null;
}[];
const byName = (name: string) => campus.buildings.find((b) => b.name === name);

describe("campus places", () => {
  it("names each rib of the IB and AS blocks as its own surveyed block", () => {
    for (const block of ["IB", "AS"])
      for (let n = 1; n <= 12; n++) {
        const b = byName(`${block} Rib ${n}`);
        expect(b, `${block} Rib ${n}`).toBeDefined();
        expect(footprints.some((f) => f.buildingId === b!.id)).toBe(true);
      }
  });

  it("keeps none of the names GeoBITs showed were placeholders or misplaced", () => {
    for (const old of ["Academic Block W", "Academic Block C", "Academic Block E", "BIT Bus Stop", "Poly Houses", "Central Hall", "Block S1", "Hostel Block A", "East Block 4", "North Block B3"])
      expect(byName(old), old).toBeUndefined();
  });

  it("has the main gate as a building and the west gates as gates", () => {
    expect(byName("Main Gate")).toBeDefined();
    const gates = graph.nodes.filter((n: { type: string }) => n.type === "GATE").map((n: { name: string }) => n.name);
    expect(gates).toEqual(expect.arrayContaining(["West Gate", "West Gate (Staffs)"]));
  });

  it("finds a place by its earlier name", () => {
    const dests = getValidNavigationDestinations(graph);
    const find = (q: string) => dests.filter((d) => d.name === q || (d.aliases ?? []).some((a) => a.toLowerCase() === q.toLowerCase())).map((d) => d.name);
    expect(find("Bannari Amman Auditorium")).toContain("Main Auditorium");
    expect(find("Sun Flower Block")).toContain("SF Block");
    expect(find("NRI Hostel")).toContain("Coral Hostel");
  });

  it("routes from the main gate to every gate and small place", () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, "../public/drone/paths.json"), "utf-8")) as PathNetworkFile;
    const places: RoutePlace[] = campus.buildings.map((b) => {
      const roofs = footprints.filter((f) => f.buildingId === b.id).map((f) => f.outline.map(([x, z]) => ({ x, z })));
      return { key: b.id, name: b.name, polygons: roofs.length ? roofs : [b.outline], centre: b.centre, land: b.isSiteFeature, walkThrough: false };
    });
    const router = createPathRouter(file, places);
    const gate = byName("Main Gate")!;
    const points = campus.nodes.filter((n) => n.name && ["GATE", "FACILITY", "OUTDOOR", "ENTRANCE"].includes(n.type ?? ""));
    expect(points.length).toBeGreaterThan(30);
    const failed = points.filter((n) => !router.route({ place: gate.id }, { point: n.position, name: n.name! })).map((n) => n.name);
    expect(failed).toEqual([]);
  });
});

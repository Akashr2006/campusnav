import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getValidNavigationDestinations } from "../shared/lib/destination-utils";

// The rooms from the college's venue list (2026-10-22). The list itself is sensitive
// (CCTV, equipment, departments, staff IDs): only what a door sign says may be here,
// because the repository and the site are public.
const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
const graph = raw.snapshot ?? raw;
const rooms = graph.nodes.filter((n: { id: string }) => n.id.startsWith("room-"));
const ALLOWED = new Set(["id", "campusId", "type", "name", "venueType", "floorId", "x", "y", "lat", "lng", "visibleToUser", "searchable"]);

describe("rooms from the venue list", () => {
  it("are all there", () => {
    expect(rooms.length).toBeGreaterThanOrEqual(280);
  });

  it("carry door-sign details only", () => {
    for (const r of rooms) for (const k of Object.keys(r)) expect(ALLOWED.has(k), `${r.id}.${k}`).toBe(true);
    const text = JSON.stringify(rooms).toLowerCase();
    for (const word of ["cctv", "wifi", "projector", "capacity", "desk", "department", "created_by", "updated_by"]) expect(text).not.toContain(word);
  });

  it("sit on a floor of a mapped building", () => {
    const floors = new Map(graph.floors.map((f: { id: string }) => [f.id, f]));
    const buildings = new Set(graph.buildings.map((b: { id: string }) => b.id));
    for (const r of rooms) {
      const f = floors.get(r.floorId) as { buildingId: string } | undefined;
      expect(f, r.id).toBeDefined();
      expect(buildings.has(f!.buildingId)).toBe(true);
    }
  });

  it("show in search with their type, building and floor", () => {
    const dests = getValidNavigationDestinations(graph);
    const ew101 = dests.find((d) => d.name === "EW 101");
    expect(ew101?.category).toBe("Classroom · AS Block · Floor 1");
    expect(ew101?.buildingId).toBe("n-blk-a2");
    const ae301 = dests.find((d) => d.name.startsWith("AE301"));
    expect(ae301?.buildingId).toBe("f-blk-s"); // the Research Park, 3rd floor
  });
});

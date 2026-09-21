# -*- coding: utf-8 -*-
"""Build a campus graph from OSM road geometry plus traced building footprints."""
import json, math, os, sys

MAP_ORIGIN = {"lat": 11.493317972, "lng": 77.275954400}
PIXELS_PER_METER = 4

def metres_per_degree(lat):
    r = math.radians(lat)
    return (111132.92 - 559.82*math.cos(2*r) + 1.175*math.cos(4*r),
            111412.84*math.cos(r) - 93.5*math.cos(3*r))

MPD_LAT, MPD_LNG = metres_per_degree(MAP_ORIGIN["lat"])

def gps_to_canvas(lat, lng):
    x = (lng - MAP_ORIGIN["lng"]) * MPD_LNG * PIXELS_PER_METER
    y = -(lat - MAP_ORIGIN["lat"]) * MPD_LAT * PIXELS_PER_METER
    return round(x), round(y)

def dist_m(a, b):
    dx = (a["lng"]-b["lng"]) * MPD_LNG
    dy = (a["lat"]-b["lat"]) * MPD_LAT
    return math.hypot(dx, dy)

def point_in_ring(lat, lng, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        j = (i-1) % n
        yi, xi = ring[i]["lat"], ring[i]["lng"]
        yj, xj = ring[j]["lat"], ring[j]["lng"]
        if ((yi > lat) != (yj > lat)) and (lng < (xj-xi)*(lat-yi)/((yj-yi) or 1e-12) + xi):
            inside = not inside
    return inside

def main(sp, out_path):
    osm = json.load(open(os.path.join(sp, "osm.json"), encoding="utf-8"))

    boundary = None
    for e in osm["elements"]:
        if e.get("tags", {}).get("amenity") == "college" and e.get("geometry"):
            boundary = [{"lat": p["lat"], "lng": p["lon"]} for p in e["geometry"]]
    if not boundary:
        raise SystemExit("campus boundary not found in OSM extract")

    nodes, edges = [], []
    seen = {}          # rounded coord -> node id
    node_seq = [0]

    def node_at(lat, lng, ntype="OUTDOOR_PATH", name=None):
        key = (round(lat, 6), round(lng, 6))
        if key in seen:
            return seen[key]
        node_seq[0] += 1
        nid = f"n-road-{node_seq[0]}"
        x, y = gps_to_canvas(lat, lng)
        rec = {"id": nid, "campusId": "c1", "type": ntype, "floorId": "f-out",
               "x": x, "y": y, "lat": lat, "lng": lng,
               "visibleToUser": bool(name), "searchable": bool(name)}
        if name:
            rec["name"] = name
        nodes.append(rec)
        seen[key] = nid
        return nid

    # Roads that actually fall inside the campus boundary become the drivable network.
    road_count = 0
    for e in osm["elements"]:
        t = e.get("tags", {})
        if t.get("highway") not in ("service", "unclassified", "residential", "footway", "path"):
            continue
        geom = [{"lat": p["lat"], "lng": p["lon"]} for p in (e.get("geometry") or [])]
        inside = [p for p in geom if point_in_ring(p["lat"], p["lng"], boundary)]
        if len(inside) < 2:
            continue
        road_count += 1
        is_service = t.get("highway") in ("service", "unclassified", "residential")
        prev = None
        for p in inside:
            nid = node_at(p["lat"], p["lng"], "ROAD_JUNCTION" if is_service else "OUTDOOR_PATH")
            if prev:
                a = next(n for n in nodes if n["id"] == prev)
                b = next(n for n in nodes if n["id"] == nid)
                d = round(dist_m({"lat": a["lat"], "lng": a["lng"]}, {"lat": b["lat"], "lng": b["lng"]}))
                if d > 0:
                    edges.append({"id": f"e-{prev}-{nid}", "from": prev, "to": nid,
                                  "fromNodeId": prev, "toNodeId": nid,
                                  "type": "ROAD" if is_service else "WALK",
                                  "pathType": "EV" if is_service else "WALK",
                                  "distance": d, "bidirectional": True})
            prev = nid

    snapshot = {
        "campus": {"id": "c1", "name": "Bannari Amman Institute of Technology",
                   "slug": "main", "lat": MAP_ORIGIN["lat"], "lng": MAP_ORIGIN["lng"]},
        "buildings": [], "floors": [], "nodes": nodes, "edges": edges,
        "destinations": [], "obstacles": [], "stairGroups": [], "liftGroups": [],
        "doors": [], "events": [],
        "boundary": boundary,
    }
    json.dump({"version": 1, "snapshot": snapshot,
               "publishedAt": "2026-09-07T00:00:00.000Z",
               "publishedBy": "osm-import",
               "notes": "Campus boundary and internal roads from OpenStreetMap"},
              open(out_path, "w", encoding="utf-8"), indent=1)
    print(f"roads used: {road_count}, nodes: {len(nodes)}, edges: {len(edges)}")
    print(f"boundary points: {len(boundary)}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

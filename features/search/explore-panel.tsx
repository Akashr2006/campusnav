"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Building2, MapPin, Search, SearchX } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { campusStore } from "@/shared/lib/campus-store";
import type { Destination } from "@/shared/data/campus";

import { isStairOrLiftOrUnnamed } from "@/shared/lib/destination-utils";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.035,
      delayChildren: 0.02,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
};

export function ExplorePanel() {
  const [mounted, setMounted] = useState(false);
  // The published graph is fetched after mount. Until it settles we cannot tell
  // "campus is empty" from "not loaded yet", and showing the empty state on that
  // guess made a fully populated campus flash "No campus data yet" on every load.
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [storeData, setStoreData] = useState<ReturnType<typeof campusStore.getPublishedData>>(() => campusStore.getPublishedData());
  const [category, setCategory] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
    let isCancelled = false;
    const updateData = () => {
      if (!isCancelled) {
        setStoreData(campusStore.getPublishedData());
      }
    };
    updateData();
    campusStore
      .fetchPublishedData()
      .then((freshData) => {
        if (!isCancelled && freshData) {
          setStoreData(freshData);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setRemoteLoaded(true);
      });
    const unsub = campusStore.subscribe(updateData);
    return () => {
      isCancelled = true;
      unsub();
    };
  }, []);

  const items = useMemo(() => {
    const nodeMap = new Map<string, any>();
    (storeData.nodes || []).forEach((n) => nodeMap.set(n.id, n));

    // Destinations from store (exclude destinations whose linked node is hidden or stairs/lifts)
    const destItems: Destination[] = (storeData.destinations || [])
      .filter((d) => {
        if (!d.name || d.name.trim().length === 0) return false;
        if (d.nodeId) {
          const linkedNode = nodeMap.get(d.nodeId);
          if (linkedNode && (isStairOrLiftOrUnnamed(linkedNode) || linkedNode.visibleToUser === false)) {
            return false;
          }
        }
        return !isStairOrLiftOrUnnamed(d);
      });

    // Buildings from store
    const buildingItems = (storeData.buildings || []).map((b) => ({
      id: b.id,
      name: b.name,
      category: "Building",
      floorId: "f-out",
      nodeId: b.id,
      aliases: [b.shortCode || "", b.name].filter(Boolean),
    }));

    // Named Nodes (Gates, Entrances, Landmarks) from store
    const namedNodeItems = (storeData.nodes || [])
      .filter((n) => n.name && n.name.trim().length > 0 && n.visibleToUser !== false && !isStairOrLiftOrUnnamed(n))
      .map((n) => {
        const category =
          n.type === "GATE"
            ? "Gate / Entrance"
            : n.type === "BUILDING_ENTRANCE" || n.type === "ROOM_ENTRANCE"
            ? "Entrance"
            : n.type === "STAIR" || n.type === "LIFT"
            ? "Floor Transition"
            : n.type === "RECEPTION"
            ? "Reception"
            : n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.type === "ROAD_JUNCTION"
            ? "Campus Landmark"
            : "Map Location";

        return {
          id: n.id,
          name: n.name!,
          category: category,
          floorId: n.floorId,
          nodeId: n.id,
          aliases: [
            n.name!,
            n.type,
            ...(n.name!.toLowerCase().includes("gate") ? ["gate", "entrance", "main gate", "a gate"] : []),
            ...(n.name!.toLowerCase().includes("entrance") ? ["entrance", "entry", "door"] : []),
          ],
        };
      });

    const map = new Map<string, Destination>();
    destItems.forEach((d) => map.set(d.id, d));
    buildingItems.forEach((b) => {
      if (!map.has(b.id)) map.set(b.id, b);
    });

    // A destination and the node it sits on are the same place with different
    // ids, so dedupe on the node as well or the room is listed twice.
    const claimedNodeIds = new Set<string>();
    map.forEach((entry) => {
      if (entry.nodeId) claimedNodeIds.add(entry.nodeId);
    });

    namedNodeItems.forEach((n) => {
      if (map.has(n.id) || claimedNodeIds.has(n.id)) return;
      map.set(n.id, n);
      claimedNodeIds.add(n.id);
    });

    return Array.from(map.values());
  }, [storeData]);

  const searchResults = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      const nameMatch = i.name.toLowerCase().includes(needle);
      const catMatch = (i.category ?? "").toLowerCase().includes(needle);
      const aliasMatch = (i.aliases ?? []).some((a) => a.toLowerCase().includes(needle));
      return nameMatch || catMatch || aliasMatch;
    });
  }, [items, q]);

  // floorId -> "Building · Floor", used as the card's location line
  const locationByFloorId = useMemo(() => {
    const buildingNames = new Map((storeData.buildings || []).map((b) => [b.id, b.name]));
    const map = new Map<string, string>();
    (storeData.floors || []).forEach((f) => {
      const building = buildingNames.get(f.buildingId);
      map.set(f.id, [building, f.name].filter(Boolean).join(" · "));
    });
    return map;
  }, [storeData]);

  const locationOf = (floorId?: string) =>
    (floorId && locationByFloorId.get(floorId)) || "Outdoor campus";

  // Clean category chips
  const categories = useMemo(() => {
    const rawSet = new Set(searchResults.map((i) => i.category || "General"));
    return Array.from(rawSet);
  }, [searchResults]);

  const filtered = useMemo(() => {
    if (!category) return searchResults;
    return searchResults.filter((i) => (i.category || "General") === category);
  }, [searchResults, category]);

  if (!mounted || (!remoteLoaded && items.length === 0)) {
    return (
      <div className="flex h-48 items-center justify-center p-6 text-sm text-[rgb(var(--muted-fg))]">
        <span className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent inline-block" />
        Loading destinations…
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-6 flex items-center">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-fg))] z-10 pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — Buildings, Library, Labs, Rooms…"
          className="h-12 w-full border bg-[rgb(var(--card))] pl-10 pr-4 text-sm rounded-xl transition-shadow focus-visible:ring-2 focus-visible:ring-[rgb(var(--primary))]"
        />
      </div>

      <div className="mb-6 flex items-center overflow-x-auto scrollbar-none gap-2 py-1 relative [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
        <FilterChip
          active={!category}
          onClick={() => setCategory(null)}
          label="All"
        />
        {categories.map((c) => (
          <FilterChip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={c}
          />
        ))}
      </div>

      <motion.div
        variants={shouldReduceMotion ? undefined : containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {filtered.map((d) => (
          <motion.div key={d.id} variants={shouldReduceMotion ? undefined : itemVariants}>
            <Link
              href={`/navigate?to=${encodeURIComponent(d.id)}`}
              className="card card-hover group flex h-full flex-col gap-3 p-5 border bg-[rgb(var(--card))] hover:shadow-md hover:border-[rgb(var(--border-strong))] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg))]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{d.name}</h3>
                <Badge variant="primary" className="shrink-0">
                  {d.category}
                </Badge>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-[rgb(var(--border)/0.6)] pt-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-[rgb(var(--muted-fg))]">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{locationOf(d.floorId)}</span>
                </span>
                <Button
                  size="sm"
                  variant="gradient"
                  tabIndex={-1}
                  className="pointer-events-none shrink-0"
                >
                  Navigate
                </Button>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {filtered.length === 0 &&
        (items.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={Building2}
            title="No campus data yet"
            description="Nothing has been published to the live map. An administrator adds buildings, floors and rooms in the admin panel, then publishes them here."
            action={
              <Link href="/admin">
                <Button size="sm" variant="gradient">
                  Open admin panel
                </Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            className="mt-6"
            compact
            icon={SearchX}
            title={q.trim() ? `No matches for “${q.trim()}”` : "Nothing in this category"}
            description="Try a different keyword, or clear the filters to see everything on campus."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQ("");
                  setCategory(null);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ))}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      suppressHydrationWarning
      className={`rounded-full border px-3.5 py-1 text-xs font-medium transition-all ${
        active
          ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))]"
          : "hover:bg-[rgb(var(--muted))]"
      }`}
    >
      {label}
    </button>
  );
}

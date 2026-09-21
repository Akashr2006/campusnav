"use client";

import { useState, useEffect } from "react";
import { Search, MapPin, X } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import type { Destination } from "@/shared/data/campus";

interface Props {
  destinations: Destination[];
  onSelectDestination: (dest: Destination) => void;
  onClose?: () => void;
}

export function VisitorSearchSheet({ destinations, onSelectDestination, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [filtered, setFiltered] = useState<Destination[]>(destinations);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setFiltered(destinations);
      return;
    }

    const results = destinations.filter((d) => {
      const nameMatch = d.name.toLowerCase().includes(q);
      const catMatch = (d.category ?? "").toLowerCase().includes(q);
      const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
      return nameMatch || catMatch || aliasMatch;
    });

    setFiltered(results);
  }, [query, destinations]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-[rgb(var(--card))]/95 p-4 shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[rgb(var(--fg))]">
          <Search className="h-4 w-4 text-[rgb(var(--primary))]" />
          <span>Find Campus Destination</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rooms, labs, offices, or facilities..."
          className="h-10 pl-9 text-xs"
        />
        <Search className="absolute left-3 top-3 h-4 w-4 text-[rgb(var(--muted-fg))]" />
      </div>

      <div className="max-h-60 overflow-y-auto space-y-1.5 scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-[rgb(var(--muted-fg))]">
            {query.trim()
              ? `No destinations match “${query.trim()}”.`
              : "No destinations published yet. An administrator adds them in the admin panel."}
          </p>
        ) : (
          filtered.map((dest) => (
            <button
              key={dest.id}
              onClick={() => onSelectDestination(dest)}
              className="flex w-full items-center justify-between rounded-lg p-2.5 text-left text-xs transition-colors hover:bg-[rgb(var(--muted))]/80"
            >
              <div className="flex items-center gap-2.5">
                <div className="rounded-md bg-[rgb(var(--primary))]/10 p-1.5 text-[rgb(var(--primary))]">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-[rgb(var(--fg))]">{dest.name}</div>
                  <div className="text-[10px] text-[rgb(var(--muted-fg))]">
                    {dest.category} · {(dest.aliases ?? []).slice(0, 2).join(", ")}
                  </div>
                </div>
              </div>
              <Badge variant="primary" className="text-[10px]">
                Navigate
              </Badge>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

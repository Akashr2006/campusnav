"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Search, X } from "lucide-react";
import { TOUR_SCENES, TOUR_BASE_URL, tourSceneUrl, type TourScene } from "@/shared/data/campus-tour";
import { CubemapViewer } from "./cubemap-viewer";

/**
 * Full-screen 360 view, embedding the official BIT campus tour deep-linked to a
 * single panorama. Drag inside the frame to look around.
 */
export function PanoramaViewer({
  scene,
  onClose,
  onSelectScene,
}: {
  scene: TourScene | null;
  onClose: () => void;
  onSelectScene: (scene: TourScene) => void;
}) {
  const [query, setQuery] = useState("");
  const [showList, setShowList] = useState(false);
  // Prefer the locally mirrored cube faces; fall back to the hosted tour only
  // for scenes the mirror has not captured.
  const [useHostedTour, setUseHostedTour] = useState(false);

  useEffect(() => {
    setUseHostedTour(false);
  }, [scene?.index]);

  useEffect(() => {
    if (!scene) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [scene, onClose]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TOUR_SCENES;
    return TOUR_SCENES.filter((s) => s.label.toLowerCase().includes(needle));
  }, [query]);

  return (
    <AnimatePresence>
      {scene && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`360 degree view of ${scene.label}`}
          className="fixed inset-0 z-[120] flex flex-col bg-black"
        >
          <header className="flex items-center gap-3 border-b border-white/10 bg-black/80 px-4 py-2.5 text-white backdrop-blur">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/50">360° view</div>
              <h2 className="truncate text-base font-semibold">{scene.label}</h2>
            </div>

            <button
              onClick={() => setUseHostedTour((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/90 transition-colors hover:bg-white/10"
              title={useHostedTour ? "Switch to the locally mirrored imagery" : "Switch to the hosted tour"}
            >
              {useHostedTour ? "Hosted" : "Local"}
            </button>

            <button
              onClick={() => setShowList((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/90 transition-colors hover:bg-white/10"
              aria-expanded={showList}
            >
              <Search className="h-4 w-4" />
              Places
            </button>

            <a
              href={tourSceneUrl(scene.index)}
              target="_blank"
              rel="noreferrer noopener"
              title="Open the full tour in a new tab"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/90 transition-colors hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" />
            </a>

            <button
              onClick={onClose}
              aria-label="Close 360 view"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/90 transition-colors hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="relative flex-1">
            {useHostedTour ? (
              <iframe
                key={`hosted-${scene.index}`}
                src={tourSceneUrl(scene.index)}
                title={`360 degree panorama of ${scene.label}`}
                className="h-full w-full border-0"
                allow="accelerometer; gyroscope; magnetometer; xr-spatial-tracking; fullscreen"
              />
            ) : (
              <CubemapViewer
                key={`local-${scene.index}`}
                sceneIndex={scene.index}
                className="absolute inset-0"
                onUnavailable={() => setUseHostedTour(true)}
              />
            )}

            {showList && (
              <div className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col border-l border-white/10 bg-black/90 backdrop-blur">
                <div className="border-b border-white/10 p-3">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search 119 places…"
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                  />
                </div>
                <ul className="scrollbar-thin flex-1 overflow-y-auto p-2">
                  {results.map((s) => (
                    <li key={s.index}>
                      <button
                        onClick={() => {
                          onSelectScene(s);
                          setShowList(false);
                        }}
                        className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          s.index === scene.index
                            ? "bg-white/15 font-semibold text-white"
                            : "text-white/75 hover:bg-white/10"
                        }`}
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-white/50">
                      No place matches “{query.trim()}”.
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <footer className="border-t border-white/10 bg-black/80 px-4 py-1.5 text-[11px] text-white/45">
            360° imagery from the BIT Sathyamangalam campus tour ({TOUR_BASE_URL})
            {useHostedTour ? " · streaming from source" : " · served locally"}
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

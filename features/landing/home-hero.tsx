"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, MapPin, Navigation2, Play } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden mesh-bg">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 grid-pattern opacity-40" />

      {/* Ambient background blur backdrops */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-24 -z-10 h-72 w-72 rounded-full bg-[rgb(var(--primary)/0.25)] blur-3xl opacity-60"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-16 -z-10 h-80 w-80 rounded-full bg-[rgb(var(--accent)/0.18)] blur-3xl opacity-60"
      />

      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-24 text-center md:px-6 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))]/70 px-3.5 py-1.5 text-xs font-medium shadow-[var(--shadow-sm)] backdrop-blur"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(var(--primary))] opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(var(--primary))]" />
          </span>
          <Sparkles className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
          <span>Live Digital Twin · Real-time indoor + outdoor</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="h-display text-4xl font-semibold sm:text-5xl md:text-6xl lg:text-7xl"
        >
          Google Maps <br className="hidden sm:block" />
          <span className="gradient-text">for your campus.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="max-w-2xl text-base leading-relaxed text-[rgb(var(--muted-fg))] md:text-lg"
        >
          Search a room, walk to it. Outdoor GPS flows straight into
          multi-floor indoor routing — no manual switch. Powered by a graph-based
          Digital Twin with sub-300 ms re-routing.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18 }}
          className="mt-2 flex flex-wrap justify-center gap-3"
        >
          <Link href="/navigate">
            <Button size="lg" variant="gradient">
              Start Navigating
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/search">
            <Button size="lg" variant="outline">
              <Play className="h-4 w-4" />
              See it live
            </Button>
          </Link>
        </motion.div>

        {/* Trust row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-[rgb(var(--muted-fg))]"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))]" />
            Sub-300 ms routes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--primary))]" />
            Multi-floor aware
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--accent))]" />
            Accessibility first
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--warning))]" />
            No app install
          </span>
        </motion.div>

        {/* Hero visual mockup */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.35 }}
          className="relative mt-12 w-full max-w-4xl"
        >
          <div className="absolute -inset-2 rounded-3xl gradient-primary opacity-20 blur-2xl animate-glow" aria-hidden />
          <div className="gradient-border relative overflow-hidden rounded-2xl border border-[rgb(var(--border))] shadow-[var(--shadow-lg)]">
            <MapMockup />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function MapMockup() {
  return (
    <div className="relative aspect-[16/9] w-full bg-[rgb(var(--muted))]">
      {/* Grid */}
      <div className="absolute inset-0 grid-pattern opacity-70" />

      {/* Fake buildings */}
      <svg
        viewBox="0 0 800 450"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="route" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--primary))" />
            <stop offset="1" stopColor="rgb(var(--accent))" />
          </linearGradient>
          <filter id="soft">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* buildings */}
        <g fill="rgb(var(--card))" stroke="rgb(var(--border-strong))" strokeWidth="1.5">
          <rect x="70" y="70" width="180" height="120" rx="10" />
          <rect x="300" y="50" width="150" height="150" rx="10" />
          <rect x="510" y="90" width="200" height="110" rx="10" />
          <rect x="120" y="260" width="220" height="130" rx="10" />
          <rect x="420" y="240" width="290" height="150" rx="10" />
        </g>

        {/* pathways */}
        <g stroke="rgb(var(--border-strong))" strokeWidth="2" strokeDasharray="4 6" fill="none">
          <path d="M40 220 L 760 220" />
          <path d="M400 20 L 400 430" />
        </g>

        {/* route */}
        <path
          d="M110 400 Q 220 380 260 300 T 400 220 T 560 160 T 650 130"
          stroke="url(#route)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          filter="url(#soft)"
          opacity="0.5"
        />
        <path
          d="M110 400 Q 220 380 260 300 T 400 220 T 560 160 T 650 130"
          stroke="url(#route)"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* start */}
        <circle cx="110" cy="400" r="10" fill="rgb(var(--success))" />
        <circle cx="110" cy="400" r="18" fill="rgb(var(--success))" opacity="0.25" />

        {/* end */}
        <circle cx="650" cy="130" r="10" fill="rgb(var(--accent))" />
        <circle cx="650" cy="130" r="18" fill="rgb(var(--accent))" opacity="0.3" />
      </svg>

      {/* Floating chips */}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full glass-strong border px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-sm)]">
        <MapPin className="h-3.5 w-3.5 text-[rgb(var(--success))]" />
        Main Gate
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full glass-strong border px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-sm)]">
        <Navigation2 className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
        Room 305 · Floor 3
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-xl glass-strong border px-3 py-2 text-xs shadow-[var(--shadow-md)]">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-[rgb(var(--muted-fg))]">ETA</span>
          <span className="text-sm font-semibold">4 min · 320 m</span>
        </div>
        <div className="h-8 w-px bg-[rgb(var(--border))]" />
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-[rgb(var(--muted-fg))]">Route</span>
          <span className="text-sm font-semibold text-[rgb(var(--primary))]">Active</span>
        </div>
      </div>
    </div>
  );
}

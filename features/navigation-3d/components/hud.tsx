"use client";

import type { ReactNode } from "react";

/**
 * HUD kit for the 3D view.
 *
 * One panel language for every overlay: dark glass, a hairline border, and the
 * bracketed corners that game and flight HUDs use to say "this is an instrument,
 * not a dialog". Accents are deliberate — cyan is navigation, red is structure,
 * amber is a caveat — so a glance tells you which system a panel belongs to.
 */

export type Accent = "nav" | "structure" | "caveat" | "neutral";

const ACCENT: Record<Accent, { text: string; border: string; fill: string; solid: string; glow: string }> = {
  nav: {
    text: "text-cyan-300",
    border: "border-cyan-400/40",
    fill: "bg-cyan-400/10",
    solid: "bg-cyan-400 text-slate-950",
    glow: "shadow-[0_0_24px_-6px_rgba(34,211,238,0.55)]",
  },
  structure: {
    text: "text-red-300",
    border: "border-red-400/40",
    fill: "bg-red-400/10",
    solid: "bg-red-500 text-slate-950",
    glow: "shadow-[0_0_24px_-6px_rgba(248,113,113,0.55)]",
  },
  caveat: {
    text: "text-amber-300",
    border: "border-amber-400/40",
    fill: "bg-amber-400/10",
    solid: "bg-amber-400 text-slate-950",
    glow: "",
  },
  neutral: {
    text: "text-slate-300",
    border: "border-white/15",
    fill: "bg-white/5",
    solid: "bg-slate-200 text-slate-950",
    glow: "",
  },
};

export function accent(a: Accent) {
  return ACCENT[a];
}

/** Bracketed-corner glass panel. */
export function HudPanel({
  children,
  accent: a = "neutral",
  className = "",
  corners = true,
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
  /** The corner brackets; off for panels that sit flush in a corner. */
  corners?: boolean;
}) {
  const c = ACCENT[a];
  return (
    <div
      className={`hud-panel relative rounded-lg border border-white/10 bg-slate-950/80 text-slate-300 shadow-2xl backdrop-blur-md ${c.glow} ${className}`}
      data-accent={a}
    >
      {corners && (
        <>
          <span aria-hidden className={`hud-corner hud-corner-tl ${c.border}`} />
          <span aria-hidden className={`hud-corner hud-corner-tr ${c.border}`} />
          <span aria-hidden className={`hud-corner hud-corner-bl ${c.border}`} />
          <span aria-hidden className={`hud-corner hud-corner-br ${c.border}`} />
        </>
      )}
      {children}
    </div>
  );
}

/** Small-caps instrument caption with an accent tick. */
export function HudLabel({
  children,
  accent: a = "neutral",
  className = "",
}: {
  children: ReactNode;
  accent?: Accent;
  className?: string;
}) {
  const c = ACCENT[a];
  return (
    <div
      className={`flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${c.text} ${className}`}
    >
      <span className={`h-px w-4 ${a === "neutral" ? "bg-slate-500" : c.text.replace("text-", "bg-")}`} />
      {children}
    </div>
  );
}

/** A readout tile: big value, small unit, tiny label. */
export function HudStat({
  value,
  unit,
  label,
  accent: a = "neutral",
}: {
  value: ReactNode;
  unit?: string;
  label: string;
  accent?: Accent;
}) {
  const c = ACCENT[a];
  return (
    <div className={`rounded-md border ${c.border} ${c.fill} px-2.5 py-2`}>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-xl font-bold tabular-nums leading-none text-slate-50">{value}</span>
        {unit && <span className={`font-mono text-[10px] ${c.text}`}>{unit}</span>}
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

/** Segmented progress rail with a moving head. */
export function HudProgress({
  value,
  accent: a = "nav",
  segments = 24,
}: {
  /** 0..1 */
  value: number;
  accent?: Accent;
  segments?: number;
}) {
  const c = ACCENT[a];
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div className="flex gap-[3px]" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-[1px] transition-colors duration-150 ${
            i < lit ? c.text.replace("text-", "bg-") : "bg-white/10"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Level-of-detail as a tier. The number is what an engineer reads; the word is
 * what everyone else does, and "Inferred" is an honest caveat where "LOD 200"
 * is just a code.
 */
export function HudTier({ lod }: { lod: string | undefined }) {
  const tier =
    lod === "DETAILED"
      ? { code: "LOD 350", word: "Detailed", a: "nav" as Accent }
      : lod === "SURVEYED"
        ? { code: "LOD 300", word: "Surveyed", a: "nav" as Accent }
        : lod === "GENERIC"
          ? { code: "LOD 200", word: "Inferred", a: "caveat" as Accent }
          : { code: "LOD 100", word: "Massing", a: "neutral" as Accent };
  const c = ACCENT[tier.a];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border ${c.border} ${c.fill} px-1.5 py-0.5 font-mono text-[10px] font-semibold ${c.text}`}
      title={
        tier.a === "caveat"
          ? "Frame inferred from the footprint and a nominal bay grid. Not surveyed."
          : `${tier.code}: ${tier.word.toLowerCase()} structural model`
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tier.code}
      <span className="font-normal opacity-70">{tier.word}</span>
    </span>
  );
}

/** Pill button that reads as a HUD control. */
export function HudButton({
  children,
  active = false,
  accent: a = "neutral",
  onClick,
  title,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  active?: boolean;
  accent?: Accent;
  onClick?: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  const c = ACCENT[a];
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition disabled:opacity-40 ${
        active
          ? `${c.solid} border-transparent`
          : `border-white/10 bg-white/5 text-slate-300 hover:border-white/25 hover:bg-white/10 hover:text-white`
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** One-time styles for the corner brackets and the scanline texture. */
export function HudStyles() {
  return (
    <style>{`
      .hud-corner { position:absolute; width:10px; height:10px; border-style:solid; border-color:inherit; pointer-events:none; }
      .hud-corner-tl { top:-1px; left:-1px; border-width:2px 0 0 2px; border-top-left-radius:4px; }
      .hud-corner-tr { top:-1px; right:-1px; border-width:2px 2px 0 0; border-top-right-radius:4px; }
      .hud-corner-bl { bottom:-1px; left:-1px; border-width:0 0 2px 2px; border-bottom-left-radius:4px; }
      .hud-corner-br { bottom:-1px; right:-1px; border-width:0 2px 2px 0; border-bottom-right-radius:4px; }
      .hud-panel::after { content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
        background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px); opacity:.5; }
      @keyframes hud-in { from { opacity:0; transform:translateY(6px) scale(.985);} to { opacity:1; transform:none;} }
      .hud-in { animation: hud-in 260ms cubic-bezier(.2,.8,.2,1) both; }
    `}</style>
  );
}

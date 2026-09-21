"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";
type Ctx = { theme: Theme; setTheme: (t: Theme) => void; resolved: Resolved };

export const THEME_STORAGE_KEY = "campusnav-theme";

const ThemeCtx = createContext<Ctx | null>(null);
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

function systemTheme(): Resolved {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage can be unavailable (private mode, blocked cookies)
  }
  // The campus map palette is designed light; default there rather than
  // following the OS. Users can still pick dark from the toggle.
  return "light";
}

function apply(theme: Theme): Resolved {
  const resolved: Resolved = theme === "system" ? systemTheme() : theme;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolved, setResolved] = useState<Resolved>("light");

  // Adopt the stored preference on mount instead of overwriting it with the default.
  useIsoLayout(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setResolved(apply(stored));
  }, []);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(apply("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    const next: Theme = t === "dark" || t === "light" || t === "system" ? t : "system";
    setThemeState(next);
    setResolved(apply(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference simply will not survive a reload if storage is unavailable
    }
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

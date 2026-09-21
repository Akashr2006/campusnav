"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "warning" | "info";
type Toast = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};

const ToastCtx = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
} | null>(null);

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />,
  error: <XCircle className="h-5 w-5 text-red-500 shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />,
  info: <Info className="h-5 w-5 text-blue-500 shrink-0" />,
};

function formatToastText(val: unknown): string {
  if (typeof val === "string") return val;
  if (!val) return "";
  if (val instanceof Error) return val.message;
  if (typeof val === "object") {
    if ("message" in val && typeof (val as any).message === "string") return (val as any).message;
    if ("userMessage" in val && typeof (val as any).userMessage === "string") return (val as any).userMessage;
    if ("title" in val && typeof (val as any).title === "string") return (val as any).title;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const queueRef = useState<Omit<Toast, "id">[]>([]);
  const isProcessingRef = useState<{ current: boolean }>({ current: false });

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    const safeToast: Toast = {
      ...t,
      id,
      title: formatToastText(t.title) || "Notification",
      description: t.description ? formatToastText(t.description) : undefined,
    };
    setToasts((s) => {
      // Keep max 2 visible toasts at a time so notifications do not flood the screen
      const currentToasts = s.length >= 2 ? s.slice(1) : s;
      return [...currentToasts, safeToast];
    });
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 4000);
  }, []);

  useEffect(() => {
    const updateTarget = () => {
      const fsElement = document.fullscreenElement as HTMLElement | null;
      setPortalTarget(fsElement || document.body);
    };

    updateTarget();

    document.addEventListener("fullscreenchange", updateTarget);
    document.addEventListener("webkitfullscreenchange", updateTarget);
    document.addEventListener("mozfullscreenchange", updateTarget);
    document.addEventListener("MSFullscreenChange", updateTarget);

    return () => {
      document.removeEventListener("fullscreenchange", updateTarget);
      document.removeEventListener("webkitfullscreenchange", updateTarget);
      document.removeEventListener("mozfullscreenchange", updateTarget);
      document.removeEventListener("MSFullscreenChange", updateTarget);
    };
  }, []);

  const toastContainer = (
    <div className="fixed bottom-6 right-6 z-[999999] flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto flex items-start gap-3 p-4 rounded-xl border bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-2xl backdrop-blur-md border-[rgb(var(--border))]"
          >
            {icons[t.type]}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight">{t.title}</div>
              {t.description && (
                <div className="mt-1 text-xs text-[rgb(var(--muted-fg))] leading-normal">
                  {t.description}
                </div>
              )}
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    setToasts((s) => s.filter((x) => x.id !== t.id));
                  }}
                  className="mt-2 text-xs font-semibold text-[rgb(var(--primary))] hover:underline block"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))}
              className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))] transition-colors p-0.5 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {portalTarget ? createPortal(toastContainer, portalTarget) : null}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}

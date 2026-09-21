"use client";

import React, { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { campusStore } from "@/shared/lib/campus-store";
import { cn } from "@/shared/lib/utils";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
}

export function PublishModal({ open, onClose }: PublishModalProps) {
  const { toast } = useToast();
  const [publishing, setPublishing] = React.useState(false);

  const workingData = campusStore.getWorkingData();
  const isEmptyGraph =
    (workingData.buildings?.length ?? 0) === 0 &&
    (workingData.nodes?.length ?? 0) === 0 &&
    (workingData.floors?.length ?? 0) === 0;

  useEffect(() => {
    if (open) {
      document.body.classList.add("modal-open");
      document.documentElement.classList.add("modal-open");
      return () => {
        document.body.classList.remove("modal-open");
        document.documentElement.classList.remove("modal-open");
      };
    }
  }, [open]);

  const storageLabel =
    campusStore.getStorageMode() === "local-file"
      ? "the local .data folder"
      : "the PostgreSQL database";

  const handleConfirmPublish = async () => {
    setPublishing(true);
    try {
      const res = await campusStore.publishToServer();
      if (!res.success) {
        toast({
          type: "error",
          title: "Publish Failed",
          description: res.error || "Failed to publish campus data to server.",
        });
      } else {
        toast({
          type: "success",
          title: isEmptyGraph ? "Empty Campus Published!" : "Digital Twin Published!",
          description: isEmptyGraph
            ? `Published an empty campus to ${storageLabel}. Previously published data was removed.`
            : `Version ${res.version || ""} is now live, saved to ${storageLabel}.`.replace("  ", " "),
        });
        onClose();
      }
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Publish Error",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPublishing(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 w-screen h-screen min-w-full min-h-full z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-hidden select-none">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md rounded-xl border bg-[rgb(var(--card))] p-6 shadow-2xl space-y-5 overflow-hidden"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Rocket className={cn("h-5 w-5", isEmptyGraph ? "text-amber-500" : "text-[rgb(var(--primary))]")} />
              <h3 className="font-bold text-lg text-[rgb(var(--fg))]">
                {isEmptyGraph ? "Publish Empty Campus?" : "Confirm Publish"}
              </h3>
            </div>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={publishing}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 text-sm text-[rgb(var(--muted-fg))] leading-relaxed">
            {isEmptyGraph ? (
              <>
                <p className="font-semibold text-amber-500">
                  Publishing this empty state will remove the currently published campus data from the database.
                </p>
                <p className="text-xs text-[rgb(var(--muted-fg))]/80">
                  No buildings, floors, or nodes will be active on the public visitor view.
                </p>
              </>
            ) : (
              <>
                <p>
                  Are you sure you want to publish the updated Digital Twin graph live for all users?
                </p>
                <p className="text-xs italic text-[rgb(var(--muted-fg))]/80">
                  All saved draft changes — nodes, edges, buildings and navigation paths — become
                  active immediately and are stored in {storageLabel}.
                </p>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={publishing}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmPublish}
              disabled={publishing}
              className={cn(
                "text-white hover:brightness-110",
                isEmptyGraph
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-[rgb(var(--primary))]"
              )}
            >
              {publishing
                ? (isEmptyGraph ? "Publishing Empty State..." : "Publishing to DB...")
                : (isEmptyGraph ? "Publish Empty State" : "Confirm & Publish")}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}


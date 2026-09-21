"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/shared/providers/theme-provider";
import { Button } from "./button";

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  // Show the icon of the theme the button switches to.
  const Icon = next === "dark" ? Moon : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} theme`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

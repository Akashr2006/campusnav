"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackText?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in component:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border bg-[rgb(var(--card))] shadow-sm">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-500 mb-3">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-[rgb(var(--fg))] mb-1">
            {this.props.fallbackText ?? "Something went wrong"}
          </h3>
          <p className="text-xs text-[rgb(var(--muted-fg))] max-w-sm mb-4">
            {this.state.error?.message ?? "An unexpected runtime error occurred."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

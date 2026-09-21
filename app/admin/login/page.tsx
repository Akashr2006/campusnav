"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Compass, ShieldCheck, Mail, Key, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useToast } from "@/shared/components/ui/toast";

function AdminLoginForm() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/admin";
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("campusnav_admin_auth") === "true";
      if (stored) {
        window.location.replace(redirectUrl);
      }
    }
  }, [redirectUrl]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const inputEmail = email.trim().toLowerCase();
    const inputPass = password.trim();

    setTimeout(() => {
      const isValid =
        (inputEmail === "1" && inputPass === "1") ||
        (inputEmail === "admin" && inputPass === "admin") ||
        (inputEmail === "admin@campusnav.edu" && (inputPass === "admin" || inputPass === "admin123" || inputPass === "1")) ||
        (inputEmail === "admin@campus.edu" && (inputPass === "admin" || inputPass === "admin123" || inputPass === "1"));

      if (isValid) {
        sessionStorage.setItem("campusnav_admin_auth", "true");
        toast({
          type: "success",
          title: "Authenticated",
          description: "Welcome back to the Admin Panel.",
        });
        window.location.replace(redirectUrl);
      } else {
        setLoading(false);
        setError("Invalid credentials. Demo credentials: Username: 1, Password: 1");
        toast({
          type: "error",
          title: "Access Denied",
          description: "Incorrect email or password. Use 1 / 1 for demo.",
        });
      }
    }, 200);
  };


  return (
    <div className="mesh-bg relative flex min-h-screen flex-col items-center justify-center p-4 md:p-6 bg-[rgb(var(--bg))]">
      <div aria-hidden className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />

      <div className="mb-6 sm:absolute sm:top-6 sm:left-6 sm:mb-0">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary text-white shadow-[var(--shadow-sm)]">
            <Compass className="h-4.5 w-4.5" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight">CampusNav</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-fg))]">
              Admin Portal
            </span>
          </div>
        </Link>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="card gradient-border relative w-full max-w-md p-6 md:p-8 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--primary)/0.2)] bg-[rgb(var(--primary)/0.08)] px-3 py-1 text-xs font-semibold text-[rgb(var(--primary))]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Protected Admin Route
        </div>

        <h1 className="h-display text-2xl font-semibold md:text-3xl">Admin Sign In</h1>
        <p className="mt-1.5 text-sm text-[rgb(var(--muted-fg))]">
          Enter your credentials to access the campus management dashboard.
        </p>


        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form
          className="mt-5 space-y-4"
          onSubmit={handleLogin}
          autoComplete="off"
          noValidate
        >
          {/* Chrome/Edge autofill prevention dummy fields */}
          <input
            type="text"
            name="prevent_autofill_username"
            id="prevent_autofill_username"
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            readOnly
          />
          <input
            type="password"
            name="prevent_autofill_password"
            id="prevent_autofill_password"
            className="hidden"
            tabIndex={-1}
            autoComplete="new-password"
            readOnly
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-[rgb(var(--muted-fg))]">
              Admin Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-fg))]" />
              <Input
                type="email"
                name="admin_no_autofill_email"
                id="admin_no_autofill_email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@campus.edu"
                required
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-autocomplete="none"
                className="pl-10"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[rgb(var(--muted-fg))]">
              Password
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-fg))]" />
              <Input
                type="password"
                name="admin_no_autofill_pass"
                id="admin_no_autofill_pass"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="none"
                aria-autocomplete="none"
                className="pl-10"
              />
            </div>
          </div>

          <Button type="submit" loading={loading} variant="gradient" className="w-full mt-2">
            Sign In to Admin Panel
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-[rgb(var(--muted-fg))] hover:underline">
            ← Return to Main Site
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center gap-3 text-sm text-[rgb(var(--muted-fg))] bg-[rgb(var(--bg))]">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
          Loading...
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}

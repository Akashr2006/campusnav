"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Compass, Github, Mail } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useToast } from "@/shared/components/ui/toast";
import { useState } from "react";

export function AuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignIn = mode === "sign-in";
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  return (
    <div className="mesh-bg relative flex min-h-screen items-center justify-center p-6">
      <div aria-hidden className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="card gradient-border relative w-full max-w-md p-8 shadow-[var(--shadow-lg)]"
      >
        <Link href="/" className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary text-white shadow-[var(--shadow-sm)]">
            <Compass className="h-4.5 w-4.5" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight">CampusNav</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-fg))]">
              Digital Twin
            </span>
          </div>
        </Link>
        <h1 className="h-display text-2xl font-semibold">
          {isSignIn ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-[rgb(var(--muted-fg))]">
          {isSignIn
            ? "Sign in to continue managing the campus."
            : "Create an account to manage campus data."}
        </p>

        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setLoading(true);
            setTimeout(() => {
              setLoading(false);
              toast({
                type: "success",
                title: isSignIn ? "Signed in" : "Account created",
                description: "Demo flow — connect Better Auth to enable.",
              });
            }, 800);
          }}
        >
          {!isSignIn && (
            <Field label="Full name">
              <Input placeholder="Ada Lovelace" required />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" placeholder="you@campus.edu" required />
          </Field>
          <Field label="Password">
            <Input type="password" placeholder="••••••••" required />
          </Field>
          <Button type="submit" loading={loading} variant="gradient" className="w-full">
            <Mail className="h-4 w-4" />
            {isSignIn ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-[rgb(var(--muted-fg))]">
          <div className="h-px flex-1 bg-[rgb(var(--border))]" />
          or
          <div className="h-px flex-1 bg-[rgb(var(--border))]" />
        </div>

        <Button variant="outline" className="w-full">
          <Github className="h-4 w-4" /> Continue with GitHub
        </Button>

        <p className="mt-6 text-center text-sm text-[rgb(var(--muted-fg))]">
          {isSignIn ? "New here?" : "Already have an account?"}{" "}
          <Link
            href={isSignIn ? "/sign-up" : "/sign-in"}
            className="font-medium text-[rgb(var(--primary))] hover:underline"
          >
            {isSignIn ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[rgb(var(--muted-fg))]">
        {label}
      </span>
      {children}
    </label>
  );
}

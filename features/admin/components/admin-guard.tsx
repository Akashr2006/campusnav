"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/shared/components/ui/toast";

type AdminAuthContextType = {
  isAuthenticated: boolean;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextType>({
  isAuthenticated: false,
  logout: () => {},
});

export const useAdminAuth = () => useContext(AdminAuthContext);

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const isLoginPage = pathname === "/admin/login";

  const [isMounted, setIsMounted] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(isLoginPage);

  useEffect(() => {
    setIsMounted(true);

    if (isLoginPage) {
      setIsAuthenticated(true);
      return;
    }

    const isAuthed = sessionStorage.getItem("campusnav_admin_auth") === "true";

    if (isAuthed) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
      const redirectTarget = `/admin/login?redirect=${encodeURIComponent(pathname || "/admin")}`;
      router.replace(redirectTarget);
    }
  }, [pathname, router, isLoginPage]);

  const logout = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("campusnav_admin_auth");
    }
    setIsAuthenticated(false);
    toast({
      type: "info",
      title: "Signed Out",
      description: "You have been logged out of the Admin Panel.",
    });
    if (typeof window !== "undefined") {
      window.location.replace("/admin/login");
    } else {
      router.replace("/admin/login");
    }
  };

  if (isLoginPage || (isMounted && isAuthenticated)) {
    return (
      <AdminAuthContext.Provider value={{ isAuthenticated: true, logout }}>
        {children}
      </AdminAuthContext.Provider>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center gap-3 text-sm text-[rgb(var(--muted-fg))] bg-[rgb(var(--bg))]">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
      Redirecting to login…
    </div>
  );
}

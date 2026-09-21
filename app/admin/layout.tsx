"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/shared/components/layout/sidebar";
import { AdminTopbar } from "@/shared/components/layout/admin-topbar";
import { AdminGuard } from "@/features/admin/components/admin-guard";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/admin/login";
  const isFullBleedPage = pathname.startsWith("/admin/editor");

  return (
    <AdminGuard>
      {isLoginPage ? (
        children
      ) : (
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AdminTopbar />
            {isFullBleedPage ? (
              <main className="flex-1 overflow-hidden flex flex-col p-0 m-0">
                {children}
              </main>
            ) : (
              <main className="scrollbar-thin flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-7xl w-full space-y-6">{children}</div>
              </main>
            )}
          </div>
        </div>
      )}
    </AdminGuard>
  );
}

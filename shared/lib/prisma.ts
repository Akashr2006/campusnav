import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Null whenever no database is configured. The app is designed to run off the
 * local file store (`.data/*.json`) in that case, and every call site already
 * guards with `if (prisma)`. Instantiating a client without DATABASE_URL made
 * those guards pass, so each request fired a batch of queries that could only
 * fail — noisy logs and wasted latency before the local-store fallback ran.
 */
const databaseConfigured = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

let prismaInstance: PrismaClient | null = null;
if (databaseConfigured) {
  try {
    prismaInstance =
      globalForPrisma.prisma ??
      new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      });

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = prismaInstance;
    }
  } catch (err) {
    console.warn("[Prisma] Failed to instantiate PrismaClient:", err);
    prismaInstance = null;
  }
}

export const prisma = prismaInstance;

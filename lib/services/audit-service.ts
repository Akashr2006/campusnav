import { prisma } from "../db";

export interface AuditEventInput {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

const memoryAuditLogs: Array<AuditEventInput & { id: string; createdAt: Date }> = [];

export async function logAuditEvent(input: AuditEventInput) {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    ...input,
    createdAt: new Date(),
  };

  memoryAuditLogs.unshift(entry);

  if (prisma) {
    try {
      await prisma.auditLog.create({
        data: {
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          before: input.before ? JSON.stringify(input.before) : undefined,
          after: input.after ? JSON.stringify(input.after) : undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch {
      // Memory fallback if DB disconnected
    }
  }

  return entry;
}

export async function getAuditLogs(limit = 50) {
  if (prisma) {
    try {
      const logs = (await prisma.auditLog.findMany({
        take: limit,
        orderBy: { createdAt: "desc" },
      })) as unknown[];
      if (logs && logs.length > 0) return logs;
    } catch {
      // Memory fallback
    }
  }

  return memoryAuditLogs.slice(0, limit);
}

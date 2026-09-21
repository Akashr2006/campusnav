import { logAuditEvent } from "./audit-service";
import type { DraftSnapshot } from "./publish-service";

export interface MapVersionRecord {
  id: string;
  version: number;
  snapshot: DraftSnapshot;
  notes?: string;
  publishedAt: Date;
  publishedBy: string;
}

const memoryVersions: MapVersionRecord[] = [
  {
    id: "ver-1",
    version: 1,
    snapshot: {},
    notes: "Initial Published Campus Graph",
    publishedAt: new Date(),
    publishedBy: "Admin",
  },
];

export async function getMapVersions(): Promise<MapVersionRecord[]> {
  return memoryVersions;
}

export async function restoreMapVersion(versionId: string, userId = "admin-id-1") {
  const match = memoryVersions.find((v) => v.id === versionId || `ver-${v.version}` === versionId);
  if (!match) {
    throw new Error(`Version "${versionId}" not found.`);
  }

  await logAuditEvent({
    userId,
    action: "VERSION_RESTORED",
    resource: "map-version",
    resourceId: versionId,
    after: { version: match.version },
  });

  return match;
}

export async function compareMapVersions(v1Id: string, v2Id: string) {
  const v1 = memoryVersions.find((v) => v.id === v1Id);
  const v2 = memoryVersions.find((v) => v.id === v2Id);

  return {
    v1: v1 ? { version: v1.version, publishedAt: v1.publishedAt } : null,
    v2: v2 ? { version: v2.version, publishedAt: v2.publishedAt } : null,
    diff: {
      buildingsDelta: 0,
      nodesDelta: 0,
      edgesDelta: 0,
    },
  };
}

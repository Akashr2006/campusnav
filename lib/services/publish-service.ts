import { prisma } from "../db";
import { type Prisma, type NodeType, type EdgeType } from "@prisma/client";
import { validateCampusGraph, type GraphValidationReport } from "../validation/graph-validator";
import { getFloorCode, type Building, type Floor, type Node, type Edge, type Destination, type Obstacle, type Door } from "../../shared/data/campus";

export interface PublishResult {
  success: boolean;
  version?: number;
  publishedAt?: Date;
  validationReport: GraphValidationReport;
  error?: string;
}

export type DraftSnapshot = {
  buildings?: Building[];
  floors?: Floor[];
  nodes?: Node[];
  edges?: Edge[];
  destinations?: Destination[];
  obstacles?: Obstacle[];
  [key: string]: unknown;
};

let activePublishedSnapshot: { version: number; snapshot: DraftSnapshot; publishedAt: Date; publishedBy: string; notes: string } | null = null;

/**
 * @param keepInlinePhotos - in local-file mode the bytes only exist inside the
 * snapshot, so inline `data:` URLs must survive instead of being pointed at the
 * database-backed photo endpoint.
 */
export function sanitizeSnapshotForPayload(
  snapshot: DraftSnapshot,
  keepInlinePhotos = false
): DraftSnapshot {
  if (!snapshot) return {};
  const safeNodes = (snapshot.nodes || []).map((n) => {
    const isBase64 = Boolean(n.photoUrl && n.photoUrl.startsWith("data:"));
    const safeNode = { ...n };
    delete (safeNode as Node & { photoData?: unknown }).photoData;
    if (isBase64 && !keepInlinePhotos) {
      safeNode.photoUrl = `/api/nodes/${n.id}/photo`;
    }
    return safeNode;
  });

  const safeEdges = (snapshot.edges || []).map((e) => {
    const pathType = e.pathType || (e.type === "ROAD" ? "EV" : "WALK");
    const edgeType = (pathType === "EV" && (!e.type || e.type === "WALK")) ? "ROAD" : (e.type || "WALK");
    return {
      ...e,
      type: edgeType,
      pathType,
    };
  });

  return {
    ...snapshot,
    nodes: safeNodes,
    edges: safeEdges,
  };
}

async function runInPoolChunks<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

export async function publishDraftGraph(
  draftSnapshot: DraftSnapshot = {},
  userId = "admin-id-1",
  notes?: string
): Promise<PublishResult> {
  const safeSnapshot = draftSnapshot || {};
  const { buildings, floors, nodes, edges, destinations, obstacles } = safeSnapshot;

  // Safety Guard: Require valid snapshot object
  if (!draftSnapshot || typeof draftSnapshot !== "object") {
    return {
      success: false,
      validationReport: {
        healthScore: 0,
        status: "CRITICAL",
        canPublish: false,
        criticalCount: 1,
        warningCount: 0,
        infoCount: 0,
        checks: [],
        issues: [{
          id: "invalid-snapshot-state",
          severity: "CRITICAL",
          code: "INVALID_GRAPH",
          title: "Invalid Campus Graph",
          description: "Publishing blocked: Invalid or uninitialized graph state.",
        }],
      },
      error: "Publishing blocked: Invalid or uninitialized graph state.",
    };
  }

  const validationReport = validateCampusGraph(
    buildings || [],
    floors || [],
    nodes || [],
    edges || [],
    destinations || [],
    obstacles || []
  );

  // Allow publishing even if there are critical validation errors (logging warnings for diagnostics)
  if (validationReport.issues.some((i) => i.severity === "CRITICAL")) {
    console.warn(`[PublishService] Notice: Campus graph published with ${validationReport.criticalCount} critical validation warnings.`);
  }

  let versionNum = 1;
  const publishedAt = new Date();

  if (prisma) {
    const db = prisma;
    try {
      const defaultCampusId = "c1";

      // 1. Determine accurate next version directly from database record
      const dbPublished = await db.publishedGraph.findUnique({
        where: { id: "active-published" },
        select: { version: true },
      }).catch(() => null);

      versionNum = (dbPublished?.version ?? 0) + 1;

      // Pre-fetch all node metadata from DB so published snapshot ALWAYS contains verified cloud photo URLs
      const dbNodes = await db.node.findMany({ select: { id: true, metadata: true } }).catch(() => []);
      const dbNodeMetaMap = new Map<string, Record<string, unknown>>();
      for (const dbn of dbNodes) {
        if (dbn.metadata && typeof dbn.metadata === "object") {
          dbNodeMetaMap.set(dbn.id, dbn.metadata as Record<string, unknown>);
        }
      }

      const mergedNodes = (draftSnapshot.nodes || []).map((n) => {
        const dbMeta = dbNodeMetaMap.get(n.id) || {};
        const photoUrl = n.photoUrl || (dbMeta.photoUrl as string | undefined);
        const storagePath = (n as Node & { storagePath?: string }).storagePath || (dbMeta.storagePath as string | undefined);
        const photoUploadedAt = n.photoUploadedAt || (dbMeta.photoUploadedAt as string | undefined);
        const safeNode = {
          ...n,
          ...(photoUrl ? { photoUrl } : {}),
          ...(storagePath ? { storagePath } : {}),
          ...(photoUploadedAt ? { photoUploadedAt } : {}),
        };
        delete (safeNode as Node & { photoData?: unknown }).photoData;
        return safeNode;
      });

      const sanitizedSnapshot = sanitizeSnapshotForPayload({
        ...draftSnapshot,
        nodes: mergedNodes,
      });

      // 2. ATOMIC DATABASE TRANSACTION for Core Publish Records
      // Ensures publishedGraph, draftGraph, and mapVersion are atomically committed
      await db.$transaction([
        db.campus.upsert({
          where: { id: defaultCampusId },
          update: {},
          create: {
            id: defaultCampusId,
            name: "Main Campus",
            slug: "main",
            latitude: 11.4965,
            longitude: 77.2774,
            status: "PUBLISHED",
          },
        }),
        db.publishedGraph.upsert({
          where: { id: "active-published" },
          update: {
            version: versionNum,
            snapshot: sanitizedSnapshot as unknown as Prisma.InputJsonValue,
            publishedAt,
            publishedBy: userId,
          },
          create: {
            id: "active-published",
            version: versionNum,
            snapshot: sanitizedSnapshot as unknown as Prisma.InputJsonValue,
            publishedAt,
            publishedBy: userId,
          },
        }),
        db.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: draftSnapshot as unknown as Prisma.InputJsonValue },
          create: { id: "active-draft", snapshot: draftSnapshot as unknown as Prisma.InputJsonValue },
        }),
        db.mapVersion.create({
          data: {
            version: versionNum,
            status: "PUBLISHED",
            snapshot: sanitizedSnapshot as unknown as Prisma.InputJsonValue,
            notes: notes || "Published campus graph update",
            publishedBy: userId,
          },
        }),
      ]);

      // 3. Pre-fetch existing relational state for safe foreign-key matching and edge ID deduplication
      const existingEdges = await db.edge.findMany({ select: { id: true, fromNodeId: true, toNodeId: true, type: true } }).catch(() => []);

      const existingEdgeMap = new Map<string, string>();
      for (const e of existingEdges) {
        existingEdgeMap.set(`${e.fromNodeId}_${e.toNodeId}_${e.type}`, e.id);
      }

      // 3.1 Gather target IDs and prune obsolete relational records no longer present in published snapshot
      const targetBuildingIds = new Set((buildings || []).map((b) => b.id));
      const targetFloorIds = new Set((floors || []).map((f) => f.id));
      const targetNodeIds = new Set((nodes || []).map((n) => n.id));
      const targetEdgeIds = new Set((edges || []).map((e) => e.id));
      const targetDestIds = new Set((destinations || []).map((d) => d.id));
      const targetObstacleIds = new Set<string>((obstacles || []).map((obs) => obs.id));
      const targetDoorIds = new Set<string>(((draftSnapshot as { doors?: Array<{ id: string | number }> }).doors || []).map((d) => String(d.id)));

      await db.door.deleteMany({ where: { id: { notIn: Array.from(targetDoorIds) } } }).catch(() => {});
      await db.destination.deleteMany({ where: { id: { notIn: Array.from(targetDestIds) } } }).catch(() => {});
      await db.obstacle.deleteMany({ where: { id: { notIn: Array.from(targetObstacleIds) } } }).catch(() => {});
      await db.edge.deleteMany({ where: { id: { notIn: Array.from(targetEdgeIds) } } }).catch(() => {});
      await db.nodePhoto.deleteMany({ where: { nodeId: { notIn: Array.from(targetNodeIds) } } }).catch(() => {});
      await db.node.deleteMany({ where: { id: { notIn: Array.from(targetNodeIds) } } }).catch(() => {});
      await db.floor.deleteMany({ where: { id: { notIn: Array.from(targetFloorIds) } } }).catch(() => {});
      await db.building.deleteMany({ where: { id: { notIn: Array.from(targetBuildingIds) } } }).catch(() => {});

      // 4. Safe Topological Relational Upserts (Parent to Child: Campus -> Buildings -> Floors -> Nodes -> Edges/Dests/Obstacles)
      // 4.1 Buildings
      if (buildings && Array.isArray(buildings) && buildings.length > 0) {
        await runInPoolChunks(buildings, async (b) => {
          const safeCode = b.shortCode ? `${b.shortCode}_${b.id.slice(-6)}` : b.id;
          const bldData = {
            campusId: b.campusId || defaultCampusId,
            name: b.name,
            shortCode: safeCode,
            color: b.color || "#4f46e5",
            description: b.description || null,
            x: b.x ?? null,
            y: b.y ?? null,
            width: b.width ?? null,
            height: b.height ?? null,
            floorsCount: b.floorsCount ?? 0,
            basementsCount: b.basementsCount ?? 0,
            status: "PUBLISHED" as const,
          };
          return db.building.upsert({
            where: { id: b.id },
            update: bldData,
            create: { id: b.id, ...bldData },
          }).catch((e) => console.warn(`Building ${b.id} upsert notice:`, e?.message));
        });
      }

      // 4.2 Floors
      if (floors && Array.isArray(floors) && floors.length > 0) {
        const validBuildingIds = new Set((buildings || []).map((b) => b.id));
        const targetFloors = floors.filter((f) => validBuildingIds.has(f.buildingId));
        await runInPoolChunks(targetFloors, async (f) => {
          const floorData = {
            buildingId: f.buildingId,
            name: f.name,
            ordinal: f.ordinal ?? 0,
          };
          return db.floor.upsert({
            where: { id: f.id },
            update: floorData,
            create: { id: f.id, ...floorData },
          }).catch((e) => console.warn(`Floor ${f.id} upsert notice:`, e?.message));
        });
      }

      // 4.3 Nodes
      if (nodes && Array.isArray(nodes) && nodes.length > 0) {
        const validFloorIds = new Set((floors || []).map((f) => f.id));
        await runInPoolChunks(nodes, async (n) => {
          const dbFloorId = n.floorId && validFloorIds.has(n.floorId) ? n.floorId : null;
          
          // 1. Fetch existing node metadata to preserve existing database photo metadata
          const existingDbNode = await db.node.findUnique({
            where: { id: n.id },
            select: { metadata: true },
          }).catch(() => null);
          const existingMeta = (existingDbNode?.metadata && typeof existingDbNode.metadata === "object")
            ? (existingDbNode.metadata as Record<string, unknown>)
            : {};

          const isBase64 = Boolean(n.photoUrl && n.photoUrl.startsWith("data:"));
          const cleanPhotoUrl = isBase64 ? `/api/nodes/${n.id}/photo` : (n.photoUrl || (existingMeta.photoUrl as string | undefined));

          const nodeMeta: Record<string, unknown> = {
            ...existingMeta,
            floorId: n.floorId || "f-out",
            ...(cleanPhotoUrl ? {
              photoUrl: cleanPhotoUrl,
              storagePath: (n as Node & { storagePath?: string }).storagePath || (existingMeta.storagePath as string | undefined),
              photoUploadedAt: n.photoUploadedAt || (existingMeta.photoUploadedAt as string | undefined) || new Date().toISOString(),
            } : {}),
            ...(n.physicalVerified !== undefined ? { physicalVerified: n.physicalVerified } : {}),
            ...(n.visibleToUser !== undefined ? { visibleToUser: n.visibleToUser } : {}),
          };
          delete nodeMeta.photoData;

          const nodeData = {
            campusId: n.campusId || defaultCampusId,
            floorId: dbFloorId,
            type: n.type as unknown as NodeType,
            name: n.name || null,
            latitude: n.lat ?? null,
            longitude: n.lng ?? null,
            x: n.x ?? null,
            y: n.y ?? null,
            accessible: n.accessible ?? true,
            searchable: n.searchable ?? true,
            navigable: (n as Node & { navigable?: boolean }).navigable ?? true,
            metadata: Object.keys(nodeMeta).length > 0 ? (nodeMeta as unknown as Prisma.InputJsonValue) : undefined,
          };
          return db.node.upsert({
            where: { id: n.id },
            update: nodeData,
            create: { id: n.id, ...nodeData },
          }).catch((e) => console.warn(`Node ${n.id} upsert notice:`, e?.message));
        });
      }

      // 4.4 Edges
      if (edges && Array.isArray(edges) && edges.length > 0) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        const targetEdges = edges.filter((e) => {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          return fromId && toId && validNodeIds.has(fromId) && validNodeIds.has(toId);
        });

        await runInPoolChunks(targetEdges, async (e) => {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          const edgeType = (e.type as unknown as EdgeType) || "WALK";
          const pathType = e.pathType;
          const distance = typeof e.distance === "number" && !isNaN(e.distance) ? e.distance : 1;
          const bidirectional = e.bidirectional ?? true;

          const edgeData = {
            fromNodeId: fromId,
            toNodeId: toId,
            type: edgeType,
            ...(pathType ? { pathType } : {}),
            distance,
            bidirectional,
            status: "PUBLISHED" as const,
          };

          return db.edge.upsert({
            where: { id: e.id },
            update: edgeData,
            create: { id: e.id, ...edgeData },
          }).catch((err) => console.warn(`Edge ${e.id} upsert notice:`, err?.message));
        });
      }

      // 4.5 Obstacles & Destinations
      const trailingTasks: Promise<unknown>[] = [];

      if (obstacles && Array.isArray(obstacles) && obstacles.length > 0) {
        trailingTasks.push(
          runInPoolChunks(obstacles, async (obs) => {
            const floorId = obs.floorId && obs.floorId !== "f-out" ? obs.floorId : null;
            const obsData = {
              campusId: obs.campusId || defaultCampusId,
              floorId,
              x: obs.x ?? 0,
              y: obs.y ?? 0,
              radius: obs.radius ?? 15,
              edgeIds: obs.edgeIds || [],
              reason: obs.reason || null,
              expiresAt: obs.expiresAt ? new Date(obs.expiresAt) : null,
            };
            return db.obstacle.upsert({
              where: { id: obs.id },
              update: obsData,
              create: { id: obs.id, ...obsData },
            }).catch((err) => console.warn(`Obstacle ${obs.id} upsert notice:`, err?.message));
          })
        );
      }

      if (destinations && Array.isArray(destinations) && destinations.length > 0) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        const targetDests = destinations.filter((d) => d.nodeId && validNodeIds.has(d.nodeId));
        trailingTasks.push(
          runInPoolChunks(targetDests, async (d) => {
            const destData = {
              campusId: defaultCampusId,
              nodeId: d.nodeId!,
              name: d.name,
              category: d.category || "Custom",
              description: d.description || null,
              floorId: d.floorId || null,
              x: typeof d.x === "number" && !isNaN(d.x) ? d.x : null,
              y: typeof d.y === "number" && !isNaN(d.y) ? d.y : null,
              width: typeof d.width === "number" && !isNaN(d.width) ? d.width : null,
              height: typeof d.height === "number" && !isNaN(d.height) ? d.height : null,
            };
            return db.destination.upsert({
              where: { id: d.id },
              update: destData,
              create: { id: d.id, ...destData },
            }).catch((err) => console.warn(`Destination ${d.id} upsert notice:`, err?.message));
          })
        );
      }

      if (trailingTasks.length > 0) {
        await Promise.all(trailingTasks);
      }

      // 5. Preserving existing database nodes and relations safely
      // (Never prune or delete existing relational entities during publish)
    } catch (e) {
      console.error("Critical error during publish database transaction:", e);
      return {
        success: false,
        validationReport,
        error: `Database persistence failure: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Update server in-memory cache ONLY after database write succeeds
  const finalSanitized = sanitizeSnapshotForPayload(draftSnapshot);
  activePublishedSnapshot = {
    version: versionNum,
    snapshot: finalSanitized,
    publishedAt,
    publishedBy: userId,
    notes: notes || "Published campus graph update",
  };

  // 5. Invalidate in-memory cache so subsequent requests get fresh data
  activePublishedSnapshot = null;

  // 6. Record Audit Log for Publish action
  if (prisma) {
    let validUserId: string | null = null;
    if (userId) {
      const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null);
      if (userExists) validUserId = userId;
    }
    await prisma.auditLog.create({
      data: {
        userId: validUserId,
        action: "GRAPH_PUBLISHED",
        resource: "campus-graph",
        resourceId: `v${versionNum}`,
        after: { version: versionNum, notes },
      },
    }).catch(() => {});
  }

  return {
    success: true,
    version: versionNum,
    publishedAt,
    validationReport,
  };
}

export async function getRelationalGraphFromDatabase(): Promise<DraftSnapshot | null> {
  if (!prisma) return null;
  try {
    const rawBuildings = await prisma.building.findMany().catch(() => []);
    const rawFloors = await prisma.floor.findMany().catch(() => []);
    const rawNodes = await prisma.node.findMany().catch(() => []);
    const rawEdges = await prisma.edge.findMany().catch(() => []);
    const rawDestinations = await prisma.destination.findMany().catch(() => []);
    const rawObstacles = await prisma.obstacle.findMany().catch(() => []);
    const rawDoors = await prisma.door.findMany().catch(() => []);
    const rawPhotos = await prisma.nodePhoto.findMany({ select: { nodeId: true } }).catch(() => []);

    if (rawNodes.length === 0 && rawBuildings.length === 0) {
      return null;
    }

    const photoNodeIds = new Set(rawPhotos.map((p) => p.nodeId));

    const buildings: Building[] = rawBuildings.map((b) => ({
      id: b.id,
      campusId: b.campusId,
      name: b.name,
      shortCode: b.shortCode ?? undefined,
      description: b.description ?? undefined,
      color: b.color ?? undefined,
      x: b.x ?? undefined,
      y: b.y ?? undefined,
      width: b.width ?? undefined,
      height: b.height ?? undefined,
      floorsCount: b.floorsCount ?? 0,
      basementsCount: b.basementsCount ?? 0,
    }));

    const floors: Floor[] = rawFloors.map((f) => ({
      id: f.id,
      buildingId: f.buildingId,
      name: f.name,
      ordinal: f.ordinal,
      code: getFloorCode(f.ordinal, f.name),
    }));

    const nodes: Node[] = rawNodes.map((n) => {
      const meta = (n.metadata && typeof n.metadata === "object") ? (n.metadata as Record<string, unknown>) : {};
      const hasDbPhoto = photoNodeIds.has(n.id);
      return {
        id: n.id,
        type: n.type as Node["type"],
        name: n.name ?? undefined,
        floorId: (meta.floorId as string | undefined) || n.floorId || "f-out",
        x: n.x ?? 0,
        y: n.y ?? 0,
        lat: n.latitude !== null && n.latitude !== undefined ? n.latitude : undefined,
        lng: n.longitude !== null && n.longitude !== undefined ? n.longitude : undefined,
        searchable: n.searchable ?? true,
        visibleToUser: meta.visibleToUser !== undefined ? Boolean(meta.visibleToUser) : true,
        photoUrl: (meta.photoUrl as string | undefined) || (hasDbPhoto ? `/api/nodes/${n.id}/photo` : undefined),
        storagePath: (meta.storagePath as string | undefined) || undefined,
        photoUploadedAt: (meta.photoUploadedAt as string | undefined) || undefined,
        physicalVerified: meta.physicalVerified !== undefined ? Boolean(meta.physicalVerified) : undefined,
      };
    });

    const edges: Edge[] = rawEdges.map((e) => ({
      id: e.id,
      from: e.fromNodeId,
      to: e.toNodeId,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      type: e.type as Edge["type"],
      pathType: (e.pathType as Edge["pathType"]) || (e.type === "ROAD" ? "EV" : "WALK"),
      distance: e.distance,
      bidirectional: e.bidirectional ?? true,
    }));

    const destinations: Destination[] = rawDestinations.map((d) => ({
      id: d.id,
      nodeId: d.nodeId,
      name: d.name,
      category: d.category ?? "Custom",
      description: d.description ?? undefined,
      floorId: d.floorId ?? undefined,
      x: d.x ?? undefined,
      y: d.y ?? undefined,
      width: d.width ?? undefined,
      height: d.height ?? undefined,
      aliases: [],
    }));

    const obstacles: Obstacle[] = rawObstacles.map((obs) => ({
      id: obs.id,
      campusId: obs.campusId,
      floorId: obs.floorId ?? "f-out",
      x: obs.x,
      y: obs.y,
      radius: obs.radius,
      edgeIds: obs.edgeIds || [],
      reason: obs.reason ?? undefined,
      expiresAt: obs.expiresAt ? obs.expiresAt.toISOString() : undefined,
    }));

    const doors: Door[] = rawDoors.map((d) => ({
      id: d.id,
      floorId: d.floorId,
      type: d.type as Door["type"],
      name: d.name ?? undefined,
      x: d.x,
      y: d.y,
      connectedNodeId: d.connectedNodeId ?? undefined,
    }));

    return {
      buildings,
      floors,
      nodes,
      edges,
      destinations,
      obstacles,
      doors,
    };
  } catch (e) {
    console.warn("Error building graph snapshot from relational database:", e);
    return null;
  }
}

export function invalidatePublishedCache() {
  activePublishedSnapshot = null;
}

export async function getActivePublishedGraph(forceFresh = false) {
  if (!forceFresh && activePublishedSnapshot) {
    return activePublishedSnapshot;
  }

  if (prisma) {
    try {
      // 1. FIRST check published snapshot record in Prisma (active-published)
      const dbRecord = await prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
      }).catch(() => null);

      if (dbRecord && dbRecord.snapshot && typeof dbRecord.snapshot === "object") {
        const sanitized = sanitizeSnapshotForPayload(dbRecord.snapshot as DraftSnapshot);
        activePublishedSnapshot = {
          version: dbRecord.version || 1,
          snapshot: sanitized,
          publishedAt: dbRecord.publishedAt || new Date(),
          publishedBy: dbRecord.publishedBy || "admin",
          notes: "Database published graph",
        };
        return activePublishedSnapshot;
      }

      // 2. SECOND check relational tables if active-published is not yet initialized
      const relational = await getRelationalGraphFromDatabase().catch(() => null);
      if (relational) {
        const hasRelationalEntities =
          (Array.isArray(relational.buildings) && relational.buildings.length > 0) ||
          (Array.isArray(relational.nodes) && relational.nodes.length > 0);

        if (hasRelationalEntities) {
          const sanitizedRelational = sanitizeSnapshotForPayload(relational);
          activePublishedSnapshot = {
            version: 1,
            snapshot: sanitizedRelational,
            publishedAt: new Date(),
            publishedBy: "system-auto",
            notes: "Auto-assembled from relational database",
          };
          return activePublishedSnapshot;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch active published graph from Prisma database:", e);
    }
  }

  return activePublishedSnapshot;
}

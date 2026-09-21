import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { type Prisma } from "@prisma/client";
import {
  uploadNodePhotoToSupabase,
  deleteNodePhotoFromSupabase,
} from "@/lib/storage/supabase-storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 1. Primary: Stream binary image from persistent PostgreSQL (Supabase)
    if (prisma && prisma.nodePhoto) {
      const dbPhoto = await prisma.nodePhoto.findUnique({ where: { nodeId: id } }).catch(() => null);
      if (dbPhoto?.data) {
        const buffer = Buffer.from(dbPhoto.data);
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": dbPhoto.mimeType || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": String(buffer.length),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // 2. Secondary: Check if Node.metadata has an external Supabase Storage photoUrl
    if (prisma) {
      const node = await prisma.node
        .findUnique({
          where: { id },
          select: { metadata: true },
        })
        .catch(() => null);

      if (node?.metadata && typeof node.metadata === "object") {
        const meta = node.metadata as Record<string, unknown>;
        if (typeof meta.photoUrl === "string" && meta.photoUrl.startsWith("http") && !meta.photoUrl.includes(`/api/nodes/${id}/photo`)) {
          return NextResponse.redirect(meta.photoUrl, {
            headers: {
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }
    }

    return new NextResponse(
      JSON.stringify({ error: "Photo not found for node", nodeId: id }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    console.error(`[PHOTO-STORAGE] Error serving photo for node ${id}:`, err instanceof Error ? err.message : String(err));
    return new NextResponse(
      JSON.stringify({ error: "Internal server error serving photo", nodeId: id }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    let rawBuffer: Buffer | null = null;
    let mimeType = "image/jpeg";
    let ext = "jpg";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No image file provided in form data." }, { status: 400 });
      }

      const validMimes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
      if (!validMimes.includes(file.type)) {
        return NextResponse.json({ error: "Invalid image format. Allowed: JPG, PNG, WebP, GIF, SVG." }, { status: 415 });
      }

      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File size exceeds 15MB limit." }, { status: 413 });
      }

      mimeType = file.type;
      ext = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "jpg";
      const bytes = await file.arrayBuffer();
      rawBuffer = Buffer.from(bytes);
    } else {
      const body = await req.json().catch(() => ({}));
      const photoDataUri = body.photoData || body.photoUrl || "";

      if (!photoDataUri || !photoDataUri.startsWith("data:image/")) {
        return NextResponse.json({ error: "Invalid image payload format." }, { status: 400 });
      }

      const matches = photoDataUri.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        ext = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "jpg";
        rawBuffer = Buffer.from(matches[2], "base64");
      }
    }

    if (!rawBuffer) {
      return NextResponse.json({ error: "Could not process image binary." }, { status: 400 });
    }

    const safeNodeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uniqueToken = Math.random().toString(36).substring(2, 9);
    const uniqueFilename = `ref_${Date.now()}_${uniqueToken}.${ext}`;
    const uploadedAt = new Date().toISOString();

    // 1. Supabase Object Storage Upload (if Supabase credentials available)
    let persistentUrl = `/api/nodes/${id}/photo`;
    let storagePath = `nodes/${safeNodeId}/${uniqueFilename}`;

    try {
      const supabaseResult = await uploadNodePhotoToSupabase(id, rawBuffer, mimeType);
      if (supabaseResult.success && supabaseResult.publicUrl) {
        persistentUrl = supabaseResult.publicUrl;
        storagePath = supabaseResult.storagePath;
        console.log(`[SUPABASE-STORAGE] Uploaded directly to Supabase Storage: ${persistentUrl}`);
      }
    } catch (sbErr: unknown) {
      console.warn(`[SUPABASE-STORAGE] Notice: Supabase storage upload skipped:`, (sbErr as Error)?.message);
    }

    // 2. Fall back to storing the bytes in Postgres
    if (prisma && prisma.nodePhoto) {
      const uint8Data = new Uint8Array(rawBuffer);
      await prisma.nodePhoto.upsert({
        where: { nodeId: id },
        update: {
          data: uint8Data,
          mimeType,
          size: rawBuffer.length,
          updatedAt: new Date(),
        },
        create: {
          nodeId: id,
          data: uint8Data,
          mimeType,
          size: rawBuffer.length,
        },
      });
    }

    // 3. Persist lightweight URL & metadata in Node table (Zero Base64 bloat)
    if (prisma) {
      try {
        const updatedMeta: Record<string, unknown> = {
          photoUrl: persistentUrl,
          storagePath,
          photoUploadedAt: uploadedAt,
          physicalVerified: true,
        };

        const existingNode = await prisma.node.findUnique({
          where: { id },
          select: { metadata: true, campusId: true },
        }).catch(() => null);

        const existingMeta = (existingNode?.metadata && typeof existingNode?.metadata === "object")
          ? (existingNode.metadata as Record<string, unknown>)
          : {};

        const mergedMeta = { ...existingMeta, ...updatedMeta };
        delete (mergedMeta as Record<string, unknown>).photoData;

        if (existingNode) {
          await prisma.node.update({
            where: { id },
            data: { metadata: mergedMeta as unknown as Prisma.InputJsonValue },
          }).catch(() => {});
        } else {
          const defaultCampus = await prisma.campus.findFirst({ select: { id: true } }).catch(() => null);
          const campusId = defaultCampus?.id || "c1";

          await prisma.node.upsert({
            where: { id },
            update: { metadata: mergedMeta as unknown as Prisma.InputJsonValue },
            create: {
              id,
              campusId,
              type: "CORRIDOR",
              metadata: mergedMeta as unknown as Prisma.InputJsonValue,
            },
          }).catch(() => {});
        }

        // 4. Update Draft and Published Snapshots in background
        setTimeout(async () => {
          if (!prisma) return;
          try {
            const draftRec = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null);
            if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
              const snap = draftRec.snapshot as { nodes?: Array<{ id: string; photoUrl?: string; photoUploadedAt?: string; physicalVerified?: boolean; photoData?: unknown }> };
              if (Array.isArray(snap.nodes)) {
                const nd = snap.nodes.find((n) => n.id === id);
                if (nd) {
                  nd.photoUrl = persistentUrl;
                  nd.photoUploadedAt = uploadedAt;
                  nd.physicalVerified = true;
                  delete nd.photoData;
                  await prisma.draftGraph.update({
                    where: { id: "active-draft" },
                    data: { snapshot: snap as unknown as Prisma.InputJsonValue },
                  }).catch(() => {});
                }
              }
            }

            const pubRec = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null);
            if (pubRec?.snapshot && typeof pubRec.snapshot === "object") {
              const snap = pubRec.snapshot as { nodes?: Array<{ id: string; photoUrl?: string; photoUploadedAt?: string; physicalVerified?: boolean; photoData?: unknown }> };
              if (Array.isArray(snap.nodes)) {
                const nd = snap.nodes.find((n) => n.id === id);
                if (nd) {
                  nd.photoUrl = persistentUrl;
                  nd.photoUploadedAt = uploadedAt;
                  nd.physicalVerified = true;
                  delete nd.photoData;
                  await prisma.publishedGraph.update({
                    where: { id: "active-published" },
                    data: { snapshot: snap as unknown as Prisma.InputJsonValue },
                  }).catch(() => {});
                }
              }
            }
          } catch {}
        }, 0);
      } catch (dbErr: unknown) {
        console.warn(`[PHOTO-STORAGE] Database metadata update warning for ${id}:`, (dbErr as Error)?.message);
      }
    }

    return NextResponse.json({
      success: true,
      nodeId: id,
      photoUrl: persistentUrl,
      storagePath,
      uploadedAt,
    });
  } catch (err: unknown) {
    console.error(`[PHOTO-STORAGE] Error uploading photo for node ${id}:`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Failed to upload reference photo."
    }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 1. Delete from PostgreSQL NodePhoto table
    if (prisma && prisma.nodePhoto) {
      await prisma.nodePhoto.deleteMany({ where: { nodeId: id } }).catch(() => {});
    }

    // 2. Delete from Supabase Object Storage if metadata has storagePath
    if (prisma) {
      const existingNode = await prisma.node.findUnique({
        where: { id },
        select: { metadata: true },
      }).catch(() => null);

      if (existingNode?.metadata && typeof existingNode.metadata === "object") {
        const meta = existingNode.metadata as Record<string, unknown>;
        if (typeof meta.storagePath === "string") {
          await deleteNodePhotoFromSupabase(meta.storagePath).catch(() => {});
        }
      }
    }

    // 3. Remove photo metadata from Node table and Snapshots
    if (prisma) {
      const existingNode = await prisma.node.findUnique({
        where: { id },
        select: { metadata: true },
      }).catch(() => null);

      if (existingNode?.metadata && typeof existingNode.metadata === "object") {
        const meta = { ...(existingNode.metadata as Record<string, unknown>) };
        delete meta.photoData;
        delete meta.photoUrl;
        delete meta.storagePath;
        delete meta.photoUploadedAt;
        delete meta.physicalVerified;

        await prisma.node.update({
          where: { id },
          data: { metadata: meta as unknown as Prisma.InputJsonValue },
        }).catch(() => {});
      }

      const draftRec = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null);
      const pubRec = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null);

      if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
        const snap = draftRec.snapshot as { nodes?: Array<{ id: string; photoUrl?: string; photoData?: unknown; photoUploadedAt?: string; physicalVerified?: boolean }> };
        if (Array.isArray(snap.nodes)) {
          const nd = snap.nodes.find((n) => n.id === id);
          if (nd) {
            delete nd.photoUrl;
            delete nd.photoData;
            delete nd.photoUploadedAt;
            delete nd.physicalVerified;
            await prisma.draftGraph.update({
              where: { id: "active-draft" },
              data: { snapshot: snap as unknown as Prisma.InputJsonValue },
            }).catch(() => {});
          }
        }
      }

      if (pubRec?.snapshot && typeof pubRec.snapshot === "object") {
        const snap = pubRec.snapshot as { nodes?: Array<{ id: string; photoUrl?: string; photoData?: unknown; photoUploadedAt?: string; physicalVerified?: boolean }> };
        if (Array.isArray(snap.nodes)) {
          const nd = snap.nodes.find((n) => n.id === id);
          if (nd) {
            delete nd.photoUrl;
            delete nd.photoData;
            delete nd.photoUploadedAt;
            delete nd.physicalVerified;
            await prisma.publishedGraph.update({
              where: { id: "active-published" },
              data: { snapshot: snap as unknown as Prisma.InputJsonValue },
            }).catch(() => {});
          }
        }
      }
    }

    return NextResponse.json({ success: true, nodeId: id });
  } catch (err: unknown) {
    console.error(`[PHOTO-STORAGE] Error deleting photo for node ${id}:`, err);
    return NextResponse.json({ error: "Failed to remove reference photo." }, { status: 500 });
  }
}

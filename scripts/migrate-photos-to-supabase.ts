import { prisma } from "../shared/lib/prisma";
import { uploadNodePhotoToSupabase } from "../lib/storage/supabase-storage";
import fs from "fs";
import path from "path";

const PHOTOS_DIR = path.join(process.cwd(), ".data", "node-photos");

async function migratePhotosToSupabase() {
  console.log("==================================================");
  console.log("  MIGRATE REFERENCE PHOTOS TO SUPABASE STORAGE");
  console.log("==================================================");

  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log("No local .data/node-photos directory found. Nothing to migrate.");
    return;
  }

  const files = fs.readdirSync(PHOTOS_DIR);
  const datFiles = files.filter((f) => f.endsWith(".dat"));

  console.log(`Found ${datFiles.length} local photo files to analyze...`);

  let successCount = 0;
  let failCount = 0;

  for (const file of datFiles) {
    const nodeId = file.replace(/\.dat$/, "");
    const datPath = path.join(PHOTOS_DIR, file);
    const jsonPath = path.join(PHOTOS_DIR, `${nodeId}.json`);

    try {
      const buffer = fs.readFileSync(datPath);
      let mimeType = "image/jpeg";
      if (fs.existsSync(jsonPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
          if (meta.mimeType) mimeType = meta.mimeType;
        } catch {}
      }

      console.log(`\nUploading photo for node "${nodeId}" (${(buffer.length / 1024).toFixed(1)} KB, ${mimeType})...`);
      const uploadRes = await uploadNodePhotoToSupabase(nodeId, buffer, mimeType);

      if (uploadRes.success && uploadRes.publicUrl) {
        console.log(`  -> Uploaded: ${uploadRes.publicUrl}`);

        if (prisma) {
          const existingNode = await prisma.node.findUnique({
            where: { id: nodeId },
            select: { metadata: true },
          }).catch(() => null);

          const existingMeta = (existingNode?.metadata && typeof existingNode.metadata === "object")
            ? (existingNode.metadata as Record<string, any>)
            : {};

          const updatedMeta: Record<string, any> = {
            ...existingMeta,
            photoUrl: uploadRes.publicUrl,
            storagePath: uploadRes.storagePath,
            photoUploadedAt: new Date().toISOString(),
          };
          delete updatedMeta.photoData;

          await prisma.node.upsert({
            where: { id: nodeId },
            update: { metadata: updatedMeta },
            create: {
              id: nodeId,
              campusId: "c1",
              type: "CORRIDOR",
              metadata: updatedMeta,
            },
          });
          console.log(`  -> Database node "${nodeId}" persisted with photoUrl: ${uploadRes.publicUrl}`);
        }
        successCount++;
      } else {
        console.error(`  -> Failed: ${uploadRes.error}`);
        failCount++;
      }
    } catch (err) {
      console.error(`  -> Error processing ${file}:`, err);
      failCount++;
    }
  }

  // Update active draft and published snapshots in database
  if (prisma) {
    try {
      const [draftRec, pubRec] = await Promise.all([
        prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
        prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null),
      ]);

      if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
        const snap = draftRec.snapshot as any;
        let modified = false;
        if (Array.isArray(snap.nodes)) {
          for (const n of snap.nodes) {
            if (n.photoUrl && n.photoUrl.startsWith("data:")) {
              delete n.photoUrl;
              delete n.photoData;
              modified = true;
            }
          }
        }
        if (modified) {
          await prisma.draftGraph.update({ where: { id: "active-draft" }, data: { snapshot: snap } });
          console.log("  -> Active draft snapshot sanitized.");
        }
      }

      if (pubRec?.snapshot && typeof pubRec.snapshot === "object") {
        const snap = pubRec.snapshot as any;
        let modified = false;
        if (Array.isArray(snap.nodes)) {
          for (const n of snap.nodes) {
            if (n.photoUrl && n.photoUrl.startsWith("data:")) {
              delete n.photoUrl;
              delete n.photoData;
              modified = true;
            }
          }
        }
        if (modified) {
          await prisma.publishedGraph.update({ where: { id: "active-published" }, data: { snapshot: snap } });
          console.log("  -> Active published snapshot sanitized.");
        }
      }
    } catch (err) {
      console.warn("Snapshot sync notice:", err);
    }
  }

  console.log("\n==================================================");
  console.log(`MIGRATION SUMMARY: ${successCount} uploaded, ${failCount} failed.`);
  console.log("==================================================");
}

migratePhotosToSupabase()
  .catch(console.error)
  .finally(() => {
    if (prisma) prisma.$disconnect();
  });

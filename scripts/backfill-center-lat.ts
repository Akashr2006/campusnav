import { PrismaClient } from "@prisma/client";
import { getCenterFromCorners } from "../lib/geo/projection";
import { Building } from "../shared/data/campus";

const prisma = new PrismaClient();

async function backfillBuildings(buildings: Building[]) {
  let correctedCount = 0;
  
  for (const b of buildings) {
    if (b.corner1Lat && b.corner1Lng && 
        b.corner2Lat && b.corner2Lng && 
        b.corner3Lat && b.corner3Lng && 
        b.corner4Lat && b.corner4Lng) {
      
      const corners = [
        { lat: b.corner1Lat, lng: b.corner1Lng },
        { lat: b.corner2Lat, lng: b.corner2Lng },
        { lat: b.corner3Lat, lng: b.corner3Lng },
        { lat: b.corner4Lat, lng: b.corner4Lng },
      ];

      const center = getCenterFromCorners(corners);
      
      if (b.name === "Pearl") {
        console.log(`\nPearl Building - Before:`);
        console.log(`centerLat: ${b.centerLat}, centerLng: ${b.centerLng}`);
      }

      // We explicitly check if it needs correction to only count the actual changed ones.
      // But we will unconditionally overwrite just to be sure it is exactly the average.
      if (b.centerLat !== center.lat || b.centerLng !== center.lng) {
        correctedCount++;
      }
      
      b.centerLat = center.lat;
      b.centerLng = center.lng;

      if (b.name === "Pearl") {
        console.log(`Pearl Building - After:`);
        console.log(`centerLat: ${b.centerLat}, centerLng: ${b.centerLng}\n`);
      }
    }
  }
  
  return correctedCount;
}

async function main() {
  console.log("Starting backfill for centerLat and centerLng...");
  let totalCorrected = 0;

  // 1. Process DraftGraph
  const draft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
  if (draft && draft.snapshot) {
    const snapshot = draft.snapshot as any;
    if (snapshot.buildings && Array.isArray(snapshot.buildings)) {
      console.log(`Processing DraftGraph with ${snapshot.buildings.length} buildings...`);
      const corrected = await backfillBuildings(snapshot.buildings);
      totalCorrected += corrected;
      
      await prisma.draftGraph.update({
        where: { id: "active-draft" },
        data: { snapshot: snapshot }
      });
      console.log(`DraftGraph updated. Corrected: ${corrected}`);
    }
  }

  // 2. Process PublishedGraph
  const published = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } });
  if (published && published.snapshot) {
    const snapshot = published.snapshot as any;
    if (snapshot.buildings && Array.isArray(snapshot.buildings)) {
      console.log(`Processing PublishedGraph with ${snapshot.buildings.length} buildings...`);
      const corrected = await backfillBuildings(snapshot.buildings);
      totalCorrected += corrected;
      
      await prisma.publishedGraph.update({
        where: { id: "active-published" },
        data: { snapshot: snapshot }
      });
      console.log(`PublishedGraph updated. Corrected: ${corrected}`);
    }
  }

  // NOTE: Building table does not have centerLat/centerLng columns, so it is skipped.

  console.log(`\nBackfill complete. Total buildings corrected: ${totalCorrected}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

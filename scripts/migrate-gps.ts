import { PrismaClient } from '@prisma/client';
import { solveAffineMatrix, canvasToGps as affineCanvasToGps } from '../lib/geo/affine';

const prisma = new PrismaClient();

function getBuildingAffineMatrix(b: any) {
  if (!b || b.corner1Lat === undefined || b.corner1Lng === undefined || b.corner3Lat === undefined || b.corner3Lng === undefined) {
    return null;
  }
  const bx = b.x || 0;
  const by = b.y || 0;
  const bw = b.width || 180;
  const bh = b.height || 120;
  const points = [
    {
      canvasX: bx - bw / 2,
      canvasY: by - bh / 2,
      lat: b.corner1Lat,
      lng: b.corner1Lng,
    },
    {
      canvasX: bx + bw / 2,
      canvasY: by + bh / 2,
      lat: b.corner3Lat,
      lng: b.corner3Lng,
    },
  ];
  return solveAffineMatrix(points);
}

async function main() {
  console.log("Starting GPS migration for draftGraph...");
  
  const draft = await prisma.draftGraph.findUnique({
    where: { id: "active-draft" }
  });

  if (!draft || !draft.snapshot) {
    console.log("No active draftGraph found. Exiting.");
    return;
  }

  const snapshot: any = draft.snapshot;
  
  const buildings = snapshot.buildings || [];
  const floors = snapshot.floors || [];
  const nodes = snapshot.nodes || [];

  let migratedCount = 0;

  for (const node of nodes) {
    if (node.floorId === "f-out") continue; // Outdoor nodes are not affected by building affine matrices
    
    const floor = floors.find((f: any) => f.id === node.floorId);
    if (!floor) continue;

    const building = buildings.find((b: any) => b.id === floor.buildingId);
    if (!building) continue;

    const affine = getBuildingAffineMatrix(building);
    if (!affine) continue;

    const newGps = affineCanvasToGps(node.x, node.y, affine);
    
    const latDiff = Math.abs((node.lat || 0) - newGps.lat);
    const lngDiff = Math.abs((node.lng || 0) - newGps.lng);
    
    if (latDiff > 0.00000001 || lngDiff > 0.00000001) {
      node.lat = newGps.lat;
      node.lng = newGps.lng;
      migratedCount++;
    }
  }

  if (migratedCount > 0) {
    await prisma.draftGraph.update({
      where: { id: "active-draft" },
      data: { snapshot: snapshot }
    });
    console.log(`Successfully migrated GPS coordinates for ${migratedCount} nodes.`);
  } else {
    console.log("No nodes required GPS migration.");
  }
}

main()
  .catch(e => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

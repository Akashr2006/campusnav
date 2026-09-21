const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const versions = await prisma.mapVersion.findMany({
    orderBy: { version: 'desc' },
    take: 1
  });
  
  if (versions.length > 0) {
    const nodes = versions[0].snapshot.nodes || [];
    if (nodes.length > 0) {
      nodes.forEach(n => {
        console.log(`ID: ${n.id}, Name: ${n.name || 'N/A'}, X: ${n.x}, Y: ${n.y}, FloorId: ${n.floorId}, Lat: ${n.lat || 'N/A'}, Lng: ${n.lng || 'N/A'}`);
      });
    } else {
      console.log("No nodes found in MapVersion snapshot.");
    }
  } else {
    console.log("No MapVersions found.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const dests = await prisma.destination.findMany({ where: { name: 'B' }});
  console.log('Destinations:', dests);
  const nodeIds = dests.map(d => d.nodeId).filter(Boolean);
  const nodes = await prisma.node.findMany({ where: { id: { in: nodeIds as string[] } } });
  console.log('Nodes:', nodes);
}
main().finally(() => prisma.$disconnect());

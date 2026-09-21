import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const buildings = await prisma.building.findMany();
  console.log('Buildings:', buildings);
}
main().finally(() => prisma.$disconnect());

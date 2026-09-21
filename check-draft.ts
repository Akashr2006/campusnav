import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function main() { 
  const draft = await prisma.draftGraph.findUnique({where:{id:'active-draft'}}); 
  if (draft && draft.snapshot) {
    const snap: any = draft.snapshot;
    console.log('Draft found, buildings: ' + snap.buildings?.length); 
    console.log('Nodes: ' + snap.nodes?.length);
  } else {
    console.log('No draft found'); 
  }
} 
main().finally(()=>prisma.$disconnect());

import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log("Starting backfill of originalQuantity...");

  // IMPORTANT:
  // This fills originalQuantity based on CURRENT quantity (remaining).
  // This is only correct for orders that have NOT been partially filled already.
  // We'll upgrade it to "filled + remaining" after Prisma is in sync.

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Order"
    SET "originalQuantity" = "quantity"
    WHERE "originalQuantity" IS NULL
  `);

  console.log(`Backfill done. Updated rows: ${updated}`);
}

main()
  .catch((e) => {
    console.error("Script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
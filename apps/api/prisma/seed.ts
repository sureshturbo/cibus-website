/**
 * Development seed.
 *
 * Idempotent: every record is matched on its natural key and updated in place, so
 * running the seed repeatedly is safe and can be used to reset demo data after
 * exploring the admin panel.
 *
 * Run with: npm run prisma:seed
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import argon2 from "argon2";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/** Integer paise from a rupee string, so prices read like the proposal does. */
function rupees(value: string): number {
  return Math.round(Number(value) * 100);
}

async function upsertAdmin(): Promise<void> {
  const passwordHash = await argon2.hash(env.SEED_ADMIN_PASSWORD);
  await prisma.admin.upsert({
    where: { email: env.SEED_ADMIN_EMAIL.toLowerCase() },
    update: { passwordHash, fullName: env.SEED_ADMIN_NAME, isActive: true },
    create: { email: env.SEED_ADMIN_EMAIL.toLowerCase(), passwordHash, fullName: env.SEED_ADMIN_NAME },
  });
  console.log(`  admin      ${env.SEED_ADMIN_EMAIL}`);
}

interface SeedCategory {
  name: string;
  description: string;
  products: Array<{
    name: string;
    sku: string;
    price: string;
    compareAtPrice?: string;
    unitLabel: string;
    shortDescription: string;
    description: string;
    stock: number;
    threshold: number;
    isFeatured?: boolean;
    allowBackorder?: boolean;
  }>;
}

const CATALOGUE: SeedCategory[] = [
  {
    name: "Chilled Dairy",
    description: "Milk, yoghurt and paneer delivered cold from the dairy.",
    products: [
      {
        name: "Full Cream Milk",
        sku: "DAI-MLK-001",
        price: "68.00",
        unitLabel: "1 L",
        shortDescription: "Full cream, homogenised, delivered chilled.",
        description:
          "Everyday full cream milk, homogenised for a smooth pour and packed in a sealed 1 litre pouch. Keep refrigerated below 4C and consume within three days of delivery.",
        stock: 180,
        threshold: 30,
        isFeatured: true,
      },
      {
        name: "Greek Yoghurt",
        sku: "DAI-YGT-002",
        price: "95.00",
        compareAtPrice: "110.00",
        unitLabel: "400 g",
        shortDescription: "Strained, thick-set, high protein.",
        description:
          "Plain Greek yoghurt strained to a thick set. High in protein, free from added sugar, and thick enough to hold a spoon upright.",
        stock: 64,
        threshold: 20,
        isFeatured: true,
      },
      {
        name: "Fresh Paneer",
        sku: "DAI-PNR-003",
        price: "180.00",
        unitLabel: "200 g",
        shortDescription: "Soft, moist paneer block, made daily.",
        description:
          "Pressed daily in small batches. Soft texture and clean milk flavour; vacuum packed for a five day shelf life once opened and refrigerated.",
        stock: 40,
        threshold: 15,
      },
    ],
  },
  {
    name: "Dry Goods & Staples",
    description: "Rice, atta, pulses, oils and everyday pantry staples.",
    products: [
      {
        name: "Basmati Rice",
        sku: "DRY-RCE-101",
        price: "145.00",
        unitLabel: "5 kg",
        shortDescription: "Aged long-grain basmati.",
        description:
          "Aged long-grain basmati with a distinct aroma and clean finish. Aged for at least a year before packing, which is what separates good basmati from ordinary long grain.",
        stock: 120,
        threshold: 25,
        isFeatured: true,
      },
      {
        name: "Whole Wheat Atta",
        sku: "DRY-ATT-102",
        price: "290.00",
        unitLabel: "10 kg",
        shortDescription: "Stone-ground chakki atta.",
        description:
          "Stone-ground whole wheat flour, milled without sieving out the bran. Chapati dough made from this stays softer for longer.",
        stock: 90,
        threshold: 20,
      },
      {
        name: "Cold Pressed Groundnut Oil",
        sku: "DRY-OIL-103",
        price: "410.00",
        unitLabel: "1 L",
        shortDescription: "Wood pressed, single origin.",
        description:
          "Cold pressed groundnut oil with the natural aroma retained. No bleaching, no additives. Comes in a dark glass bottle to keep light out.",
        stock: 12,
        threshold: 20,
        isFeatured: true,
      },
      {
        name: "Toor Dal",
        sku: "DRY-DAL-104",
        price: "210.00",
        unitLabel: "2 kg",
        shortDescription: "Unpolished toor dal.",
        description: "Unpolished toor dal that holds its shape for a proper, grainy dal.", stock: 75, threshold: 20,
      },
    ],
  },
  {
    name: "Fresh Produce",
    description: "Vegetables and fruit sourced each morning.",
    products: [
      {
        name: "Hybrid Tomatoes",
        sku: "PRD-TOM-201",
        price: "48.00",
        unitLabel: "1 kg",
        shortDescription: "Firm, evenly ripened tomatoes.",
        description:
          "Firm hybrid tomatoes picked at the break-ripen stage so they survive the journey without bruising. Uniform colour and thick skin.",
        stock: 55,
        threshold: 15,
      },
      {
        name: "Onions",
        sku: "PRD-ONI-202",
        price: "40.00",
        unitLabel: "1 kg",
        shortDescription: "Clean, well-cured onions.",
        description: "Well-cured onions with firm skins. Store somewhere dark and ventilated, not in the fridge.", stock: 200, threshold: 30,
      },
      {
        name: "Bananas",
        sku: "PRD-BAN-203",
        price: "60.00",
        unitLabel: "dozen",
        shortDescription: "Sweet Robusta bananas.",
        description: "Sweet Robusta bananas, ripened to eating within two days of delivery.", stock: 8, threshold: 10,
      },
    ],
  },
  {
    name: "Snacks",
    description: "Sweet and savoury snacks, roasted not fried.",
    products: [
      {
        name: "Roasted Makhana",
        sku: "SNK-MKH-301",
        price: "175.00",
        unitLabel: "100 g",
        shortDescription: "Lightly salted, air roasted.",
        description:
          "Air roasted foxnut with a light salt seasoning. No palm oil and no deep frying, so it stays crisp without being heavy.",
        stock: 70,
        threshold: 20,
        isFeatured: true,
      },
      {
        name: "Masala Peanuts",
        sku: "SNK-PNT-302",
        price: "95.00",
        unitLabel: "200 g",
        shortDescription: "Roasted with a tangy masala dust.",
        description: "Peanuts roasted in small batches and dusted with a tangy masala blend.", stock: 95, threshold: 25,
      },
    ],
  },
];

async function seedCatalogue(): Promise<void> {
  let sortOrder = 0;

  for (const category of CATALOGUE) {
    sortOrder += 1;

    const record = await prisma.category.upsert({
      where: { slug: slugify(category.name) },
      update: {
        name: category.name,
        description: category.description,
        sortOrder,
        isActive: true,
      },
      create: {
        name: category.name,
        slug: slugify(category.name),
        description: category.description,
        sortOrder,
        isActive: true,
      },
    });

    console.log(`  category   ${record.name}`);

    for (const item of category.products) {
      const price = rupees(item.price);
      const compareAtPrice = item.compareAtPrice ? rupees(item.compareAtPrice) : null;

      const product = await prisma.product.upsert({
        where: { sku: item.sku },
        update: {
          name: item.name,
          categoryId: record.id,
          price,
          compareAtPrice,
          unitLabel: item.unitLabel,
          shortDescription: item.shortDescription,
          description: item.description,
          lowStockThreshold: item.threshold,
          allowBackorder: item.allowBackorder ?? false,
          isActive: true,
          isFeatured: item.isFeatured ?? false,
          deletedAt: null,
        },
        create: {
          categoryId: record.id,
          name: item.name,
          slug: slugify(item.name),
          sku: item.sku,
          shortDescription: item.shortDescription,
          description: item.description,
          unitLabel: item.unitLabel,
          price,
          compareAtPrice,
          lowStockThreshold: item.threshold,
          allowBackorder: item.allowBackorder ?? false,
          isActive: true,
          isFeatured: item.isFeatured ?? false,
        },
      });

      /* Opening stock goes through the ledger, so the balance is attributable
       * to this seed run rather than appearing from nowhere. Only write a
       * PURCHASE row when the cached quantity does not already match. */
      const { stock } = item;
      if (product.stockQuantity !== stock) {
        const delta = stock - product.stockQuantity;
        await prisma.$transaction(async (tx) => {
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: delta >= 0 ? "PURCHASE" : "ADJUSTMENT",
              quantityChange: delta,
              balanceAfter: stock,
              referenceType: "SEED",
              referenceId: "initial-stock",
              note: "Opening stock from seed data",
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: stock },
          });
        });
      }

      console.log(
        `    product   ${product.name} (${product.sku}) stock=${stock}`,
      );
    }
  }
}

async function seedOffers(): Promise<void> {
  const all = await prisma.category.findFirst({ where: { slug: "dry-goods-staples" }, select: { id: true } });
  const dairy = await prisma.category.findFirst({ where: { slug: "chilled-dairy" }, select: { id: true } });

  const now = new Date();
  const past = new Date(now.getTime() - 86_400_000);
  const future = new Date(now.getTime() + 180 * 86_400_000);

  const offers: Prisma.OfferUncheckedCreateInput[] = [
    {
      name: "Welcome 10%",
      code: "WELCOME10",
      type: "PERCENTAGE",
      // Basis points: 1000 = 10.00%.
      value: 1000,
      scope: "ALL_PRODUCTS",
      minOrderAmount: rupees("500"),
      startsAt: past,
      endsAt: future,
      isActive: true,
    },
    {
      name: "Dairy 5% off",
      code: "DAIRY5",
      type: "PERCENTAGE",
      value: 500,
      scope: "CATEGORY",
      categoryId: dairy?.id ?? null,
      minOrderAmount: 0,
      startsAt: past,
      endsAt: future,
      isActive: true,
    },
    {
      name: "Staples flat 100 off",
      code: "STAPLES100",
      type: "FIXED_AMOUNT",
      // Paise, not basis points: this is a flat discount.
      value: rupees("100"),
      scope: "CATEGORY",
      categoryId: all?.id ?? null,
      minOrderAmount: rupees("1200"),
      startsAt: past,
      endsAt: future,
      isActive: true,
    },
  ];

  for (const offer of offers) {
    if (!offer.code) continue;
    await prisma.offer.upsert({
      where: { code: offer.code },
      update: { ...offer, isActive: true },
      create: offer,
    });
    console.log(`  offer      ${offer.name} (${offer.code})`);
  }
}

async function seedCustomer(): Promise<void> {
  const email = "customer@cibus.local";
  const existing = await prisma.customer.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`  customer   ${email} (unchanged)`);
    return;
  }

  await prisma.customer.create({
    data: {
      email,
      passwordHash: await argon2.hash("Customer!2026"),
      fullName: "Anita Customer",
      phone: "+91 90000 00001",
      emailVerifiedAt: new Date(),
      addresses: {
        create: {
          label: "Home",
          fullName: "Anita Customer",
          phone: "+91 90000 00001",
          line1: "12A MG Road",
          line2: "Near the old post office",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
          isDefault: true,
        },
      },
    },
  });

  console.log(`  customer   ${email} (password: Customer!2026)`);
}

async function main(): Promise<void> {
  console.log("Seeding Cibus Trading...");
  await upsertAdmin();
  await seedCatalogue();
  await seedOffers();
  await seedCustomer();
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
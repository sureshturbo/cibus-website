import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { adminProductSelect, availabilityOf, categorySelect, isPurchasable } from "./selects.js";
import { slugify, summarise } from "../lib/util.js";

/**
 * Product and category service.
 *
 * The storefront and admin panel share this module so a product is never
 * described one way in the shop and another way in the panel.
 */

type Tx = Prisma.TransactionClient;

/* ------------------------------- categories ------------------------------ */

export async function listCategories(options: { includeInactive: boolean; tree: boolean }) {
  const where: Prisma.CategoryWhereInput = options.includeInactive ? {} : { isActive: true };

  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      ...categorySelect,
      _count: { select: { products: { where: { isActive: true, deletedAt: null } } } },
    },
  });

  const flat = categories.map(({ _count, ...category }) => ({
    ...category,
    productCount: _count.products,
  }));

  if (!options.tree) return flat;

  // Assemble the parent/child tree in memory; catalogue depth is small enough
  // that a recursive query would cost more than it saves.
  const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as typeof flat }]));
  const roots: Array<(typeof flat)[number] & { children: typeof flat }> = [];

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function getCategoryById(id: number) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { ...categorySelect, _count: { select: { products: true, children: true } } },
  });
  if (!category) throw new NotFoundError("Category");
  return {
    ...category,
    productCount: category._count.products,
    childCount: category._count.children,
  };
}

export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findFirst({
    where: { slug, isActive: true },
    select: { ...categorySelect, parent: { select: categorySelect }, children: { select: categorySelect } },
  });
  return category;
}

export interface CreateCategoryInput {
  name: string;
  slug?: string | null;
  parentId?: number | null;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Reject a category that would make itself its own ancestor. */
export async function assertNoCategoryCycle(categoryId: number, parentId: number): Promise<void> {
  let cursor: number | null = parentId;
  const seen = new Set<number>();

  while (cursor !== null) {
    if (cursor === categoryId) {
      throw new Error("A category cannot be placed inside itself or one of its own descendants");
    }
    if (seen.has(cursor)) break; // existing cycle in data; stop rather than spin
    seen.add(cursor);

    const parent: { parentId: number | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

/**
 * Pick a slug that is not taken.
 *
 * A slug is generated from the name when the admin did not supply one, because
 * the column is required. Collisions get a numeric suffix rather than failing:
 * two products genuinely can share a name, and forcing the admin to invent a
 * second slug by hand is a worse outcome than a tidy one.
 */
async function uniqueSlug(
  model: { findFirst: (args: { where: { slug: string } }) => Promise<unknown> },
  desired: string,
): Promise<string> {
  const base = slugify(desired);
  let candidate = base;

  for (let suffix = 2; suffix < 200; suffix += 1) {
    const clash = await model.findFirst({ where: { slug: candidate } });
    if (!clash) return candidate;
    candidate = `${base}-${suffix}`;
  }

  // Absurd name collision rate: fall back to something guaranteed unique.
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function createCategory(input: CreateCategoryInput) {
  return prisma.category.create({
    data: {
      name: input.name,
      slug: await uniqueSlug(prisma.category, input.slug || input.name),
      parentId: input.parentId ?? null,
      description: input.description ?? "",
      imageUrl: input.imageUrl || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
    select: categorySelect,
  });
}

export async function updateCategory(id: number, input: Partial<CreateCategoryInput>) {
  const existing = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Category");

  // assertNoCategoryCycle already rejects a self-parent, so it must run for that
  // case too. Skipping it left a category parented to itself, which the tree
  // builder then swallowed along with its whole subtree.
  if (input.parentId !== undefined && input.parentId !== null) {
    await assertNoCategoryCycle(id, input.parentId);
  }

  return prisma.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined && input.slug ? { slug: input.slug } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.description !== undefined ? { description: input.description ?? "" } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: categorySelect,
  });
}

/**
 * Categories are deactivated rather than deleted while products reference them,
 * because order history must stay readable. Deletion is allowed only when empty.
 */
export async function deleteCategory(id: number) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { id: true, _count: { select: { products: true, children: true, offers: true } } },
  });
  if (!category) throw new NotFoundError("Category");

  if (category._count.products > 0) {
    throw new Error(
      "This category still holds products. Move or deactivate them before deleting the category.",
    );
  }
  if (category._count.children > 0) {
    throw new Error("This category still has subcategories. Remove or move them first.");
  }
  if (category._count.offers > 0) {
    throw new Error("This category is used by one or more offers. Disable those offers first.");
  }

  await prisma.category.delete({ where: { id } });
}

/* -------------------------------- products ------------------------------- */

export interface ListProductsQuery {
  page: number;
  pageSize: number;
  categoryId?: number;
  categorySlug?: string;
  search?: string;
  sort?: "newest" | "price_asc" | "price_desc" | "name_asc" | "name_desc";
  inStock?: boolean;
  featured?: boolean;
  status?: "all" | "active" | "inactive" | "low_stock" | "out_of_stock";
  includeDeleted?: boolean;
}

export async function listProducts(query: ListProductsQuery): Promise<Paginated<unknown>> {
  const where = await buildProductWhere(query);

  const orderBy = resolveOrderBy(query.sort);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take: query.pageSize,
      select: { ...adminProductSelect },
    }),
  ]);

  const items = rows.map((product) => ({
    ...product,
    availability: availabilityOf(product),
    description: product.description,
    shortDescription: product.shortDescription,
  }));

  return paginate(items, total, query.page, query.pageSize);
}

async function buildProductWhere(query: ListProductsQuery): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = {};

  if (!query.includeDeleted) where.deletedAt = null;

  switch (query.status) {
    case "active":
      where.isActive = true;
      break;
    case "inactive":
      where.isActive = false;
      break;
    case "low_stock":
      // Column-to-column comparison, which the Prisma query builder cannot
      // express. Resolved to a list of ids by raw SQL.
      where.id = { in: await lowStockProductIds() };
      break;
    case "out_of_stock":
      where.stockQuantity = { lte: 0 };
      break;
    default:
      break;
  }

  if (query.featured !== undefined) where.isFeatured = query.featured;

  if (query.categoryId) {
    where.categoryId = query.categoryId;
  } else if (query.categorySlug) {
    const category = await prisma.category.findUnique({
      where: { slug: query.categorySlug },
      select: { id: true },
    });
    if (!category) {
      // An unknown slug must return an empty page, not an error or, worse, an
      // unfiltered list.
      return { id: -1 };
    }
    where.categoryId = category.id;
  }

  if (query.inStock !== undefined) {
    where.stockQuantity = query.inStock ? { gt: 0 } : { lte: 0 };
  }

  if (query.search) {
    // Escape LIKE wildcards so a search for "100%" does not match everything.
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.OR = [
      { name: { contains: term } },
      { shortDescription: { contains: term } },
      { sku: { contains: term } },
      { description: { contains: term } },
    ];
  }

  return where;
}

/** Row shape returned by the raw low-stock query. */
type LowStockIdRow = { id: number };

/** Ids of active products at or below their low-stock threshold. */
export async function lowStockProductIds(): Promise<number[]> {
  const rows = await prisma.$queryRaw<LowStockIdRow[]>(Prisma.sql`
    SELECT id FROM products
    WHERE is_active = 1 AND deleted_at IS NULL AND stock_quantity <= low_stock_threshold
  `);
  return rows.map((row) => row.id);
}

function resolveOrderBy(sort: ListProductsQuery["sort"]): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ price: "asc" }, { id: "asc" }];
    case "price_desc":
      return [{ price: "desc" }, { id: "asc" }];
    case "name_asc":
      return [{ name: "asc" }, { id: "asc" }];
    case "name_desc":
      return [{ name: "desc" }, { id: "asc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

/** Storefront listing: active products only, no internal fields. */
export async function listPublicProducts(
  query: Omit<ListProductsQuery, "status" | "includeDeleted">,
): Promise<Paginated<unknown>> {
  const where = await buildProductWhere({ ...query, status: "active", includeDeleted: false });
  const orderBy = resolveOrderBy(query.sort);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        shortDescription: true,
        description: true,
        unitLabel: true,
        price: true,
        compareAtPrice: true,
        stockQuantity: true,
        lowStockThreshold: true,
        allowBackorder: true,
        isActive: true,
        isFeatured: true,
        createdAt: true,
        category: { select: { id: true, name: true, slug: true } },
        images: {
          select: { id: true, url: true, altText: true, isPrimary: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
  ]);

  const items = rows.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    shortDescription: product.shortDescription,
    description: summarise(product.description, 220),
    unitLabel: product.unitLabel,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    isOnSale: product.compareAtPrice !== null && product.compareAtPrice > product.price,
    inStock: isPurchasable(product),
    stockQuantity: product.stockQuantity,
    isFeatured: product.isFeatured,
    category: product.category,
    images: product.images,
    primaryImage: product.images.find((image) => image.isPrimary) ?? product.images[0] ?? null,
  }));

  return paginate(items, total, query.page, query.pageSize);
}

export async function getPublicProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      shortDescription: true,
      description: true,
      unitLabel: true,
      price: true,
      compareAtPrice: true,
      categoryId: true,
      stockQuantity: true,
      lowStockThreshold: true,
      allowBackorder: true,
      isActive: true,
      isFeatured: true,
      createdAt: true,
      category: { select: { id: true, name: true, slug: true, parentId: true } },
      images: {
        select: { id: true, url: true, altText: true, isPrimary: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!product) return null;

  return {
    ...product,
    isOnSale: product.compareAtPrice !== null && product.compareAtPrice > product.price,
    inStock: isPurchasable(product),
    maxQuantity: product.allowBackorder ? 100 : Math.min(product.stockQuantity, 100),
    related: await relatedProducts(product.id, product.categoryId),
  };
}

async function relatedProducts(productId: number, categoryId: number) {
  return prisma.product.findMany({
    where: { categoryId, isActive: true, deletedAt: null, id: { not: productId } },
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    take: 4,
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      compareAtPrice: true,
      stockQuantity: true,
      allowBackorder: true,
      unitLabel: true,
      images: {
        select: { id: true, url: true, altText: true, isPrimary: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function getProductById(id: number) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      ...adminProductSelect,
      stockMovements: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          quantityChange: true,
          balanceAfter: true,
          note: true,
          referenceType: true,
          createdAt: true,
          createdBy: { select: { id: true, fullName: true } },
        },
      },
      _count: { select: { orderItems: true, cartItems: true } },
    },
  });
  if (!product || product.deletedAt) throw new NotFoundError("Product");

  return {
    ...product,
    availability: availabilityOf(product),
    orderLineCount: product._count.orderItems,
  };
}

export interface CreateProductInput {
  name: string;
  slug?: string | null;
  categoryId: number;
  sku: string;
  shortDescription?: string | null;
  description?: string | null;
  unitLabel?: string;
  price: number;
  compareAtPrice?: number | null;
  lowStockThreshold?: number;
  initialStock?: number;
  isActive?: boolean;
  isFeatured?: boolean;
}

export async function createProduct(input: CreateProductInput, adminId: number): Promise<number> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  if (!category) throw new NotFoundError("Category");

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        slug: await uniqueSlug(tx.product, input.slug || input.name),
        categoryId: input.categoryId,
        sku: input.sku,
        shortDescription: input.shortDescription ?? "",
        description: input.description ?? "",
        unitLabel: input.unitLabel ?? "unit",
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        lowStockThreshold: input.lowStockThreshold ?? 5,
        isActive: input.isActive ?? true,
        isFeatured: input.isFeatured ?? false,
      },
      select: { id: true },
    });

    // Opening stock is recorded as a ledger movement, not a bare quantity
    // update, so the opening balance is attributable and auditable.
    if (input.initialStock && input.initialStock > 0) {
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: "PURCHASE",
          quantityChange: input.initialStock,
          balanceAfter: input.initialStock,
          referenceType: "MANUAL",
          note: "Opening stock",
          createdById: adminId,
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { stockQuantity: input.initialStock },
      });
    }

    return product.id;
  });
}

export async function updateProduct(id: number, input: Partial<CreateProductInput>) {
  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Product");

  if (input.categoryId !== undefined) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) throw new NotFoundError("Category");
  }

  // compareAtPrice below price would advertise a permanent fake discount.
  if (input.compareAtPrice !== undefined && input.compareAtPrice !== null) {
    const current = await prisma.product.findUniqueOrThrow({ where: { id }, select: { price: true } });
    const newPrice = input.price ?? current.price;
    if (input.compareAtPrice <= newPrice) {
      throw new Error("The compare-at price must be higher than the selling price");
    }
  }

  return prisma.product.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined && input.slug ? { slug: input.slug } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.shortDescription !== undefined ? { shortDescription: input.shortDescription ?? "" } : {}),
      ...(input.description !== undefined ? { description: input.description ?? "" } : {}),
      ...(input.unitLabel !== undefined ? { unitLabel: input.unitLabel } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
      ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: input.lowStockThreshold } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
    },
    select: adminProductSelect,
  });
}

export async function setProductActive(id: number, isActive: boolean) {
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) throw new NotFoundError("Product");
  return prisma.product.update({
    where: { id },
    data: { isActive },
    select: { id: true, isActive: true, name: true },
  });
}

export async function setProductFeatured(id: number, isFeatured: boolean) {
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) throw new NotFoundError("Product");
  return prisma.product.update({
    where: { id },
    data: { isFeatured },
    select: { id: true, isFeatured: true, name: true },
  });
}

/**
 * Soft delete. Order history stays intact because order_items snapshots product
 * identity rather than depending on this row continuing to exist.
 */
export async function deleteProduct(id: number) {
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) throw new NotFoundError("Product");

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await tx.cartItem.deleteMany({ where: { productId: id } });
  });
}

/* --------------------------------- images -------------------------------- */

export async function addProductImage(
  productId: number,
  input: { url: string; altText?: string | null; isPrimary?: boolean; sortOrder?: number },
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!product) throw new NotFoundError("Product");

  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.productImage.updateMany({ where: { productId }, data: { isPrimary: false } });
    }
    return tx.productImage.create({
      data: {
        productId,
        url: input.url,
        altText: input.altText ?? "",
        isPrimary: input.isPrimary ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  });
}

export async function deleteProductImage(imageId: number) {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { id: true, productId: true, isPrimary: true },
  });
  if (!image) throw new NotFoundError("Image");

  await prisma.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });

    // Never leave a product with no primary image if the deleted one was it.
    if (image.isPrimary) {
      const next = await tx.productImage.findFirst({
        where: { productId: image.productId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (next) {
        await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });
}

export async function reorderProductImages(productId: number, orderedIds: number[]) {
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx.productImage.updateMany({
        where: { id, productId },
        data: { sortOrder: index, isPrimary: index === 0 },
      });
    }
  });
}

export type { Tx };
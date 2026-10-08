import { randomBytes } from "node:crypto";
import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import { transaction, type Tx } from "../db/pool.js";
import type { CategoryRow, ProductImageRow, ProductRow } from "../db/types.js";
import {
  categoriesByIds,
  categoryDeleteRefs,
  categorySlugExists,
  countProducts,
  deleteCartItemsForProduct,
  deleteCategoryRow,
  deleteProductImageRow,
  findActiveProductBySlug,
  findCategoryById,
  findCategoryBySlugActive,
  findCategoryIdBySlug,
  findCategoryParent,
  findFirstProductImage,
  findProductById,
  findProductImage,
  getCategoryWithCounts,
  imagesForProductIds,
  insertCategory,
  insertProduct,
  insertProductImage,
  insertStockMovement,
  listCategoryRows,
  listChildCategoryRows,
  listProductRows,
  listStockMovements,
  listTopLevelCategoryRows,
  lowStockProductIdRows,
  productSlugExists,
  updateCategoryRow,
  updateProductRow,
  adminsByIds,
  productRefCounts,
  clearPrimaryImages,
  setPrimaryImage,
  updateImageOrder,
} from "../db/repositories/catalog.repo.js";
import { availabilityOf, isPurchasable } from "./selects.js";
import { slugify, summarise } from "../lib/util.js";

/**
 * Product and category service.
 *
 * The storefront and admin panel share this module so a product is never
 * described one way in the shop and another way in the panel.
 */

/* ------------------------------- categories ------------------------------ */

export async function listCategories(options: { includeInactive: boolean; tree: boolean }) {
  const rows = await listCategoryRows(options.includeInactive);

  const flat = rows.map(({ productCount, ...category }) => ({
    ...category,
    productCount: Number(productCount),
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

/** Active top-level categories with live product counts (storefront menu). */
export async function listPublicCategories() {
  const rows = await listTopLevelCategoryRows();
  return rows.map((row) => ({ ...row, productCount: Number(row.productCount) }));
}

export async function getCategoryById(id: number) {
  const row = await getCategoryWithCounts(id);
  if (!row) throw new NotFoundError("Category");
  const { productCount, childCount, ...category } = row;
  return {
    ...category,
    productCount: Number(productCount),
    childCount: Number(childCount),
  };
}

export async function getCategoryBySlug(slug: string) {
  const category = await findCategoryBySlugActive(slug);
  if (!category) return null;

  const [parent, children] = await Promise.all([
    category.parentId !== null ? findCategoryById(category.parentId) : Promise.resolve(null),
    listChildCategoryRows(category.id),
  ]);

  return { ...category, parent, children };
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

    const parent = await findCategoryParent(cursor);
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
async function uniqueSlug(taken: (slug: string) => Promise<boolean>, desired: string): Promise<string> {
  const base = slugify(desired);
  let candidate = base;

  for (let suffix = 2; suffix < 200; suffix += 1) {
    if (!(await taken(candidate))) return candidate;
    candidate = `${base}-${suffix}`;
  }

  // Absurd name collision rate: fall back to something guaranteed unique.
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function createCategory(input: CreateCategoryInput) {
  return insertCategory({
    name: input.name,
    slug: await uniqueSlug((slug) => categorySlugExists(slug), input.slug || input.name),
    parentId: input.parentId ?? null,
    description: input.description ?? "",
    imageUrl: input.imageUrl || null,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  });
}

export async function updateCategory(id: number, input: Partial<CreateCategoryInput>) {
  const existing = await findCategoryById(id);
  if (!existing) throw new NotFoundError("Category");

  // assertNoCategoryCycle already rejects a self-parent, so it must run for that
  // case too. Skipping it left a category parented to itself, which the tree
  // builder then swallowed along with its whole subtree.
  if (input.parentId !== undefined && input.parentId !== null) {
    await assertNoCategoryCycle(id, input.parentId);
  }

  const values: Record<string, unknown> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.slug !== undefined && input.slug) values.slug = input.slug;
  if (input.parentId !== undefined) values.parentId = input.parentId;
  if (input.description !== undefined) values.description = input.description ?? "";
  if (input.imageUrl !== undefined) values.imageUrl = input.imageUrl || null;
  if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) values.isActive = input.isActive;

  return updateCategoryRow(id, values);
}

/**
 * Categories are deactivated rather than deleted while products reference them,
 * because order history must stay readable. Deletion is allowed only when empty.
 */
export async function deleteCategory(id: number) {
  const category = await categoryDeleteRefs(id);
  if (!category) throw new NotFoundError("Category");

  if (Number(category.products) > 0) {
    throw new Error(
      "This category still holds products. Move or deactivate them before deleting the category.",
    );
  }
  if (Number(category.children) > 0) {
    throw new Error("This category still has subcategories. Remove or move them first.");
  }
  if (Number(category.offers) > 0) {
    throw new Error("This category is used by one or more offers. Disable those offers first.");
  }

  await deleteCategoryRow(id);
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
  const { sql, params } = await buildProductWhere(query);
  const orderBy = resolveOrderBy(query.sort);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countProducts(sql, params),
    listProductRows(sql, params, orderBy, query.pageSize, skip),
  ]);

  const decorated = await decorateProducts(rows);
  const items = decorated.map((product) => ({
    ...adminProductItem(product),
    availability: availabilityOf(product.row),
  }));

  return paginate(items, total, query.page, query.pageSize);
}

interface WhereFragment {
  sql: string;
  params: unknown[];
}

async function buildProductWhere(query: ListProductsQuery): Promise<WhereFragment> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!query.includeDeleted) clauses.push("p.deleted_at IS NULL");

  switch (query.status) {
    case "active":
      clauses.push("p.is_active = 1");
      break;
    case "inactive":
      clauses.push("p.is_active = 0");
      break;
    case "low_stock": {
      // Column-to-column comparison, which a query builder cannot express.
      // Resolved to a list of ids first.
      const ids = await lowStockProductIds();
      if (ids.length === 0) return { sql: "WHERE 1 = 0", params: [] };
      clauses.push(`p.id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
      break;
    }
    case "out_of_stock":
      clauses.push("p.stock_quantity <= 0");
      break;
    default:
      break;
  }

  if (query.featured !== undefined) {
    clauses.push("p.is_featured = ?");
    params.push(query.featured);
  }

  if (query.categoryId) {
    clauses.push("p.category_id = ?");
    params.push(query.categoryId);
  } else if (query.categorySlug) {
    const categoryId = await findCategoryIdBySlug(query.categorySlug);
    if (categoryId === null) {
      // An unknown slug must return an empty page, not an error or, worse, an
      // unfiltered list.
      return { sql: "WHERE 1 = 0", params: [] };
    }
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  }

  if (query.inStock !== undefined) {
    clauses.push(query.inStock ? "p.stock_quantity > 0" : "p.stock_quantity <= 0");
  }

  if (query.search) {
    // Escape LIKE wildcards so a search for "100%" does not match everything.
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    const like = `%${term}%`;
    clauses.push("(p.name LIKE ? OR p.short_description LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)");
    params.push(like, like, like, like);
  }

  const sql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

/** Ids of active products at or below their low-stock threshold. */
export async function lowStockProductIds(): Promise<number[]> {
  const rows = await lowStockProductIdRows();
  return rows.map((row) => row.id);
}

function resolveOrderBy(sort: ListProductsQuery["sort"]): string {
  switch (sort) {
    case "price_asc":
      return "p.price ASC, p.id ASC";
    case "price_desc":
      return "p.price DESC, p.id ASC";
    case "name_asc":
      return "p.name ASC, p.id ASC";
    case "name_desc":
      return "p.name DESC, p.id ASC";
    default:
      return "p.created_at DESC, p.id DESC";
  }
}

interface DecoratedProduct {
  row: ProductRow;
  category: CategoryRow | null;
  images: ProductImageRow[];
}

/** Attach category and images to raw rows without N+1 queries. */
async function decorateProducts(rows: ProductRow[]): Promise<DecoratedProduct[]> {
  if (rows.length === 0) return [];

  const categoryIds = [...new Set(rows.map((row) => row.categoryId))];
  const [categories, images] = await Promise.all([
    categoriesByIds(categoryIds),
    imagesForProductIds(rows.map((row) => row.id)),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const imagesByProduct = new Map<number, ProductImageRow[]>();
  for (const image of images) {
    const list = imagesByProduct.get(image.productId);
    if (list) list.push(image);
    else imagesByProduct.set(image.productId, [image]);
  }

  return rows.map((row) => ({
    row,
    category: categoryById.get(row.categoryId) ?? null,
    images: imagesByProduct.get(row.id) ?? [],
  }));
}

/** Decorate exactly one row; used where the row is guaranteed to exist. */
async function decorateOne(row: ProductRow): Promise<DecoratedProduct> {
  const [decorated] = await decorateProducts([row]);
  if (!decorated) throw new Error("Product row could not be decorated");
  return decorated;
}

function imageItem(image: ProductImageRow) {
  return {
    id: image.id,
    url: image.url,
    altText: image.altText,
    isPrimary: image.isPrimary,
    sortOrder: image.sortOrder,
  };
}

/** The admin product shape: every stored column plus category and images. */
function adminProductItem({ row, category, images }: DecoratedProduct) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    shortDescription: row.shortDescription,
    description: row.description,
    unitLabel: row.unitLabel,
    price: row.price,
    compareAtPrice: row.compareAtPrice,
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold,
    allowBackorder: row.allowBackorder,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    categoryId: row.categoryId,
    deletedAt: row.deletedAt,
    category: category
      ? { id: category.id, name: category.name, slug: category.slug, parentId: category.parentId }
      : null,
    images: images.map(imageItem),
  };
}

/** Storefront listing: active products only, no internal fields. */
export async function listPublicProducts(
  query: Omit<ListProductsQuery, "status" | "includeDeleted">,
): Promise<Paginated<unknown>> {
  const { sql, params } = await buildProductWhere({ ...query, status: "active", includeDeleted: false });
  const orderBy = resolveOrderBy(query.sort);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countProducts(sql, params),
    listProductRows(sql, params, orderBy, query.pageSize, skip),
  ]);

  const decorated = await decorateProducts(rows);
  const items = decorated.map((product) => {
    const { row, category, images } = product;
    const primary = images.find((image) => image.isPrimary) ?? images[0] ?? null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      shortDescription: row.shortDescription,
      description: summarise(row.description, 220),
      unitLabel: row.unitLabel,
      price: row.price,
      compareAtPrice: row.compareAtPrice,
      isOnSale: row.compareAtPrice !== null && row.compareAtPrice > row.price,
      inStock: isPurchasable(row),
      stockQuantity: row.stockQuantity,
      isFeatured: row.isFeatured,
      category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
      images: images.map(imageItem),
      primaryImage: primary ? imageItem(primary) : null,
    };
  });

  return paginate(items, total, query.page, query.pageSize);
}

export async function getPublicProductBySlug(slug: string) {
  const row = await findActiveProductBySlug(slug);
  if (!row) return null;

  const decorated = await decorateOne(row);
  const relatedRows = await listProductRows(
    "WHERE p.category_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL AND p.id <> ?",
    [row.categoryId, row.id],
    "p.is_featured DESC, p.created_at DESC, p.id DESC",
    4,
    0,
  );
  const related = (await decorateProducts(relatedRows)).map((item) => ({
    id: item.row.id,
    name: item.row.name,
    slug: item.row.slug,
    price: item.row.price,
    compareAtPrice: item.row.compareAtPrice,
    stockQuantity: item.row.stockQuantity,
    allowBackorder: item.row.allowBackorder,
    unitLabel: item.row.unitLabel,
    images: item.images.map(imageItem),
  }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    shortDescription: row.shortDescription,
    description: row.description,
    unitLabel: row.unitLabel,
    price: row.price,
    compareAtPrice: row.compareAtPrice,
    categoryId: row.categoryId,
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold,
    allowBackorder: row.allowBackorder,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    createdAt: row.createdAt,
    category: decorated.category
      ? {
          id: decorated.category.id,
          name: decorated.category.name,
          slug: decorated.category.slug,
          parentId: decorated.category.parentId,
        }
      : null,
    images: decorated.images.map(imageItem),
    isOnSale: row.compareAtPrice !== null && row.compareAtPrice > row.price,
    inStock: isPurchasable(row),
    maxQuantity: row.allowBackorder ? 100 : Math.min(row.stockQuantity, 100),
    related,
  };
}

export async function getProductById(id: number) {
  const row = await findProductById(id);
  if (!row || row.deletedAt) throw new NotFoundError("Product");

  const decorated = await decorateOne(row);
  const movements = await listStockMovements(id, 10);
  const adminIds = [
    ...new Set(
      movements
        .map((movement) => movement.createdById)
        .filter((value): value is number => value !== null),
    ),
  ];
  const admins = await adminsByIds(adminIds);
  const adminById = new Map(admins.map((admin) => [admin.id, admin]));
  const counts = await productRefCounts(id);

  return {
    ...adminProductItem(decorated),
    availability: availabilityOf(row),
    stockMovements: movements.map((movement) => ({
      id: movement.id,
      type: movement.type,
      quantityChange: movement.quantityChange,
      balanceAfter: movement.balanceAfter,
      note: movement.note,
      referenceType: movement.referenceType,
      createdAt: movement.createdAt,
      createdBy:
        movement.createdById !== null ? (adminById.get(movement.createdById) ?? null) : null,
    })),
    _count: { orderItems: counts.orderItems, cartItems: counts.cartItems },
    orderLineCount: counts.orderItems,
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
  const category = await findCategoryById(input.categoryId);
  if (!category) throw new NotFoundError("Category");

  return transaction(async (tx) => {
    const productId = await insertProduct(
      {
        name: input.name,
        slug: await uniqueSlug((slug) => productSlugExists(slug, tx), input.slug || input.name),
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
      tx,
    );

    // Opening stock is recorded as a ledger movement, not a bare quantity
    // update, so the opening balance is attributable and auditable.
    if (input.initialStock && input.initialStock > 0) {
      await insertStockMovement(
        {
          productId,
          type: "PURCHASE",
          quantityChange: input.initialStock,
          balanceAfter: input.initialStock,
          referenceType: "MANUAL",
          note: "Opening stock",
          createdById: adminId,
        },
        tx,
      );
      await updateProductRow(productId, { stockQuantity: input.initialStock }, tx);
    }

    return productId;
  });
}

export async function updateProduct(id: number, input: Partial<CreateProductInput>) {
  const existing = await findProductById(id);
  if (!existing || existing.deletedAt) throw new NotFoundError("Product");

  if (input.categoryId !== undefined) {
    const category = await findCategoryById(input.categoryId);
    if (!category) throw new NotFoundError("Category");
  }

  // compareAtPrice below price would advertise a permanent fake discount.
  if (input.compareAtPrice !== undefined && input.compareAtPrice !== null) {
    const newPrice = input.price ?? existing.price;
    if (input.compareAtPrice <= newPrice) {
      throw new Error("The compare-at price must be higher than the selling price");
    }
  }

  const values: Record<string, unknown> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.slug !== undefined && input.slug) values.slug = input.slug;
  if (input.categoryId !== undefined) values.categoryId = input.categoryId;
  if (input.sku !== undefined) values.sku = input.sku;
  if (input.shortDescription !== undefined) values.shortDescription = input.shortDescription ?? "";
  if (input.description !== undefined) values.description = input.description ?? "";
  if (input.unitLabel !== undefined) values.unitLabel = input.unitLabel;
  if (input.price !== undefined) values.price = input.price;
  if (input.compareAtPrice !== undefined) values.compareAtPrice = input.compareAtPrice;
  if (input.lowStockThreshold !== undefined) values.lowStockThreshold = input.lowStockThreshold;
  if (input.isActive !== undefined) values.isActive = input.isActive;
  if (input.isFeatured !== undefined) values.isFeatured = input.isFeatured;

  const row = await updateProductRow(id, values);
  const decorated = await decorateOne(row);
  return adminProductItem(decorated);
}

export async function setProductActive(id: number, isActive: boolean) {
  const existing = await findProductById(id);
  if (!existing || existing.deletedAt) throw new NotFoundError("Product");
  const row = await updateProductRow(id, { isActive });
  return { id: row.id, isActive: row.isActive, name: row.name };
}

export async function setProductFeatured(id: number, isFeatured: boolean) {
  const existing = await findProductById(id);
  if (!existing || existing.deletedAt) throw new NotFoundError("Product");
  const row = await updateProductRow(id, { isFeatured });
  return { id: row.id, isFeatured: row.isFeatured, name: row.name };
}

/**
 * Soft delete. Order history stays intact because order_items snapshots product
 * identity rather than depending on this row continuing to exist.
 */
export async function deleteProduct(id: number) {
  const existing = await findProductById(id);
  if (!existing || existing.deletedAt) throw new NotFoundError("Product");

  await transaction(async (tx) => {
    await updateProductRow(id, { deletedAt: new Date(), isActive: false }, tx);
    await deleteCartItemsForProduct(id, tx);
  });
}

/* --------------------------------- images -------------------------------- */

export async function addProductImage(
  productId: number,
  input: { url: string; altText?: string | null; isPrimary?: boolean; sortOrder?: number },
) {
  const product = await findProductById(productId);
  if (!product || product.deletedAt) throw new NotFoundError("Product");

  return transaction(async (tx) => {
    if (input.isPrimary) {
      await clearPrimaryImages(productId, tx);
    }
    return insertProductImage(
      {
        productId,
        url: input.url,
        altText: input.altText ?? "",
        isPrimary: input.isPrimary ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
      tx,
    );
  });
}

export async function deleteProductImage(imageId: number) {
  const image = await findProductImage(imageId);
  if (!image) throw new NotFoundError("Image");

  await transaction(async (tx) => {
    await deleteProductImageRow(imageId, tx);

    // Never leave a product with no primary image if the deleted one was it.
    if (image.isPrimary) {
      const next = await findFirstProductImage(image.productId, tx);
      if (next) {
        await setPrimaryImage(next.id, tx);
      }
    }
  });
}

export async function reorderProductImages(productId: number, orderedIds: number[]) {
  await transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await updateImageOrder(id, productId, index, index === 0, tx);
    }
  });
}

export type { Tx };
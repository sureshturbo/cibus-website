import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@cibus/shared";

/**
 * Admin query schemas. Kept separate from the shared package because these
 * shapes are internal API surface, not part of the contract the clients import.
 */

export const adminPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export const productQuerySchema = adminPaginationSchema.extend({
  categoryId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["all", "active", "inactive", "low_stock", "out_of_stock"]).default("all"),
  sort: z.enum(["newest", "price_asc", "price_desc", "name_asc", "name_desc"]).default("newest"),
  featured: z.enum(["true", "false"]).optional(),
});

export const ledgerQuerySchema = adminPaginationSchema.extend({
  productId: z.coerce.number().int().positive(),
  type: z.enum(["PURCHASE", "SALE", "ADJUSTMENT", "RETURN", "DAMAGE"]).optional(),
});

export const offerQuerySchema = adminPaginationSchema.extend({
  status: z.enum(["all", "active", "scheduled", "expired"]).default("all"),
  search: z.string().trim().max(120).optional(),
});

export const customerQuerySchema = adminPaginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
});

export const enquiryQuerySchema = adminPaginationSchema.extend({
  status: z.enum(["all", "NEW", "CONTACTED", "CLOSED"]).default("all"),
});

export const salesSeriesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export const topProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(8),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * Route params arrive as strings, so the id is coerced. This must stay an object
 * schema: `validate(schema, "params")` parses the whole params object, and a bare
 * z.coerce.number() tried to coerce that object itself into NaN, which failed
 * every admin route carrying an :id.
 */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const activeToggleSchema = z.object({
  isActive: z.boolean(),
});

export const imageReorderSchema = z.object({
  orderedIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
});

export const enquiryNotesSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CLOSED"]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const invoiceQuerySchema = adminPaginationSchema.extend({
  customerId: z.coerce.number().int().positive().optional(),
  orderId: z.coerce.number().int().positive().optional(),
  status: z.enum(["DRAFT", "ISSUED", "PAID", "VOID"]).optional(),
});

export const csvExportQuerySchema = z.object({
  status: z.string().trim().max(24).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
});

export { DEFAULT_PAGE_SIZE };
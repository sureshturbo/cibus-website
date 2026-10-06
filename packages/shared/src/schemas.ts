import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  INVOICE_STATUSES,
  MAX_PAGE_SIZE,
  OFFER_SCOPES,
  OFFER_TYPES,
  ORDER_STATUSES,
  STOCK_MOVEMENT_TYPES,
} from "./domain.js";

/* ------------------------------ primitives ------------------------------- */

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters");

export const nameSchema = z.string().trim().min(2).max(120);

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(24)
  .regex(/^[0-9+\-\s()]+$/, "Enter a valid phone number");

export const idParamSchema = z.coerce.number().int().positive();

/** Money arrives from clients as a major-unit decimal string, e.g. "249.00". */
export const amountInputSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals"));

export const quantitySchema = z.coerce
  .number()
  .int("Quantity must be a whole number")
  .min(1, "Quantity must be at least 1")
  .max(10_000, "Quantity is too large");

export const booleanishSchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/* -------------------------------- address -------------------------------- */

export const addressSchema = z.object({
  fullName: nameSchema,
  phone: phoneSchema,
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(3).max(12),
  landmark: z.string().trim().max(200).optional().or(z.literal("")),
});

export type AddressInput = z.infer<typeof addressSchema>;

/* ------------------------------- customers ------------------------------- */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: nameSchema,
  phone: phoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

export const updateProfileSchema = z.object({
  fullName: nameSchema.optional(),
  phone: phoneSchema.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const addressBookEntrySchema = addressSchema.extend({
  label: z.string().trim().min(1).max(40).default("Default"),
  isDefault: z.boolean().default(false),
});

/* --------------------------------- admin --------------------------------- */

export const adminLoginSchema = loginSchema;
export const adminCreateSchema = registerSchema.extend({
  isActive: z.boolean().default(true),
});

/* ------------------------------- categories ------------------------------ */

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/* -------------------------------- products ------------------------------- */

export const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: slugSchema.optional(),
  categoryId: z.coerce.number().int().positive(),
  sku: z.string().trim().min(2).max(64),
  shortDescription: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(20000).optional().or(z.literal("")),
  unitLabel: z.string().trim().max(32).default("unit"),
  price: amountInputSchema,
  compareAtPrice: amountInputSchema.optional().or(z.literal("")),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000).default(5),
  initialStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  slug: slugSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  sku: z.string().trim().min(2).max(64).optional(),
  shortDescription: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(20000).optional().or(z.literal("")),
  unitLabel: z.string().trim().max(32).optional(),
  price: amountInputSchema.optional(),
  compareAtPrice: amountInputSchema.optional().or(z.literal("")),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

export const productImageSchema = z.object({
  url: z.string().trim().min(1).max(500),
  altText: z.string().trim().max(200).optional().or(z.literal("")),
  isPrimary: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

/* --------------------------------- stock --------------------------------- */

export const stockAdjustmentSchema = z.object({
  productId: z.coerce.number().int().positive("Select a product"),
  quantityChange: z.coerce
    .number()
    .int("Quantity change must be a whole number")
    .min(-1_000_000, "Adjustment is too large")
    .max(1_000_000, "Adjustment is too large")
    .refine((v) => v !== 0, "Quantity change cannot be zero"),
  type: z.enum(STOCK_MOVEMENT_TYPES).default("ADJUSTMENT"),
  referenceType: z.enum(["MANUAL", "SUPPLIER"]).default("MANUAL"),
  /** Free-text supplier or document reference, e.g. an invoice number. */
  referenceId: z.string().trim().max(64).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

/* -------------------------------- invoices ------------------------------- */

export const invoiceStatusUpdateSchema = z.object({
  status: z.enum(INVOICE_STATUSES, {
    errorMap: () => ({ message: "Unknown invoice status" }),
  }),
  /** Required when voiding so the audit trail explains why. */
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

/* --------------------------------- offers -------------------------------- */

export const offerCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, "Code may contain letters, numbers, hyphens and underscores")
      .optional()
      .or(z.literal("")),
    type: z.enum(OFFER_TYPES),
    /**
     * For PERCENTAGE this is a percent figure: 12.5 means 12.5%.
     * For FIXED_AMOUNT this is a currency figure: "250.00" means 250.
     * Both are converted to integer storage by the API (basis points and paise
     * respectively) so no float ever reaches the database.
     */
    value: amountInputSchema,
    scope: z.enum(OFFER_SCOPES),
    categoryId: z.coerce.number().int().positive().nullable().optional(),
    productId: z.coerce.number().int().positive().nullable().optional(),
    minOrderAmount: amountInputSchema.optional().or(z.literal("")),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.endsAt.getTime() <= data.startsAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End date must be after the start date",
      });
    }
    if (data.scope === "CATEGORY" && !data.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryId"],
        message: "Select a category for a category-scoped offer",
      });
    }
    if (data.scope === "PRODUCT" && !data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productId"],
        message: "Select a product for a product-scoped offer",
      });
    }
    if (data.type === "PERCENTAGE" && Number(data.value) > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "A percentage discount cannot exceed 100",
      });
    }
  });

export const offerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
});

/* ---------------------------------- cart --------------------------------- */

export const cartAddSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: quantitySchema.default(1),
});

export const cartUpdateSchema = z.object({
  quantity: quantitySchema,
});

export const cartRemoveSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

/* -------------------------------- checkout ------------------------------- */

export const checkoutSchema = z.object({
  email: emailSchema,
  fullName: nameSchema,
  phone: phoneSchema,
  fulfilmentMethod: z.enum(["DELIVERY", "PICKUP"]),
  address: addressSchema,
  deliveryNotes: z.string().trim().max(500).optional().or(z.literal("")),
  offerCode: z.string().trim().toUpperCase().max(40).optional().or(z.literal("")),
  idempotencyKey: z.string().trim().min(8).max(100),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/* ------------------------------- orders ---------------------------------- */

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const customerOrderQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const adminOrderQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/* ------------------------------ enquiries -------------------------------- */

export const partnerEnquirySchema = z.object({
  name: nameSchema,
  businessName: z.string().trim().min(2).max(160),
  email: emailSchema,
  phone: phoneSchema,
  message: z.string().trim().min(10, "Tell us a little more").max(4000),
});

export const enquiryUpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CLOSED"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/* ------------------------------ storefront ------------------------------- */

export const productListQuerySchema = paginationSchema.extend({
  category: slugSchema.optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "name_asc", "name_desc"]).default("newest"),
  inStock: booleanishSchema.optional(),
  featured: booleanishSchema.optional(),
});

/* ------------------------------- invoicing ------------------------------- */

export const invoiceQuerySchema = paginationSchema.extend({
  status: z.enum(["DRAFT", "ISSUED", "PAID", "VOID"]).optional(),
});

/* --------------------------------- misc ---------------------------------- */

export const idListSchema = z.array(z.coerce.number().int().positive()).min(1).max(50);

export const uploadMetadataSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
});
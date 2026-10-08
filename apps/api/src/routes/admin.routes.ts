import { Router } from "express";
import { paginate, toMinor } from "@cibus/shared";
import {
  adminPaginationSchema,
  activeToggleSchema,
  customerQuerySchema,
  enquiryNotesSchema,
  enquiryQuerySchema,
  idParamSchema,
  imageReorderSchema,
  invoiceQuerySchema,
  ledgerQuerySchema,
  offerQuerySchema,
  productQuerySchema,
  salesSeriesQuerySchema,
  topProductsQuerySchema,
} from "../schemas/admin.js";
import { requireAdmin } from "../middleware/auth.js";
import { sendOk, validate, validatedQuery } from "../lib/http.js";
import { controller, param } from "../lib/controller.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { currentAdminId } from "../middleware/auth.js";
import {
  addProductImage,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  deleteProductImage,
  getCategoryById,
  getProductById,
  listCategories,
  listProducts,
  reorderProductImages,
  setProductActive,
  setProductFeatured,
  updateCategory,
  updateProduct,
} from "../services/product.service.js";
import { adjustStock, listStockMovements, findLowStockProducts } from "../services/stock.service.js";
import { createOffer, getOfferById, listOffers, setOfferActive, updateOffer } from "../services/offer.service.js";
import { getCustomerById, listCustomers, setCustomerActive } from "../services/customer.service.js";
import { countEnquiries, findEnquiryById, listEnquiryRows, updateEnquiry } from "../db/repositories/enquiry.repo.js";
import {
  changeOrderStatus,
  getOrderById,
  listOrders,
  ORDER_STATUS_TRANSITIONS,
} from "../services/order.service.js";
import { getDashboardSummary, getSalesSeries, getTopProducts } from "../services/dashboard.service.js";
import {
  buildInvoiceView,
  getInvoiceById,
  getInvoiceByOrderId,
  listInvoices,
  ordersToCsv,
  setInvoiceStatus,
} from "../services/invoice.service.js";
import { renderInvoiceHtml } from "../templates/invoice.js";
import { storeProductImage, uploadImage } from "../lib/storage.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  invoiceStatusUpdateSchema,
  offerCreateSchema,
  offerUpdateSchema,
  orderStatusUpdateSchema,
  productCreateSchema,
  productImageSchema,
  productUpdateSchema,
  stockAdjustmentSchema,
} from "@cibus/shared";
import type { z } from "zod";

/**
 * Admin API.
 *
 * Every route below sits behind `requireAdmin`, which validates an admin-audience
 * token and re-checks that the account is active. Because this router is mounted
 * as one unit, a new endpoint added here is protected by default - a new endpoint
 * that forgets its own guard is the failure mode worth designing against.
 */
export const adminRouter = Router();

adminRouter.use(requireAdmin);

/* ================================ dashboard ============================== */

adminRouter.get(
  "/dashboard",
  controller(async (_req, res) => {
    sendOk(res, await getDashboardSummary());
  }),
);

adminRouter.get(
  "/dashboard/sales-series",
  validate(salesSeriesQuerySchema, "query"),
  controller(async (req, res) => {
    const { days } = validatedQuery<z.infer<typeof salesSeriesQuerySchema>>(req);
    sendOk(res, await getSalesSeries(days));
  }),
);

adminRouter.get(
  "/dashboard/top-products",
  validate(topProductsQuerySchema, "query"),
  controller(async (req, res) => {
    const { limit, days } = validatedQuery<z.infer<typeof topProductsQuerySchema>>(req);
    sendOk(res, { products: await getTopProducts(limit, days), days });
  }),
);

/* =============================== categories ============================== */

adminRouter.get(
  "/categories",
  controller(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    sendOk(res, { categories: await listCategories({ includeInactive, tree: true }) });
  }),
);

adminRouter.post(
  "/categories",
  validate(categoryCreateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof categoryCreateSchema>;
    sendOk(res, { category: await createCategory(body) }, 201);
  }),
);

adminRouter.get(
  "/categories/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { category: await getCategoryById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/categories/:id",
  validate(idParamSchema, "params"),
  validate(categoryUpdateSchema),
  controller(async (req, res) => {
    const id = param(req, "id");
    try {
      sendOk(res, { category: await updateCategory(id, req.body as never) });
    } catch (error) {
      if (error instanceof Error && error.message.includes("descendants")) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  }),
);

adminRouter.delete(
  "/categories/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    const id = param(req, "id");
    try {
      await deleteCategory(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("still")) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
    sendOk(res, { deleted: true });
  }),
);

/* ================================ products =============================== */

adminRouter.get(
  "/products",
  validate(productQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof productQuerySchema>>(req);
    sendOk(res, await listProducts({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
      sort: query.sort,
      featured: query.featured === undefined ? undefined : query.featured === "true",
      categoryId: query.categoryId,
    }));
  }),
);

adminRouter.get(
  "/products/low-stock",
  controller(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    sendOk(res, { products: await findLowStockProducts(limit) });
  }),
);

adminRouter.post(
  "/products",
  validate(productCreateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof productCreateSchema>;
    const id = await createProduct(
      {
        ...body,
        price: toMinor(body.price),
        compareAtPrice: body.compareAtPrice ? toMinor(body.compareAtPrice) : null,
      },
      currentAdminId(req),
    );
    sendOk(res, { product: await getProductById(id) }, 201);
  }),
);

adminRouter.get(
  "/products/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { product: await getProductById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/products/:id",
  validate(idParamSchema, "params"),
  validate(productUpdateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof productUpdateSchema>;

    // The schema accepts "249.00" for a money field; the service speaks paise.
    // Destructuring keeps the raw strings out of the typed input.
    const { price, compareAtPrice, ...rest } = body;

    try {
      const product = await updateProduct(param(req, "id"), {
        ...rest,
        ...(price !== undefined ? { price: toMinor(price) } : {}),
        ...(compareAtPrice !== undefined
          ? { compareAtPrice: compareAtPrice ? toMinor(compareAtPrice) : null }
          : {}),
      });
      sendOk(res, { product });
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (error instanceof Error && error.message.includes("compare-at")) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  }),
);

adminRouter.patch(
  "/products/:id/active",
  validate(idParamSchema, "params"),
  validate(activeToggleSchema),
  controller(async (req, res) => {
    const { isActive } = req.body as z.infer<typeof activeToggleSchema>;
    sendOk(res, { product: await setProductActive(param(req, "id"), isActive) });
  }),
);

adminRouter.patch(
  "/products/:id/featured",
  validate(idParamSchema, "params"),
  validate(activeToggleSchema),
  controller(async (req, res) => {
    const { isActive: isFeatured } = req.body as { isActive: boolean };
    sendOk(res, { product: await setProductFeatured(param(req, "id"), isFeatured) });
  }),
);

adminRouter.delete(
  "/products/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    await deleteProduct(param(req, "id"));
    sendOk(res, { deleted: true });
  }),
);

/* ============================== product images =========================== */

adminRouter.post(
  "/products/:id/images",
  uploadLimiter,
  uploadImage.single("file"),
  controller(async (req, res) => {
    if (!req.file) throw new ValidationError("Choose an image to upload");
    const stored = await storeProductImage(req.file);
    const altText = typeof req.body?.altText === "string" ? req.body.altText : "";
    const image = await addProductImage(param(req, "id"), { url: stored.url, altText });
    sendOk(res, { image: { ...image, width: stored.width, height: stored.height, bytes: stored.bytes } }, 201);
  }),
);

adminRouter.post(
  "/products/:id/images/link",
  validate(idParamSchema, "params"),
  validate(productImageSchema),
  controller(async (req, res) => {
    const image = await addProductImage(param(req, "id"), req.body as z.infer<typeof productImageSchema>);
    sendOk(res, { image }, 201);
  }),
);

adminRouter.post(
  "/products/:id/images/reorder",
  validate(idParamSchema, "params"),
  validate(imageReorderSchema),
  controller(async (req, res) => {
    await reorderProductImages(param(req, "id"), (req.body as z.infer<typeof imageReorderSchema>).orderedIds);
    sendOk(res, { reordered: true });
  }),
);

adminRouter.delete(
  "/images/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    await deleteProductImage(param(req, "id"));
    sendOk(res, { deleted: true });
  }),
);

/* ================================== stock ================================ */

adminRouter.post(
  "/stock/adjust",
  validate(stockAdjustmentSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof stockAdjustmentSchema>;
    try {
      const result = await adjustStock(
        {
          productId: body.productId,
          quantityChange: body.quantityChange,
          type: body.type as "PURCHASE" | "ADJUSTMENT" | "RETURN" | "DAMAGE",
          referenceType: body.referenceType as "MANUAL" | "SUPPLIER",
          referenceId: body.referenceId || null,
          note: body.note ?? "",
        },
        currentAdminId(req),
      );
      sendOk(res, result);
    } catch (error) {
      // Stock conflicts are a retryable condition, not a validation failure, so
      // they surface as 409 with a message the admin can act on.
      if (error instanceof Error && error.name === "StockConflictError") {
        throw new ConflictError(error.message);
      }
      throw error;
    }
  }),
);

adminRouter.get(
  "/stock/movements",
  validate(ledgerQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof ledgerQuerySchema>>(req);
    sendOk(res, await listStockMovements({
      productId: query.productId,
      page: query.page,
      pageSize: query.pageSize,
      type: query.type,
    }));
  }),
);

/* ================================= offers ================================ */

adminRouter.get(
  "/offers",
  validate(offerQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof offerQuerySchema>>(req);
    sendOk(res, await listOffers({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      search: query.search,
    }));
  }),
);

adminRouter.post(
  "/offers",
  validate(offerCreateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof offerCreateSchema>;
    try {
      const offer = await createOffer(body as never);
      sendOk(res, { offer }, 201);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw error;
    }
  }),
);

adminRouter.get(
  "/offers/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { offer: await getOfferById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/offers/:id",
  validate(idParamSchema, "params"),
  validate(offerUpdateSchema),
  controller(async (req, res) => {
    const id = param(req, "id");
    const body = req.body as z.infer<typeof offerUpdateSchema>;
    const existing = await getOfferById(id);

    // Validate the window against whichever bound is not being changed, so a
    // partial update cannot produce end <= start.
    const effectiveStart = body.startsAt ?? existing.startsAt;
    const effectiveEnd = body.endsAt ?? existing.endsAt;
    if (effectiveEnd <= effectiveStart) {
      throw new ValidationError("End date must be after the start date");
    }

    const offer = await updateOffer(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
      ...(body.usageLimit !== undefined ? { usageLimit: body.usageLimit } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });

    sendOk(res, { offer });
  }),
);

adminRouter.patch(
  "/offers/:id/active",
  validate(idParamSchema, "params"),
  validate(activeToggleSchema),
  controller(async (req, res) => {
    const { isActive } = req.body as z.infer<typeof activeToggleSchema>;
    sendOk(res, { offer: await setOfferActive(param(req, "id"), isActive) });
  }),
);

/* ================================= orders ================================ */

adminRouter.get(
  "/orders",
  validate(adminPaginationSchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof adminPaginationSchema>>(req);
    const status = req.query.status as never;
    sendOk(
      res,
      await listOrders({
        page: query.page,
        pageSize: query.pageSize,
        status: Object.keys(ORDER_STATUS_TRANSITIONS).includes(String(status)) ? status : undefined,
        search: (req.query.search as string) || undefined,
        from: req.query.from ? new Date(String(req.query.from)) : undefined,
        to: req.query.to ? new Date(String(req.query.to)) : undefined,
      }),
    );
  }),
);

adminRouter.get(
  "/orders/export.csv",
  controller(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 1000), 10_000);
    const { items } = await listOrders({
      page: 1,
      pageSize: limit,
      status: (req.query.status as never) || undefined,
      from: req.query.from ? new Date(String(req.query.from)) : undefined,
      to: req.query.to ? new Date(String(req.query.to)) : undefined,
    });

    const csv = ordersToCsv(
      items as Parameters<typeof ordersToCsv>[0],
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cibus-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }),
);

adminRouter.get(
  "/orders/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { order: await getOrderById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/orders/:id/status",
  validate(idParamSchema, "params"),
  validate(orderStatusUpdateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof orderStatusUpdateSchema>;
    const result = await changeOrderStatus(param(req, "id"), body.status, {
      note: body.note ?? "",
      changedBy: `admin:${currentAdminId(req)}`,
    });
    sendOk(res, result);
  }),
);

/* ================================ invoices =============================== */

adminRouter.get(
  "/invoices",
  validate(invoiceQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof invoiceQuerySchema>>(req);
    sendOk(res, await listInvoices({
      page: query.page,
      pageSize: query.pageSize,
      customerId: query.customerId,
      orderId: query.orderId,
      status: query.status,
    }));
  }),
);

adminRouter.get(
  "/invoices/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { invoice: await getInvoiceById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/invoices/:id/status",
  validate(idParamSchema, "params"),
  validate(invoiceStatusUpdateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof invoiceStatusUpdateSchema>;
    sendOk(res, {
      invoice: await setInvoiceStatus(param(req, "id"), body.status, body.reason || undefined),
    });
  }),
);

adminRouter.get(
  "/invoices/:id/view",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    const invoice = await getInvoiceById(param(req, "id"));
    res.type("text/html").send(renderInvoiceHtml(buildInvoiceView(invoice)));
  }),
);

/** Browser-printable invoice. Same snapshots as the download route. */
adminRouter.get(
  "/orders/:id/invoice",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    const orderId = param(req, "id");
    const order = await getOrderById(orderId);
    const invoice = await getInvoiceByOrderId(orderId);
    sendOk(res, { order, invoice });
  }),
);

/* =============================== customers =============================== */

adminRouter.get(
  "/customers",
  validate(customerQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof customerQuerySchema>>(req);
    sendOk(res, await listCustomers({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
    }));
  }),
);

adminRouter.get(
  "/customers/:id",
  validate(idParamSchema, "params"),
  controller(async (req, res) => {
    sendOk(res, { customer: await getCustomerById(param(req, "id")) });
  }),
);

adminRouter.patch(
  "/customers/:id/active",
  validate(idParamSchema, "params"),
  validate(activeToggleSchema),
  controller(async (req, res) => {
    const { isActive } = req.body as z.infer<typeof activeToggleSchema>;
    sendOk(res, { customer: await setCustomerActive(param(req, "id"), isActive) });
  }),
);

/* =============================== enquiries =============================== */

adminRouter.get(
  "/enquiries",
  validate(enquiryQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof enquiryQuerySchema>>(req);
    const status = query.status === "all" ? undefined : query.status;
    const offset = (query.page - 1) * query.pageSize;
    const [total, rows] = await Promise.all([
      countEnquiries(status),
      listEnquiryRows(status, query.pageSize, offset),
    ]);
    sendOk(res, paginate(rows, total, query.page, query.pageSize));
  }),
);

adminRouter.patch(
  "/enquiries/:id",
  validate(idParamSchema, "params"),
  validate(enquiryNotesSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof enquiryNotesSchema>;
    const id = param(req, "id");
    const existing = await findEnquiryById(id);
    if (!existing) throw new NotFoundError("Enquiry");

    const enquiry = await updateEnquiry(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    sendOk(res, { enquiry });
  }),
);
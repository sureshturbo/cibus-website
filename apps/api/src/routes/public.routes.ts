import { Router } from "express";
import { productListQuerySchema, slugSchema } from "@cibus/shared";
import { z } from "zod";
import { COMPANY_INFO, HOME_CONTENT, STATIC_PAGES } from "../content/site.js";
import { env } from "../config/env.js";
import { controller, stringParam } from "../lib/controller.js";
import { NotFoundError } from "../lib/errors.js";
import { sendOk, validate, validatedQuery } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { getPublicProductBySlug, listPublicProducts } from "../services/product.service.js";

export const publicRouter = Router();

/* --------------------------------- home ---------------------------------- */

publicRouter.get(
  "/home",
  controller(async (_req, res) => {
    const [featured, newest] = await Promise.all([
      listPublicProducts({ featured: true, page: 1, pageSize: 8, sort: "newest" }),
      listPublicProducts({ page: 1, pageSize: 4, sort: "newest" }),
    ]);

    sendOk(res, {
      company: COMPANY_INFO,
      hero: HOME_CONTENT.hero,
      highlights: HOME_CONTENT.highlights,
      categoriesBlurb: HOME_CONTENT.categoriesBlurb,
      featuredProducts: featured.items,
      newestProducts: newest.items,
      pages: Object.values(STATIC_PAGES).map((page) => ({
        slug: page.slug,
        title: page.title,
        subtitle: page.subtitle ?? null,
      })),
    });
  }),
);

/* ------------------------------ static pages ----------------------------- */

const pageSlugParamsSchema = z.object({ slug: slugSchema });

publicRouter.get(
  "/pages/:slug",
  validate(pageSlugParamsSchema, "params"),
  controller(async (req, res) => {
    const slug = stringParam(req, "slug");
    const page = Object.values(STATIC_PAGES).find((entry) => entry.slug === slug);
    // A missing content page is a client error, not a hole in the API: the
    // envelope stays uniform so the storefront can render a proper 404.
    if (!page) throw new NotFoundError("Page");
    sendOk(res, { company: COMPANY_INFO, page });
  }),
);

/* ------------------------------- categories ------------------------------ */

/**
 * Top-level categories with live product counts.
 *
 * Only active, non-deleted products are counted: a category badge promising 12
 * products that resolve to 4 is worse than showing none.
 */
publicRouter.get(
  "/categories",
  controller(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        _count: { select: { products: { where: { isActive: true, deletedAt: null } } } },
      },
    });

    sendOk(res, {
      categories: categories.map(({ _count, ...category }) => ({
        ...category,
        productCount: _count.products,
      })),
    });
  }),
);

/* ------------------------------ product list ----------------------------- */

publicRouter.get(
  "/products",
  validate(productListQuerySchema, "query"),
  controller(async (req, res) => {
    const { category, ...rest } = validatedQuery<z.infer<typeof productListQuerySchema>>(req);
    // The shared schema exposes the filter as `category`; the service narrows on
    // `categorySlug`. Passing the query through untouched silently drops the
    // filter and returns the whole catalogue.
    const result = await listPublicProducts({ ...rest, categorySlug: category });
    sendOk(res, result.items, 200, result.meta);
  }),
);

/* ---------------------------- product details ---------------------------- */

const productSlugParamsSchema = z.object({ slug: slugSchema });

publicRouter.get(
  "/products/:slug",
  validate(productSlugParamsSchema, "params"),
  controller(async (req, res) => {
    const product = await getPublicProductBySlug(stringParam(req, "slug"));
    if (!product) throw new NotFoundError("Product");
    sendOk(res, { product });
  }),
);

/* ------------------------------ site config ------------------------------ */

/**
 * Everything the storefront needs to know about this deployment.
 *
 * `paymentEnabled` is hard-coded false because online payment is out of scope.
 * The client must branch on this flag rather than assume a payment step exists,
 * so it lives in the API config instead of being duplicated in the client.
 */
publicRouter.get(
  "/config",
  controller(async (_req, res) => {
    sendOk(res, {
      company: COMPANY_INFO,
      currency: env.CURRENCY,
      paymentEnabled: false,
      paymentNotice:
        "Online payment is not yet available. Our team reviews each order and will contact you to confirm it and arrange payment.",
      offerCodesEnabled: env.OFFER_CODES_ENABLED,
      guestCheckoutEnabled: env.GUEST_CHECKOUT_ENABLED,
      maxQuantityPerLine: env.MAX_QUANTITY_PER_LINE,
    });
  }),
);
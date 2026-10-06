import { Router } from "express";
import type { Request, Response } from "express";
import {
  cartAddSchema,
  cartRemoveSchema,
  cartUpdateSchema,
  checkoutSchema,
  customerOrderQuerySchema,
} from "@cibus/shared";
import { CART_COOKIE, CART_COOKIE_OPTIONS } from "../lib/authCookies.js";
import { controller, param } from "../lib/controller.js";
import { sendOk, validate, validatedQuery } from "../lib/http.js";
import { optionalCustomer, requireCustomer } from "../middleware/auth.js";
import { checkoutLimiter } from "../middleware/rateLimit.js";
import { z } from "zod";
import {
  addToCart,
  clearCart,
  getCart,
  mergeGuestCart,
  previewCart,
  removeFromCart,
  resolveCart,
  updateCartQuantity,
} from "../services/cart.service.js";
import { getOrderById, listOrders, placeOrder } from "../services/order.service.js";
import { buildInvoiceView, getInvoiceByOrderId } from "../services/invoice.service.js";
import { renderInvoiceHtml } from "../templates/invoice.js";

/**
 * Customer commerce routes.
 *
 * Guest carts are keyed by an opaque, signed-in-cookie token; signed-in carts by
 * customer id. Both funnel into the same table, so the pricing rules downstream
 * cannot diverge between the two.
 */
export const shopRouter = Router();

/** Read the guest cart cookie, if present. */
function guestToken(req: Request): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[CART_COOKIE];
  return typeof value === "string" && value.length >= 8 && value.length <= 64 ? value : undefined;
}

/**
 * Resolve which cart this request should use, setting the guest cookie when a
 * new anonymous cart is created.
 */
async function resolveRequestCart(req: Request, res: Response): Promise<{ cartId: number }> {
  const customerId: number | undefined = req.auth?.id;
  const token = guestToken(req);

  const cart = await resolveCart(
    customerId ? { customerId } : token ? { guestToken: token } : {},
  );

  if (cart.token && !token) {
    res.cookie(CART_COOKIE, cart.token, CART_COOKIE_OPTIONS);
  }

  return cart;
}

/* ================================== cart ================================= */

shopRouter.get(
  "/cart",
  optionalCustomer,
  controller(async (req, res) => {
    const cart = await resolveRequestCart(req, res);
    sendOk(res, await getCart(cart.cartId));
  }),
);

shopRouter.get(
  "/cart/preview",
  optionalCustomer,
  controller(async (req, res) => {
    const cart = await resolveRequestCart(req, res);
    const offerCode = typeof req.query.offerCode === "string" ? req.query.offerCode : undefined;
    sendOk(res, await previewCart(cart.cartId, offerCode));
  }),
);

shopRouter.post(
  "/cart/items",
  optionalCustomer,
  validate(cartAddSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof cartAddSchema>;
    const cart = await resolveRequestCart(req, res);
    sendOk(res, await addToCart(cart.cartId, body.productId, body.quantity ?? 1));
  }),
);

shopRouter.patch(
  "/cart/items/:productId",
  optionalCustomer,
  validate(cartUpdateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof cartUpdateSchema>;
    const cart = await resolveRequestCart(req, res);
    sendOk(res, await updateCartQuantity(cart.cartId, param(req, "productId"), body.quantity));
  }),
);

shopRouter.delete(
  "/cart/items/:productId",
  optionalCustomer,
  validate(cartRemoveSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof cartRemoveSchema>;
    const cart = await resolveRequestCart(req, res);
    sendOk(res, await removeFromCart(cart.cartId, body.productId));
  }),
);

shopRouter.delete(
  "/cart",
  optionalCustomer,
  controller(async (req, res) => {
    const cart = await resolveRequestCart(req, res);
    sendOk(res, await clearCart(cart.cartId));
  }),
);

/**
 * Called by the client after a successful sign-in so a guest basket survives
 * becoming an account.
 */
shopRouter.post(
  "/cart/merge",
  requireCustomer,
  controller(async (req, res) => {
    const token = guestToken(req);
    if (token) {
      await mergeGuestCart(token, req.auth!.id);
      res.clearCookie(CART_COOKIE, { path: CART_COOKIE_OPTIONS.path });
    }
    const cart = await resolveCart({ customerId: req.auth!.id });
    sendOk(res, await getCart(cart.cartId));
  }),
);

/* ================================ checkout =============================== */

shopRouter.post(
  "/checkout",
  checkoutLimiter,
  requireCustomer,
  validate(checkoutSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof checkoutSchema>;

    // The command carries only identities and contact details. Prices, stock and
    // discounts are recomputed inside the checkout transaction.
    const result = await placeOrder({
      customerId: req.auth!.id,
      email: body.email,
      fullName: body.fullName,
      phone: body.phone,
      fulfilmentMethod: body.fulfilmentMethod,
      address: {
        fullName: body.address.fullName,
        phone: body.address.phone,
        line1: body.address.line1,
        line2: body.address.line2,
        city: body.address.city,
        state: body.address.state,
        postalCode: body.address.postalCode,
        landmark: body.address.landmark,
      },
      deliveryNotes: body.deliveryNotes,
      offerCode: body.offerCode || null,
      idempotencyKey: body.idempotencyKey,
    });

    sendOk(res, result, 201);
  }),
);

/**
 * Checkout summary before committing. Prices are recomputed server-side, but
 * nothing is written, so calling it repeatedly is free of consequence.
 */
shopRouter.post(
  "/checkout/preview",
  optionalCustomer,
  validate(checkoutSchema.partial({ idempotencyKey: true })),
  controller(async (req, res) => {
    const cart = await resolveRequestCart(req, res);
    const body = req.body as { offerCode?: string };
    const preview = await previewCart(cart.cartId, body.offerCode);
    sendOk(res, preview);
  }),
);

/* ================================ orders ================================= */

shopRouter.get(
  "/orders",
  requireCustomer,
  validate(customerOrderQuerySchema, "query"),
  controller(async (req, res) => {
    const query = validatedQuery<z.infer<typeof customerOrderQuerySchema>>(req);
    sendOk(
      res,
      await listOrders({
        page: query.page,
        pageSize: query.pageSize,
        customerId: req.auth!.id,
        status: query.status,
      }),
    );
  }),
);

shopRouter.get(
  "/orders/:id",
  requireCustomer,
  controller(async (req, res) => {
    // Scoping by customerId means one customer cannot read another's order by
    // guessing an id.
    const order = await getOrderById(param(req, "id"), { customerId: req.auth!.id });
    sendOk(res, { order });
  }),
);

shopRouter.get(
  "/orders/:id/invoice",
  requireCustomer,
  controller(async (req, res) => {
    const orderId = param(req, "id");

    // Confirm ownership before rendering anything.
    const order = await getOrderById(orderId, { customerId: req.auth!.id });
    const invoice = await getInvoiceByOrderId(order.id, { customerId: req.auth!.id });

    res.type("text/html").send(renderInvoiceHtml(buildInvoiceView(invoice)));
  }),
);

/** Confirmation screen data for a freshly placed order. */
shopRouter.get(
  "/order-confirmation/:id",
  requireCustomer,
  controller(async (req, res) => {
    const order = await getOrderById(param(req, "id"), { customerId: req.auth!.id });
    sendOk(res, {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        placedAt: order.createdAt,
        subtotal: order.subtotal,
        discountTotal: order.discountTotal,
        total: order.total,
        paymentRequired: false,
        notice:
          "Order received. Online payment is not yet available, so our team will contact you to confirm and arrange payment.",
        items: order.items,
        address: {
          line1: order.addressLine1,
          line2: order.addressLine2,
          city: order.addressCity,
          state: order.addressState,
          postalCode: order.addressPostalCode,
        },
      },
      invoice: order.invoices[0] ?? null,
    });
  }),
);
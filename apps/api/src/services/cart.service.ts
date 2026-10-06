import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { multiplyMinor } from "@cibus/shared";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { priceCartItems } from "./pricing.service.js";
import { isPurchasable } from "./selects.js";

/** Either the root client or an interactive transaction, which share a shape. */
type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Cart service.
 *
 * A cart stores product identity and quantity only. Every price shown here is
 * derived live from the catalogue, so a cart can never disagree with the
 * product page, and a price change between adding to cart and checking out is
 * reflected rather than silently honouring a stale figure.
 */

const GUEST_CART_TTL_DAYS = 30;
const MAX_LINES = 50;
const MAX_QUANTITY_PER_LINE = 100;

export interface CartToken {
  cartId: number;
  token?: string;
}

export async function resolveCart(
  identity: { customerId?: number; guestToken?: string },
  tx: DbClient = prisma,
): Promise<CartToken> {
  if (identity.customerId) {
    const existing = await tx.cart.findFirst({
      where: { customerId: identity.customerId },
      select: { id: true },
    });
    if (existing) return { cartId: existing.id };

    const created = await tx.cart.create({
      data: { customerId: identity.customerId },
      select: { id: true },
    });
    return { cartId: created.id };
  }

  if (identity.guestToken) {
    const existing = await tx.cart.findUnique({
      where: { token: identity.guestToken },
      select: { id: true, expiresAt: true },
    });
    if (existing && existing.expiresAt && existing.expiresAt > new Date()) {
      return { cartId: existing.id, token: identity.guestToken };
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + GUEST_CART_TTL_DAYS * 86_400_000);
  const created = await tx.cart.create({
    data: { token, expiresAt },
    select: { id: true },
  });
  return { cartId: created.id, token };
}

/** Fold a guest cart into the customer's cart on sign-in, then drop the guest row. */
export async function mergeGuestCart(guestToken: string, customerId: number): Promise<void> {
  const guest = await prisma.cart.findUnique({
    where: { token: guestToken },
    include: { items: true },
  });
  if (!guest) return;

  await prisma.$transaction(async (tx) => {
    if (guest.items.length > 0) {
      const customerCart = await resolveCart({ customerId }, tx);

      for (const item of guest.items) {
        await tx.cartItem.upsert({
          where: { cartId_productId: { cartId: customerCart.cartId, productId: item.productId } },
          create: { cartId: customerCart.cartId, productId: item.productId, quantity: item.quantity },
          // Take the larger quantity rather than summing: a guest who added 2
          // and an account holder who already had 2 should end up with 2.
          update: { quantity: Math.min(Math.max(item.quantity, 1), MAX_QUANTITY_PER_LINE) },
        });
      }
    }

    await tx.cart.delete({ where: { id: guest.id } });
  });
}

export interface CartLineView {
  productId: number;
  name: string;
  slug: string;
  sku: string;
  unitLabel: string;
  unitPrice: number;
  compareAtPrice: number | null;
  lineTotal: number;
  quantity: number;
  stockQuantity: number;
  purchasable: boolean;
  issue: string | null;
  image: { url: string; altText: string } | null;
  category: { name: string; slug: string } | null;
}

export interface CartView {
  items: CartLineView[];
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
  savings: number;
  hasUnavailableItems: boolean;
  allPurchasable: boolean;
  issues: string[];
}

export async function getCart(cartId: number): Promise<CartView> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              sku: true,
              unitLabel: true,
              price: true,
              compareAtPrice: true,
              stockQuantity: true,
              allowBackorder: true,
              isActive: true,
              deletedAt: true,
              category: { select: { name: true, slug: true } },
              images: {
                select: { url: true, altText: true, isPrimary: true, sortOrder: true },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });

  if (!cart) return emptyCart();

  const items: CartLineView[] = cart.items.map((item) => {
    const product = item.product;
    const gone = product.deletedAt !== null || !product.isActive;
    const purchasable = !gone && isPurchasable(product);
    const overStock = purchasable && !product.allowBackorder && item.quantity > product.stockQuantity;

    let issue: string | null = null;
    if (gone) issue = "This product is no longer available and has been removed from pricing.";
    else if (!purchasable) issue = "Out of stock. Remove it to continue.";
    else if (overStock) {
      issue = product.stockQuantity > 0
        ? `Only ${product.stockQuantity} left in stock. Reduce the quantity to continue.`
        : "This product is out of stock. Remove it to continue.";
    }

    const price = gone ? 0 : product.price;

    return {
      productId: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      unitLabel: product.unitLabel,
      unitPrice: price,
      compareAtPrice: gone ? null : product.compareAtPrice,
      lineTotal: multiplyMinor(price, item.quantity),
      quantity: item.quantity,
      stockQuantity: product.stockQuantity,
      purchasable,
      issue,
      image: product.images[0]
        ? { url: product.images[0].url, altText: product.images[0].altText || product.name }
        : null,
      category: product.category,
    };
  });

  // Unavailable lines contribute nothing to the subtotal, so the figure shown
  // always matches what could actually be ordered.
  const orderable = items.filter((line) => line.issue === null);

  return {
    items,
    itemCount: items.length,
    totalQuantity: items.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: orderable.reduce((sum, line) => sum + line.lineTotal, 0),
    savings: orderable.reduce((sum, line) => {
      if (line.compareAtPrice && line.compareAtPrice > line.unitPrice) {
        return sum + multiplyMinor(line.compareAtPrice - line.unitPrice, line.quantity);
      }
      return sum;
    }, 0),
    hasUnavailableItems: items.some((line) => line.issue !== null),
    allPurchasable: items.length > 0 && orderable.length === items.length,
    issues: items.map((line) => line.issue).filter((issue): issue is string => issue !== null),
  };
}

export function emptyCart(): CartView {
  return {
    items: [],
    itemCount: 0,
    totalQuantity: 0,
    subtotal: 0,
    savings: 0,
    hasUnavailableItems: false,
    allPurchasable: false,
    issues: [],
  };
}

export async function addToCart(
  cartId: number,
  productId: number,
  quantity: number,
): Promise<CartView> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    select: { id: true, stockQuantity: true, allowBackorder: true },
  });
  if (!product) throw new NotFoundError("Product");

  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!cart) throw new NotFoundError("Cart");

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId, productId } },
    select: { id: true, quantity: true },
  });

  if (!existing && cart._count.items >= MAX_LINES) {
    throw new ValidationError(`A cart can hold at most ${MAX_LINES} different products`);
  }

  const requested = (existing?.quantity ?? 0) + quantity;

  if (requested > MAX_QUANTITY_PER_LINE) {
    throw new ValidationError(`You can order at most ${MAX_QUANTITY_PER_LINE} of a single product`);
  }

  // Stock is only checked to give a clear message here. The authoritative check
  // happens inside the checkout transaction, where a race cannot slip through.
  if (!product.allowBackorder && requested > product.stockQuantity) {
    throw new ValidationError(
      product.stockQuantity > 0
        ? `Only ${product.stockQuantity} available for this product`
        : "This product is out of stock",
    );
  }

  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId, productId } },
    create: { cartId, productId, quantity },
    update: { quantity: requested },
  });

  return getCart(cartId);
}

export async function updateCartQuantity(cartId: number, productId: number, quantity: number) {
  const item = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId, productId } },
    select: { id: true },
  });
  if (!item) throw new NotFoundError("Cart item");

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    select: { stockQuantity: true, allowBackorder: true },
  });
  if (!product) throw new NotFoundError("Product");

  if (!product.allowBackorder && quantity > product.stockQuantity) {
    throw new ValidationError(
      product.stockQuantity > 0
        ? `Only ${product.stockQuantity} available for this product`
        : "This product is out of stock",
    );
  }

  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCart(cartId);
}

export async function removeFromCart(cartId: number, productId: number) {
  await prisma.cartItem.deleteMany({ where: { cartId, productId } });
  return getCart(cartId);
}

export async function clearCart(cartId: number) {
  await prisma.cartItem.deleteMany({ where: { cartId } });
  return getCart(cartId);
}

/**
 * Price the cart for display, applying whatever offers are currently eligible.
 *
 * This is a preview, not an authority. Checkout recomputes everything inside a
 * transaction; sharing the same evaluator is what stops the two from
 * disagreeing about what an order costs.
 */
export async function previewCart(cartId: number, offerCode?: string) {
  const view = await getCart(cartId);

  const priced = await priceCartItems(
    view.items
      .filter((line) => line.issue === null)
      .map((line) => ({ productId: line.productId, quantity: line.quantity })),
    offerCode,
  );

  return {
    ...view,
    discountTotal: priced.discountTotal,
    estimatedTotal: priced.total,
    appliedOffers: priced.appliedOffers,
    offerRejections: priced.rejections,
  };
}
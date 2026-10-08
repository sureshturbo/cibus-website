import crypto from "node:crypto";
import { multiplyMinor } from "@cibus/shared";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { db, transaction, type Tx } from "../db/pool.js";
import { findActiveProductStock } from "../db/repositories/catalog.repo.js";
import {
  countCartItems,
  deleteCart,
  deleteCartItem,
  deleteCartItems,
  findCartById,
  findCartByCustomerId,
  findCartByToken,
  findCartItem,
  firstImagesForProductIds,
  insertCart,
  listCartItemRows,
  listCartLineRows,
  upsertCartItem,
  updateCartItemQuantity,
} from "../db/repositories/cart.repo.js";
import { priceCartItems } from "./pricing.service.js";
import { isPurchasable } from "./selects.js";

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
  tx: Tx = db,
): Promise<CartToken> {
  if (identity.customerId) {
    const existing = await findCartByCustomerId(identity.customerId, tx);
    if (existing) return { cartId: existing.id };

    const created = await insertCart({ customerId: identity.customerId, token: null, expiresAt: null }, tx);
    return { cartId: created.id };
  }

  if (identity.guestToken) {
    const existing = await findCartByToken(identity.guestToken, tx);
    if (existing && existing.expiresAt && existing.expiresAt > new Date()) {
      return { cartId: existing.id, token: identity.guestToken };
    }
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + GUEST_CART_TTL_DAYS * 86_400_000);
  const created = await insertCart({ customerId: null, token, expiresAt }, tx);
  return { cartId: created.id, token };
}

/** Fold a guest cart into the customer's cart on sign-in, then drop the guest row. */
export async function mergeGuestCart(guestToken: string, customerId: number): Promise<void> {
  const guest = await findCartByToken(guestToken);
  if (!guest) return;
  const guestItems = await listCartItemRows(guest.id);

  await transaction(async (tx) => {
    if (guestItems.length > 0) {
      const customerCart = await resolveCart({ customerId }, tx);

      for (const item of guestItems) {
        await upsertCartItem(
          customerCart.cartId,
          item.productId,
          item.quantity,
          // Take the larger quantity rather than summing: a guest who added 2
          // and an account holder who already had 2 should end up with 2.
          Math.min(Math.max(item.quantity, 1), MAX_QUANTITY_PER_LINE),
          tx,
        );
      }
    }

    await deleteCart(guest.id, tx);
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
  const cart = await findCartById(cartId);
  if (!cart) return emptyCart();

  const rows = await listCartLineRows(cartId);
  const images = await firstImagesForProductIds(rows.map((row) => row.productId));

  const items: CartLineView[] = rows.map((product) => {
    const gone = product.deletedAt !== null || !product.isActive;
    const purchasable = !gone && isPurchasable(product);
    const overStock = purchasable && !product.allowBackorder && product.quantity > product.stockQuantity;

    let issue: string | null = null;
    if (gone) issue = "This product is no longer available and has been removed from pricing.";
    else if (!purchasable) issue = "Out of stock. Remove it to continue.";
    else if (overStock) {
      issue = product.stockQuantity > 0
        ? `Only ${product.stockQuantity} left in stock. Reduce the quantity to continue.`
        : "This product is out of stock. Remove it to continue.";
    }

    const price = gone ? 0 : product.price;
    const image = images.get(product.productId);

    return {
      productId: product.productId,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      unitLabel: product.unitLabel,
      unitPrice: price,
      compareAtPrice: gone ? null : product.compareAtPrice,
      lineTotal: multiplyMinor(price, product.quantity),
      quantity: product.quantity,
      stockQuantity: product.stockQuantity,
      purchasable,
      issue,
      image: image ? { url: image.url, altText: image.altText || product.name } : null,
      category: product.categoryName ? { name: product.categoryName, slug: product.categorySlug! } : null,
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
  const product = await findActiveProductStock(productId);
  if (!product) throw new NotFoundError("Product");

  const cart = await findCartById(cartId);
  if (!cart) throw new NotFoundError("Cart");
  const itemCount = await countCartItems(cartId);

  const existing = await findCartItem(cartId, productId);

  if (!existing && itemCount >= MAX_LINES) {
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

  await upsertCartItem(cartId, productId, quantity, requested);

  return getCart(cartId);
}

export async function updateCartQuantity(cartId: number, productId: number, quantity: number) {
  const item = await findCartItem(cartId, productId);
  if (!item) throw new NotFoundError("Cart item");

  const product = await findActiveProductStock(productId);
  if (!product) throw new NotFoundError("Product");

  if (!product.allowBackorder && quantity > product.stockQuantity) {
    throw new ValidationError(
      product.stockQuantity > 0
        ? `Only ${product.stockQuantity} available for this product`
        : "This product is out of stock",
    );
  }

  await updateCartItemQuantity(item.id, quantity);
  return getCart(cartId);
}

export async function removeFromCart(cartId: number, productId: number) {
  await deleteCartItem(cartId, productId);
  return getCart(cartId);
}

export async function clearCart(cartId: number) {
  await deleteCartItems(cartId);
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
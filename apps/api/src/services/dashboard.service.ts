import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { findLowStockProducts } from "./stock.service.js";

/**
 * Dashboard service.
 *
 * Every figure is aggregated in SQL rather than loaded and reduced in
 * JavaScript, so the cost stays flat as the order table grows.
 *
 * Revenue deliberately counts orders that are not cancelled or refunded. There
 * is no payment column, so "revenue" here means "value of live orders", and the
 * UI says exactly that rather than implying cash in the bank.
 */

/** Statuses that still count toward live order value. */
const LIVE_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Inlined rather than bound: these are server constants, never user input. */
const LIVE_STATUS_LIST = LIVE_STATUSES.map((status) => `'${status}'`).join(", ");
const FULFILMENT_STATUS_LIST = "'PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'OUT_FOR_DELIVERY'";

export interface DashboardSummary {
  orders: {
    total: number;
    byStatus: Record<string, number>;
    last7Days: number;
    pendingAction: number;
    awaitingFulfilment: number;
    deliveredToday: number;
  };
  revenue: {
    liveOrderValue: number;
    deliveredValue: number;
    last7DaysValue: number;
    averageOrderValue: number;
    currency: string;
    /** Always false while no payment gateway is integrated. */
    isCommittedRevenue: false;
  };
  catalogue: {
    totalProducts: number;
    activeProducts: number;
    featuredProducts: number;
    totalCategories: number;
    outOfStock: number;
  };
  offers: {
    active: number;
    scheduled: number;
    totalRedemptions: number;
    discountGiven: number;
  };
  fulfilment: {
    pending: number;
    confirmed: number;
    processing: number;
    ready: number;
    outForDelivery: number;
  };
  attention: {
    lowStockCount: number;
    lowStockItems: Array<{
      id: number;
      name: string;
      sku: string;
      stockQuantity: number;
      lowStockThreshold: number;
      unitLabel: string;
    }>;
    newestEnquiries: number;
  };
  recentOrders: Array<{
    id: number;
    orderNumber: string;
    customerName: string;
    status: string;
    total: number;
    createdAt: Date;
  }>;
  generatedAt: Date;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const now = new Date();

  const [
    totalOrders,
    statusRows,
    last7Days,
    deliveredToday,
    liveValue,
    deliveredValue,
    sevenDayValue,
    productRow,
    categoryRow,
    outOfStockRow,
    activeOffersRow,
    scheduledOffersRow,
    redemptionsRow,
    discountRow,
    fulfilmentRows,
    lowStock,
    enquiryRow,
    recentOrders,
  ] = await Promise.all([
    db.queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM orders"),
    db.query<{ status: string; total: number }>(
      "SELECT status, COUNT(*) AS total FROM orders GROUP BY status",
    ),
    db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
    ),
    db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM orders WHERE status = 'DELIVERED' AND delivered_at >= CURDATE()",
    ),
    db.queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status IN (${LIVE_STATUS_LIST})`,
    ),
    db.queryOne<{ total: number | null }>(
      "SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'DELIVERED'",
    ),
    db.queryOne<{ total: number | null }>(
      `SELECT COALESCE(SUM(total), 0) AS total FROM orders
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status IN (${LIVE_STATUS_LIST})`,
    ),
    db.queryOne<{ total: number; active: number | null; featured: number | null }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(is_active = 1), 0) AS active,
              COALESCE(SUM(is_active = 1 AND is_featured = 1), 0) AS featured
         FROM products WHERE deleted_at IS NULL`,
    ),
    db.queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM categories WHERE is_active = 1"),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM products
        WHERE is_active = 1 AND deleted_at IS NULL AND stock_quantity <= 0 AND allow_backorder = 0`,
    ),
    db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM offers WHERE is_active = 1 AND starts_at <= NOW() AND ends_at >= NOW()",
    ),
    db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM offers WHERE is_active = 1 AND starts_at > NOW()",
    ),
    db.queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM offer_redemptions"),
    db.queryOne<{ total: number | null }>(
      "SELECT COALESCE(SUM(discount), 0) AS total FROM offer_redemptions",
    ),
    db.query<{ status: string; total: number }>(
      `SELECT status, COUNT(*) AS total FROM orders
        WHERE status IN (${FULFILMENT_STATUS_LIST}) GROUP BY status`,
    ),
    findLowStockProducts(10),
    db.queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM partner_enquiries WHERE status = 'NEW'",
    ),
    db.query<{
      id: number;
      orderNumber: string;
      customerName: string;
      status: string;
      total: number;
      createdAt: Date;
    }>(
      `SELECT id, order_number AS orderNumber, customer_name AS customerName, status, total, created_at AS createdAt
         FROM orders ORDER BY created_at DESC LIMIT 8`,
    ),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusRows) byStatus[row.status] = Number(row.total);

  const fulfilment: Record<string, number> = {};
  for (const row of fulfilmentRows) fulfilment[row.status] = Number(row.total);

  const liveOrderValue = Number(liveValue?.total ?? 0);
  const liveOrders = LIVE_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);

  return {
    orders: {
      total: Number(totalOrders?.total ?? 0),
      byStatus,
      last7Days: Number(last7Days?.total ?? 0),
      pendingAction: byStatus.PENDING ?? 0,
      awaitingFulfilment:
        (byStatus.CONFIRMED ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.READY ?? 0),
      deliveredToday: Number(deliveredToday?.total ?? 0),
    },
    revenue: {
      liveOrderValue,
      deliveredValue: Number(deliveredValue?.total ?? 0),
      last7DaysValue: Number(sevenDayValue?.total ?? 0),
      averageOrderValue: liveOrders > 0 ? Math.round(liveOrderValue / liveOrders) : 0,
      currency: env.CURRENCY,
      isCommittedRevenue: false,
    },
    catalogue: {
      totalProducts: Number(productRow?.total ?? 0),
      activeProducts: Number(productRow?.active ?? 0),
      featuredProducts: Number(productRow?.featured ?? 0),
      totalCategories: Number(categoryRow?.total ?? 0),
      outOfStock: Number(outOfStockRow?.total ?? 0),
    },
    offers: {
      active: Number(activeOffersRow?.total ?? 0),
      scheduled: Number(scheduledOffersRow?.total ?? 0),
      totalRedemptions: Number(redemptionsRow?.total ?? 0),
      discountGiven: Number(discountRow?.total ?? 0),
    },
    fulfilment: {
      pending: fulfilment.PENDING ?? 0,
      confirmed: fulfilment.CONFIRMED ?? 0,
      processing: fulfilment.PROCESSING ?? 0,
      ready: fulfilment.READY ?? 0,
      outForDelivery: fulfilment.OUT_FOR_DELIVERY ?? 0,
    },
    attention: {
      lowStockCount: lowStock.length,
      lowStockItems: lowStock,
      newestEnquiries: Number(enquiryRow?.total ?? 0),
    },
    recentOrders: recentOrders.map((row) => ({ ...row, total: Number(row.total) })),
    generatedAt: now,
  };
}

export interface SalesSeriesPoint {
  bucket: string;
  revenue: number;
  orders: number;
}

/** Revenue bucketed by day for the last `days` days, oldest first. */
export async function getSalesSeries(days = 30): Promise<SalesSeriesPoint[]> {
  const rows = await db.query<{ bucket: string; revenue: number | null; orders: number }>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS bucket,
            SUM(total) AS revenue, COUNT(*) AS orders
       FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        AND status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY bucket
      ORDER BY bucket ASC`,
    [days],
  );
  return rows.map((row) => ({
    bucket: row.bucket,
    revenue: Number(row.revenue ?? 0),
    orders: Number(row.orders),
  }));
}

export async function getTopProducts(limit = 10, days = 30) {
  const rows = await db.query<{ productId: number; productName: string; unitsSold: number; revenue: number }>(
    `SELECT i.product_id AS productId, i.product_name AS productName,
            SUM(i.quantity) AS unitsSold, SUM(i.line_total) AS revenue
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
      WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
        AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY i.product_id, i.product_name
      ORDER BY unitsSold DESC
      LIMIT ?`,
    [days, limit],
  );
  return rows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    unitsSold: Number(row.unitsSold),
    revenue: Number(row.revenue),
  }));
}
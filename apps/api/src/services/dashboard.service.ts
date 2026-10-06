import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { findLowStockProducts } from "./stock.service.js";

/**
 * Dashboard metrics.
 *
 * Every figure is aggregated in SQL rather than by loading rows and reducing in
 * JavaScript, so the cost stays flat as the order table grows.
 *
 * Revenue deliberately counts orders that are not cancelled or refunded. There
 * is no payment column yet, so "revenue" here means "value of live orders", and
 * the label in the UI says exactly that.
 */

const LIVE_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

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
    /** True while no payment gateway is integrated. */
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
    lowStockItems: Array<{ id: number; name: string; sku: string; stockQuantity: number; lowStockThreshold: number; unitLabel: string }>;
    newestEnquiries: number;
  };
  recentOrders: Array<{
    id: number;
    orderNumber: string;
    customerName: string;
    total: number;
    status: OrderStatus;
    createdAt: Date;
  }>;
  generatedAt: Date;
}

export async function getDashboardSummary(currency: string): Promise<DashboardSummary> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalOrders,
    statusGroups,
    last7Days,
    deliveredToday,
    revenueAggregate,
    deliveredAggregate,
    sevenDayValue,
    productCounts,
    categoryCount,
    outOfStock,
    activeOffers,
    scheduledOffers,
    redemptions,
    discountGiven,
    fulfilmentGroups,
    lowStock,
    enquiryCount,
    recentOrders,
  ] = await Promise.all([
    prisma.order.count(),

    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),

    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),

    prisma.order.count({
      where: { status: "DELIVERED", deliveredAt: { gte: todayStart } },
    }),

    prisma.order.aggregate({
      _sum: { total: true },
      where: { status: { in: LIVE_STATUSES } },
    }),

    prisma.order.aggregate({
      _sum: { total: true },
      where: { status: "DELIVERED" },
    }),

    prisma.order.aggregate({
      _sum: { total: true },
      where: { createdAt: { gte: sevenDaysAgo }, status: { in: LIVE_STATUSES } },
    }),

    Promise.all([
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      prisma.product.count({ where: { isFeatured: true, isActive: true, deletedAt: null } }),
    ]),

    prisma.category.count({ where: { isActive: true } }),

    prisma.product.count({
      where: { isActive: true, deletedAt: null, stockQuantity: { lte: 0 }, allowBackorder: false },
    }),

    prisma.offer.count({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    }),

    prisma.offer.count({ where: { isActive: true, startsAt: { gt: now } } }),

    prisma.offerRedemption.count(),

    prisma.offerRedemption.aggregate({ _sum: { discount: true } }),

    prisma.order.groupBy({
      by: ["status"],
      where: { status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "READY", "OUT_FOR_DELIVERY"] } },
      _count: { _all: true },
    }),

    findLowStockProducts(10),

    prisma.partnerEnquiry.count({ where: { status: "NEW" } }),

    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, orderNumber: true, customerName: true, total: true, status: true, createdAt: true },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const group of statusGroups) {
    byStatus[group.status] = group._count._all;
  }

  const fulfilment: Record<string, number> = {};
  for (const group of fulfilmentGroups) {
    fulfilment[group.status] = group._count._all;
  }

  const liveOrderValue = revenueAggregate._sum.total ?? 0;
  const liveOrders = LIVE_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);

  return {
    orders: {
      total: totalOrders,
      byStatus,
      last7Days,
      pendingAction: byStatus.PENDING ?? 0,
      awaitingFulfilment: (byStatus.CONFIRMED ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.READY ?? 0),
      deliveredToday,
    },
    revenue: {
      liveOrderValue,
      deliveredValue: deliveredAggregate._sum.total ?? 0,
      last7DaysValue: sevenDayValue._sum.total ?? 0,
      averageOrderValue: liveOrders > 0 ? Math.round(liveOrderValue / liveOrders) : 0,
      currency,
      isCommittedRevenue: false,
    },
    catalogue: {
      totalProducts: productCounts[0],
      activeProducts: productCounts[1],
      featuredProducts: productCounts[2],
      totalCategories: categoryCount,
      outOfStock,
    },
    offers: {
      active: activeOffers,
      scheduled: scheduledOffers,
      totalRedemptions: redemptions,
      discountGiven: discountGiven._sum.discount ?? 0,
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
      newestEnquiries: enquiryCount,
    },
    recentOrders,
    generatedAt: now,
  };
}

/* ----------------------------- sales series ------------------------------ */

/**
 * Daily order value for a period, for the dashboard trend line.
 * Grouped in SQL; zero-filled in JS so the chart has no gaps.
 */
export async function getSalesSeries(days: number, currency: string) {
  const clamped = Math.min(Math.max(days, 1), 90);
  const from = new Date(Date.now() - clamped * 86_400_000);
  from.setHours(0, 0, 0, 0);

  const rows = await prisma.$queryRaw<Array<{ day: Date; orders: number; value: number }>>(Prisma.sql`
    SELECT DATE(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS value
    FROM orders
    WHERE created_at >= ${from}
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `);

  const byDay = new Map<string, { orders: number; value: number }>();
  for (const row of rows) {
    byDay.set(row.day.toISOString().slice(0, 10), {
      orders: Number(row.orders),
      value: Number(row.value),
    });
  }

  const series: Array<{ day: string; orders: number; value: number }> = [];
  for (let offset = 0; offset < clamped; offset += 1) {
    const day = new Date(from.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const entry = byDay.get(day);
    series.push({ day, orders: entry?.orders ?? 0, value: entry?.value ?? 0 });
  }

  return { currency, series };
}

/** Best sellers over a period, for the dashboard. */
export async function getTopProducts(limit: number, days = 30) {
  const from = new Date(Date.now() - days * 86_400_000);
  const safeLimit = Math.min(Math.max(limit, 1), 25);

  // Read product identity from the snapshot on the order line, not from the
  // live product row, so a renamed or deleted product still appears correctly.
  const rows = await prisma.$queryRaw<
    Array<{ productId: number | null; name: string; sku: string; unitsSold: number; value: number }>
  >(Prisma.sql`
    SELECT oi.product_id AS productId,
           oi.product_name AS name,
           oi.sku AS sku,
           SUM(oi.quantity) AS unitsSold,
           SUM(oi.line_total) AS value
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ${from}
      AND o.status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY oi.product_id, oi.product_name, oi.sku
    ORDER BY unitsSold DESC, value DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    unitsSold: Number(row.unitsSold),
    value: Number(row.value),
  }));
}
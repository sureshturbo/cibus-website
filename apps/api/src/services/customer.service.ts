import { Prisma } from "@prisma/client";
import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

/**
 * Customer management for the admin panel.
 *
 * Read-only by default. A customer record is referenced by orders and offers a
 * service and privacy surface, so deactivation and limited profile edits are the
 * only write operations offered here.
 */

export interface ListCustomersQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: "all" | "active" | "inactive";
}

export async function listCustomers(query: ListCustomersQuery): Promise<Paginated<unknown>> {
  const where: Prisma.CustomerWhereInput = {};

  if (query.status === "active") where.isActive = true;
  if (query.status === "inactive") where.isActive = false;

  if (query.search) {
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.OR = [
      { email: { contains: term } },
      { fullName: { contains: term } },
      { phone: { contains: term } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { orders: true, addresses: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { total: true, status: true, createdAt: true },
        },
      },
    }),
  ]);

  const items = rows.map((row) => {
    const latestOrder = row.orders[0] ?? null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      phone: row.phone,
      isActive: row.isActive,
      createdAt: row.createdAt,
      orderCount: row._count.orders,
      addressCount: row._count.addresses,
      lastOrderTotal: latestOrder?.total ?? null,
      lastOrderStatus: latestOrder?.status ?? null,
      lastOrderAt: latestOrder?.createdAt ?? null,
    };
  });

  return paginate(items, total, query.page, query.pageSize);
}

export async function getCustomerById(id: number) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      isActive: true,
      emailVerifiedAt: true,
      createdAt: true,
      addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      orders: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          _count: { select: { items: true } },
          createdAt: true,
        },
      },
      _count: { select: { orders: true } },
    },
  });

  if (!customer) throw new NotFoundError("Customer");

  return {
    ...customer,
    orderCount: customer._count.orders,
    lifetimeValue: customer.orders
      .filter((order) => order.status !== "CANCELLED" && order.status !== "REFUNDED")
      .reduce((sum, order) => sum + order.total, 0),
    orders: customer.orders.map(({ _count, ...order }) => ({
      ...order,
      itemCount: _count.items,
    })),
  };
}

/**
 * Deactivate rather than delete. Orders reference the customer, and deleting
 * the row would orphan history that invoices still depend on.
 */
export async function setCustomerActive(id: number, isActive: boolean) {
  const existing = await prisma.customer.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Customer");

  const customer = await prisma.customer.update({
    where: { id },
    data: { isActive },
    select: { id: true, email: true, fullName: true, isActive: true },
  });

  // Revoke sessions immediately rather than waiting for token expiry.
  if (!isActive) {
    await prisma.refreshSession.updateMany({
      where: { customerId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return customer;
}
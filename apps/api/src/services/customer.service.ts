import { paginate } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import {
  countCustomerRows,
  findCustomerById,
  listCustomerRows,
  updateCustomer,
} from "../db/repositories/auth.repo.js";
import { revokeSessionsForCustomer } from "../db/repositories/auth.repo.js";

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

export async function listCustomers(query: ListCustomersQuery) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status === "active") where.push("c.is_active = 1");
  if (query.status === "inactive") where.push("c.is_active = 0");

  if (query.search) {
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("(c.email LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ?)");
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countCustomerRows(whereSql, params),
    listCustomerRows(whereSql, params, query.pageSize, offset),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt,
    orderCount: Number(row.orderCount),
    addressCount: Number(row.addressCount),
    lastOrderTotal: row.lastOrderTotal,
    lastOrderStatus: row.lastOrderStatus,
    lastOrderAt: row.lastOrderAt,
  }));

  return paginate(items, total, query.page, query.pageSize);
}

export async function getCustomerById(id: number) {
  const rows = await listCustomerRows("WHERE c.id = ?", [id], 1, 0);
  const customer = rows[0];
  if (!customer) throw new NotFoundError("Customer");

  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    phone: customer.phone,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    orderCount: Number(customer.orderCount),
    addressCount: Number(customer.addressCount),
    lastOrderTotal: customer.lastOrderTotal,
    lastOrderStatus: customer.lastOrderStatus,
    lastOrderAt: customer.lastOrderAt,
  };
}

/**
 * Deactivate rather than delete. Orders reference the customer, and deleting
 * the row would orphan history that invoices still depend on.
 */
export async function setCustomerActive(id: number, isActive: boolean) {
  const existing = await findCustomerById(id);
  if (!existing) throw new NotFoundError("Customer");

  const customer = await updateCustomer(id, { isActive });

  // Revoke sessions immediately rather than waiting for token expiry.
  if (!isActive) {
    await revokeSessionsForCustomer(id);
  }

  return { id: customer.id, email: customer.email, fullName: customer.fullName, isActive: customer.isActive };
}
import { db, type Tx } from "../pool.js";
import type { AddressRow, AdminRow, CustomerRow, RefreshSessionRow } from "../types.js";

/**
 * Customer, administrator, session and address data access.
 *
 * Sessions and the identity read that follows them are deliberately separate
 * queries: the join would only ever be one-to-one, and reading the account row
 * on its own keeps the "is this account still active" check explicit.
 */

export const CUSTOMER_COLUMNS = `
  c.id, c.email, c.password_hash AS passwordHash, c.full_name AS fullName,
  c.phone, c.is_active AS isActive, c.email_verified_at AS emailVerifiedAt,
  c.created_at AS createdAt, c.updated_at AS updatedAt
`;

export const ADMIN_COLUMNS = `
  a.id, a.email, a.password_hash AS passwordHash, a.full_name AS fullName,
  a.is_active AS isActive, a.last_login_at AS lastLoginAt,
  a.created_at AS createdAt, a.updated_at AS updatedAt
`;

export const ADDRESS_COLUMNS = `
  a.id, a.customer_id AS customerId, a.label, a.full_name AS fullName, a.phone,
  a.line1, a.line2, a.city, a.state, a.postal_code AS postalCode, a.landmark,
  a.is_default AS isDefault, a.created_at AS createdAt, a.updated_at AS updatedAt
`;

export const SESSION_COLUMNS = `
  s.id, s.customer_id AS customerId, s.admin_id AS adminId,
  s.token_hash AS tokenHash, s.user_agent AS userAgent, s.ip_address AS ipAddress,
  s.expires_at AS expiresAt, s.revoked_at AS revokedAt, s.created_at AS createdAt
`;

/* --------------------------------- customers ----------------------------- */

export function findCustomerByEmail(email: string, conn: Tx = db): Promise<CustomerRow | null> {
  return conn.queryOne<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers c WHERE c.email = ? LIMIT 1`, [email]);
}

export function findCustomerById(id: number, conn: Tx = db): Promise<CustomerRow | null> {
  return conn.queryOne<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customers c WHERE c.id = ?`, [id]);
}

export async function findActiveCustomerById(id: number, conn: Tx = db): Promise<{ id: number } | null> {
  return conn.queryOne<{ id: number }>(
    "SELECT id FROM customers WHERE id = ? AND is_active = 1",
    [id],
  );
}

export async function insertCustomer(
  values: { email: string; passwordHash: string; fullName: string; phone: string | null },
  conn: Tx = db,
): Promise<CustomerRow> {
  const result = await conn.execute(
    "INSERT INTO customers (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)",
    [values.email, values.passwordHash, values.fullName, values.phone],
  );
  const row = await findCustomerById(result.insertId, conn);
  if (!row) throw new Error("Inserted customer could not be read back");
  return row;
}

export interface CustomerUpdateValues {
  fullName?: string;
  phone?: string | null;
  passwordHash?: string;
  isActive?: boolean;
}

export async function updateCustomer(
  id: number,
  values: CustomerUpdateValues,
  conn: Tx = db,
): Promise<CustomerRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (values.fullName !== undefined) {
    sets.push("full_name = ?");
    params.push(values.fullName);
  }
  if (values.phone !== undefined) {
    sets.push("phone = ?");
    params.push(values.phone);
  }
  if (values.passwordHash !== undefined) {
    sets.push("password_hash = ?");
    params.push(values.passwordHash);
  }
  if (values.isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(values.isActive);
  }
  sets.push("updated_at = NOW()");
  params.push(id);
  await conn.execute(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`, params);
  const row = await findCustomerById(id, conn);
  if (!row) throw new Error("Updated customer could not be read back");
  return row;
}

/* ---------------------------------- admins ------------------------------- */

export function findAdminByEmail(email: string, conn: Tx = db): Promise<AdminRow | null> {
  return conn.queryOne<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admins a WHERE a.email = ? LIMIT 1`, [email]);
}

export function findAdminById(id: number, conn: Tx = db): Promise<AdminRow | null> {
  return conn.queryOne<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admins a WHERE a.id = ?`, [id]);
}

export async function findActiveAdminById(id: number, conn: Tx = db): Promise<{ id: number } | null> {
  return conn.queryOne<{ id: number }>("SELECT id FROM admins WHERE id = ? AND is_active = 1", [id]);
}

export async function countActiveAdmins(conn: Tx = db): Promise<number> {
  const row = await conn.queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM admins WHERE is_active = 1");
  return Number(row?.total ?? 0);
}

export async function listAdminRows(conn: Tx = db): Promise<AdminRow[]> {
  return conn.query<AdminRow>(`SELECT ${ADMIN_COLUMNS} FROM admins a ORDER BY a.created_at ASC`);
}

export async function insertAdmin(
  values: { email: string; fullName: string; passwordHash: string; isActive: boolean },
  conn: Tx = db,
): Promise<AdminRow> {
  const result = await conn.execute(
    "INSERT INTO admins (email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?)",
    [values.email, values.fullName, values.passwordHash, values.isActive],
  );
  const row = await findAdminById(result.insertId, conn);
  if (!row) throw new Error("Inserted administrator could not be read back");
  return row;
}

export async function setAdminActive(id: number, isActive: boolean, conn: Tx = db): Promise<AdminRow> {
  await conn.execute("UPDATE admins SET is_active = ?, updated_at = NOW() WHERE id = ?", [isActive, id]);
  const row = await findAdminById(id, conn);
  if (!row) throw new Error("Updated administrator could not be read back");
  return row;
}

export async function setAdminPassword(id: number, passwordHash: string, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE admins SET password_hash = ?, updated_at = NOW() WHERE id = ?", [passwordHash, id]);
}

export async function touchAdminLogin(id: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE admins SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?", [id]);
}

/* --------------------------------- sessions ------------------------------ */

export async function insertRefreshSession(
  values: {
    customerId: number | null;
    adminId: number | null;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  },
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    `INSERT INTO refresh_sessions (customer_id, admin_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [values.customerId, values.adminId, values.tokenHash, values.userAgent, values.ipAddress, values.expiresAt],
  );
}

export function findSessionByHash(tokenHash: string, conn: Tx = db): Promise<RefreshSessionRow | null> {
  return conn.queryOne<RefreshSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM refresh_sessions s WHERE s.token_hash = ? LIMIT 1`,
    [tokenHash],
  );
}

export async function revokeSessionById(id: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE refresh_sessions SET revoked_at = NOW() WHERE id = ?", [id]);
}

export async function revokeSessionsForCustomer(customerId: number, conn: Tx = db): Promise<void> {
  await conn.execute(
    "UPDATE refresh_sessions SET revoked_at = NOW() WHERE customer_id = ? AND revoked_at IS NULL",
    [customerId],
  );
}

export async function revokeSessionsForAdmin(adminId: number, conn: Tx = db): Promise<void> {
  await conn.execute(
    "UPDATE refresh_sessions SET revoked_at = NOW() WHERE admin_id = ? AND revoked_at IS NULL",
    [adminId],
  );
}

export async function revokeSessionByHash(tokenHash: string, conn: Tx = db): Promise<void> {
  await conn.execute(
    "UPDATE refresh_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash],
  );
}

export async function deleteRevokedSessionsForCustomer(customerId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM refresh_sessions WHERE customer_id = ? AND revoked_at IS NOT NULL", [customerId]);
}

export async function deleteRevokedSessionsForAdmin(adminId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM refresh_sessions WHERE admin_id = ? AND revoked_at IS NOT NULL", [adminId]);
}

/* --------------------------------- addresses ----------------------------- */

export function listAddressRows(customerId: number, conn: Tx = db): Promise<AddressRow[]> {
  return conn.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses a
     WHERE a.customer_id = ?
     ORDER BY a.is_default DESC, a.created_at DESC`,
    [customerId],
  );
}

export interface AddressValues {
  customerId: number;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  landmark: string | null;
  isDefault: boolean;
}

export async function clearDefaultAddresses(customerId: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE addresses SET is_default = 0, updated_at = NOW() WHERE customer_id = ?", [customerId]);
}

export async function insertAddress(values: AddressValues, conn: Tx = db): Promise<AddressRow> {
  const result = await conn.execute(
    `INSERT INTO addresses
       (customer_id, label, full_name, phone, line1, line2, city, state, postal_code, landmark, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.customerId,
      values.label,
      values.fullName,
      values.phone,
      values.line1,
      values.line2,
      values.city,
      values.state,
      values.postalCode,
      values.landmark,
      values.isDefault,
    ],
  );
  const row = await conn.queryOne<AddressRow>(`SELECT ${ADDRESS_COLUMNS} FROM addresses a WHERE a.id = ?`, [
    result.insertId,
  ]);
  if (!row) throw new Error("Inserted address could not be read back");
  return row;
}

export async function deleteAddress(id: number, customerId: number, conn: Tx = db): Promise<number> {
  const result = await conn.execute("DELETE FROM addresses WHERE id = ? AND customer_id = ?", [id, customerId]);
  return result.affectedRows;
}

/* ------------------------ admin customer listing ------------------------- */

export interface CustomerListRow {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  orderCount: number;
  addressCount: number;
  lastOrderTotal: number | null;
  lastOrderStatus: string | null;
  lastOrderAt: Date | null;
}

export async function countCustomerRows(
  whereSql: string,
  params: readonly unknown[],
  conn: Tx = db,
): Promise<number> {
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM customers c ${whereSql}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export function listCustomerRows(
  whereSql: string,
  params: readonly unknown[],
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<CustomerListRow[]> {
  return conn.query<CustomerListRow>(
    `SELECT c.id, c.email, c.full_name AS fullName, c.phone, c.is_active AS isActive,
            c.created_at AS createdAt,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orderCount,
            (SELECT COUNT(*) FROM addresses ad WHERE ad.customer_id = c.id) AS addressCount,
            (SELECT o.total FROM orders o WHERE o.customer_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS lastOrderTotal,
            (SELECT o.status FROM orders o WHERE o.customer_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS lastOrderStatus,
            (SELECT o.created_at FROM orders o WHERE o.customer_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS lastOrderAt
       FROM customers c
       ${whereSql}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}
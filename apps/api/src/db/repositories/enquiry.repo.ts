import { db, type Tx } from "../pool.js";
import type { PartnerEnquiryRow } from "../types.js";

/**
 * Partner enquiry data access. The public form only inserts; the admin panel
 * reads and updates status/notes.
 */

export const ENQUIRY_COLUMNS = `
  e.id, e.name, e.business_name AS businessName, e.email, e.phone, e.message,
  e.status, e.notes, e.created_at AS createdAt, e.updated_at AS updatedAt
`;

export interface InsertEnquiryValues {
  name: string;
  businessName: string;
  email: string;
  phone: string;
  message: string;
}

export async function insertPartnerEnquiry(
  values: InsertEnquiryValues,
  conn: Tx = db,
): Promise<{ id: number; name: string; businessName: string; createdAt: Date }> {
  const result = await conn.execute(
    `INSERT INTO partner_enquiries (name, business_name, email, phone, message)
     VALUES (?, ?, ?, ?, ?)`,
    [values.name, values.businessName, values.email, values.phone, values.message],
  );
  const row = await conn.queryOne<{ id: number; name: string; businessName: string; createdAt: Date }>(
    `SELECT id, name, business_name AS businessName, created_at AS createdAt
       FROM partner_enquiries WHERE id = ?`,
    [result.insertId],
  );
  if (!row) throw new Error("Inserted enquiry could not be read back");
  return row;
}

export async function countEnquiries(status: string | undefined, conn: Tx = db): Promise<number> {
  const where = status ? "WHERE status = ?" : "";
  const params = status ? [status] : [];
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM partner_enquiries ${where}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export function listEnquiryRows(
  status: string | undefined,
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<PartnerEnquiryRow[]> {
  const where = status ? "WHERE e.status = ?" : "";
  const params: unknown[] = status ? [status, limit, offset] : [limit, offset];
  return conn.query<PartnerEnquiryRow>(
    `SELECT ${ENQUIRY_COLUMNS} FROM partner_enquiries e ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export function findEnquiryById(id: number, conn: Tx = db): Promise<PartnerEnquiryRow | null> {
  return conn.queryOne<PartnerEnquiryRow>(
    `SELECT ${ENQUIRY_COLUMNS} FROM partner_enquiries e WHERE e.id = ?`,
    [id],
  );
}

export async function updateEnquiry(
  id: number,
  values: { status?: string; notes?: string },
  conn: Tx = db,
): Promise<PartnerEnquiryRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (values.status !== undefined) {
    sets.push("status = ?");
    params.push(values.status);
  }
  if (values.notes !== undefined) {
    sets.push("notes = ?");
    params.push(values.notes);
  }
  if (sets.length > 0) {
    sets.push("updated_at = NOW()");
    params.push(id);
    await conn.execute(`UPDATE partner_enquiries SET ${sets.join(", ")} WHERE id = ?`, params);
  }
  const row = await findEnquiryById(id, conn);
  if (!row) throw new Error("Updated enquiry could not be read back");
  return row;
}
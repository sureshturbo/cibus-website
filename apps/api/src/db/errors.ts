/**
 * Classification of mysql2 driver errors.
 *
 * Replaces the Prisma helpers in lib/prisma.ts (P2002/P2003): services that used
 * to branch on Prisma's error codes branch on MySQL's string codes instead.
 */

function codeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** 1062: a UNIQUE or PRIMARY KEY constraint was violated. */
export function isUniqueConstraintError(error: unknown): boolean {
  return codeOf(error) === "ER_DUP_ENTRY";
}

/** 1451/1452: a foreign key would be orphaned or points at a missing parent. */
export function isForeignKeyError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "ER_ROW_IS_REFERENCED_2" || code === "ER_NO_REFERENCED_ROW_2";
}

/** 1213/1205: the transaction was chosen as a deadlock victim or timed out. */
export function isDeadlockError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT";
}
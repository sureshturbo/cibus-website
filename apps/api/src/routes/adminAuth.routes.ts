import { Router } from "express";
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiryDate,
  signAccessToken,
  verifyPassword,
} from "../lib/crypto.js";
import { clearAuthCookies, setAuthCookies } from "../lib/authCookies.js";
import { clientIp, userAgent } from "../middleware/common.js";
import { transaction } from "../db/pool.js";
import {
  countActiveAdmins,
  deleteRevokedSessionsForAdmin,
  findAdminByEmail,
  findAdminById,
  findSessionByHash,
  insertAdmin,
  insertRefreshSession,
  listAdminRows,
  revokeSessionById,
  revokeSessionByHash,
  revokeSessionsForAdmin,
  setAdminActive,
  setAdminPassword,
  touchAdminLogin,
} from "../db/repositories/auth.repo.js";
import { ConflictError, UnauthenticatedError } from "../lib/errors.js";
import { sendOk, validate } from "../lib/http.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { requireAdmin } from "../middleware/auth.js";
import { adminCreateSchema } from "@cibus/shared";
import { z } from "zod";
import { controller, param } from "../lib/controller.js";

export const adminAuthRouter = Router();

/** Admin rows that are safe to serialise (never the password hash). */
function publicAdmin(admin: {
  id: number;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    isActive: admin.isActive,
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt,
  };
}

async function issueAdminSession(
  res: import("express").Response,
  admin: { id: number; email: string },
  req: import("express").Request,
): Promise<void> {
  const { token, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiryDate();

  await insertRefreshSession({
    customerId: null,
    adminId: admin.id,
    tokenHash: hash,
    userAgent: userAgent(req) ?? null,
    ipAddress: clientIp(req),
    expiresAt,
  });

  const accessToken = signAccessToken({ sub: admin.id, aud: "admin", email: admin.email });
  setAuthCookies(res, { accessToken, refreshToken: token, refreshExpiresAt: expiresAt });
}

/* --------------------------------- login --------------------------------- */

adminAuthRouter.post(
  "/login",
  authLimiter,
  validate(adminCreateSchema.pick({ email: true, password: true })),
  controller(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof adminCreateSchema>;
    const admin = await findAdminByEmail(email);

    // Constant work whether or not the account exists, so timing cannot be used
    // to enumerate administrators.
    const hash = admin?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$aaaa$bbbb";
    const passwordOk = await verifyPassword(hash, password);

    if (!admin || !passwordOk) throw new UnauthenticatedError("Email or password is incorrect");
    if (!admin.isActive) throw new UnauthenticatedError("This account is no longer active");

    await issueAdminSession(res, admin, req);
    await touchAdminLogin(admin.id);

    const fresh = await findAdminById(admin.id);
    sendOk(res, { admin: publicAdmin(fresh ?? admin) });
  }),
);

/* -------------------------------- refresh -------------------------------- */

adminAuthRouter.post(
  "/refresh",
  authLimiter,
  controller(async (req, res) => {
    const token = req.cookies?.["cibus_refresh"] as string | undefined;
    if (!token) throw new UnauthenticatedError("No active session");

    const session = await findSessionByHash(hashRefreshToken(token));
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.adminId) {
      throw new UnauthenticatedError("Your session has expired. Please sign in again.");
    }

    const admin = await findAdminById(session.adminId);
    if (!admin || !admin.isActive) throw new UnauthenticatedError("This account is no longer active");

    const { token: fresh, hash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiryDate();

    await transaction(async (tx) => {
      await revokeSessionById(session.id, tx);
      await insertRefreshSession(
        {
          customerId: null,
          adminId: admin.id,
          tokenHash: hash,
          userAgent: userAgent(req) ?? null,
          ipAddress: clientIp(req),
          expiresAt,
        },
        tx,
      );
      await deleteRevokedSessionsForAdmin(admin.id, tx);
    });

    const accessToken = signAccessToken({ sub: admin.id, aud: "admin", email: admin.email });
    setAuthCookies(res, { accessToken, refreshToken: fresh, refreshExpiresAt: expiresAt });
    sendOk(res, { admin: publicAdmin(admin) });
  }),
);

/* --------------------------------- logout -------------------------------- */

adminAuthRouter.post(
  "/logout",
  controller(async (req, res) => {
    const token = req.cookies?.["cibus_refresh"] as string | undefined;
    if (token) await revokeSessionByHash(hashRefreshToken(token));
    clearAuthCookies(res);
    sendOk(res, { loggedOut: true });
  }),
);

/* -------------------------------- session -------------------------------- */

adminAuthRouter.get(
  "/session",
  requireAdmin,
  controller(async (req, res) => {
    const admin = await findAdminById(req.auth!.id);
    if (!admin || !admin.isActive) throw new UnauthenticatedError();
    sendOk(res, { admin: publicAdmin(admin) });
  }),
);

/* ------------------------------ change password -------------------------- */

adminAuthRouter.post(
  "/change-password",
  authLimiter,
  requireAdmin,
  controller(async (req, res) => {
    const body = req.body as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword ?? "";
    const newPassword = body.newPassword ?? "";
    if (!currentPassword || !newPassword) {
      throw new UnauthenticatedError("Current and new password are required");
    }

    const admin = await findAdminById(req.auth!.id);
    if (!admin) throw new UnauthenticatedError();

    const ok = await verifyPassword(admin.passwordHash, currentPassword);
    if (!ok) throw new UnauthenticatedError("Current password is incorrect");

    const passwordHash = await hashPassword(newPassword);
    await transaction(async (tx) => {
      await setAdminPassword(admin.id, passwordHash, tx);
      await revokeSessionsForAdmin(admin.id, tx);
    });

    clearAuthCookies(res);
    sendOk(res, { passwordChanged: true });
  }),
);

/* ------------------------------ admin accounts --------------------------- */

adminAuthRouter.get(
  "/admins",
  requireAdmin,
  controller(async (_req, res) => {
    const admins = await listAdminRows();
    sendOk(res, { admins: admins.map(publicAdmin) });
  }),
);

adminAuthRouter.post(
  "/admins",
  requireAdmin,
  validate(adminCreateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof adminCreateSchema>;
    const existing = await findAdminByEmail(body.email);
    if (existing) throw new ConflictError("An administrator with that email already exists");

    const admin = await insertAdmin({
      email: body.email,
      fullName: body.fullName,
      passwordHash: await hashPassword(body.password),
      isActive: body.isActive,
    });
    sendOk(res, { admin: publicAdmin(admin) }, 201);
  }),
);

adminAuthRouter.patch(
  "/admins/:id/active",
  requireAdmin,
  controller(async (req, res) => {
    const id = param(req, "id");
    const body = req.body as { isActive?: unknown };
    const isActive = Boolean(body.isActive);

    const admin = await findAdminById(id);
    if (!admin) throw new UnauthenticatedError("Administrator not found");

    // Refuse to disable the last active administrator: that would lock everyone
    // out of the panel with no way back in.
    if (!isActive && admin.isActive) {
      const active = await countActiveAdmins();
      if (active <= 1) throw new ConflictError("At least one active administrator must remain");
    }

    const updated = await setAdminActive(id, isActive);
    // Revoke sessions immediately so a disabled account loses access now, not
    // when its access token happens to expire.
    if (!isActive) await revokeSessionsForAdmin(id);

    sendOk(res, { admin: publicAdmin(updated) });
  }),
);
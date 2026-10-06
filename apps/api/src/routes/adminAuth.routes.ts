import { Router } from "express";
import { z } from "zod";
import { adminCreateSchema, adminLoginSchema } from "@cibus/shared";
import { clearAuthCookies, setAuthCookies } from "../lib/authCookies.js";
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiryDate,
  signAccessToken,
  verifyPassword,
} from "../lib/crypto.js";
import { ConflictError, NotFoundError, UnauthenticatedError } from "../lib/errors.js";
import { sendOk, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { currentAdminId, requireAdmin } from "../middleware/auth.js";
import { clientIp, userAgent } from "../middleware/common.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { controller, param } from "../lib/controller.js";

/**
 * Admin authentication.
 *
 * Deliberately a separate router, separate guards and separate table from
 * customer accounts. The privilege boundary is structural, so a bug in customer
 * authorisation can never accidentally grant administrative access.
 */
export const adminAuthRouter = Router();

/** Dummy hash used to keep failed-login timing comparable. */
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$aaaa$bbbb";

function publicAdmin(admin: { id: number; email: string; fullName: string; lastLoginAt: Date | null }) {
  return { id: admin.id, email: admin.email, fullName: admin.fullName, lastLoginAt: admin.lastLoginAt };
}

adminAuthRouter.post(
  "/login",
  authLimiter,
  validate(adminLoginSchema),
  controller(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof adminLoginSchema>;

    const admin = await prisma.admin.findUnique({ where: { email } });
    const passwordOk = await verifyPassword(admin?.passwordHash ?? DUMMY_HASH, password);

    if (!admin || !passwordOk) {
      throw new UnauthenticatedError("Email or password is incorrect");
    }
    if (!admin.isActive) {
      throw new UnauthenticatedError("This administrator account is disabled");
    }

    const { token, hash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiryDate();

    await prisma.$transaction([
      prisma.refreshSession.create({
        data: {
          adminId: admin.id,
          tokenHash: hash,
          userAgent: userAgent(req) ?? null,
          ipAddress: clientIp(req),
          expiresAt,
        },
      }),
      prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
    ]);

    const accessToken = signAccessToken({ sub: admin.id, aud: "admin", email: admin.email });
    setAuthCookies(res, { accessToken, refreshToken: token, refreshExpiresAt: expiresAt });

    sendOk(res, { admin: publicAdmin({ ...admin, lastLoginAt: new Date() }) });
  }),
);

adminAuthRouter.post(
  "/refresh",
  authLimiter,
  controller(async (req, res) => {
    const token = req.cookies?.["cibus_refresh"] as string | undefined;
    if (!token) throw new UnauthenticatedError("No active session");

    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { admin: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      !session.adminId ||
      !session.admin?.isActive
    ) {
      throw new UnauthenticatedError("Your session has expired. Please sign in again.");
    }

    const admin = session.admin;
    const { token: fresh, hash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiryDate();

    await prisma.$transaction([
      prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
      prisma.refreshSession.create({
        data: {
          adminId: admin.id,
          tokenHash: hash,
          userAgent: userAgent(req) ?? null,
          ipAddress: clientIp(req),
          expiresAt,
        },
      }),
      prisma.refreshSession.deleteMany({ where: { adminId: admin.id, revokedAt: { not: null } } }),
    ]);

    const accessToken = signAccessToken({ sub: admin.id, aud: "admin", email: admin.email });
    setAuthCookies(res, { accessToken, refreshToken: fresh, refreshExpiresAt: expiresAt });
    sendOk(res, { admin: publicAdmin(admin) });
  }),
);

adminAuthRouter.post(
  "/logout",
  controller(async (req, res) => {
    const token = req.cookies?.["cibus_refresh"] as string | undefined;
    if (token) {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearAuthCookies(res);
    sendOk(res, { loggedOut: true });
  }),
);

adminAuthRouter.get(
  "/session",
  requireAdmin,
  controller(async (req, res) => {
    const admin = await prisma.admin.findUnique({ where: { id: req.auth!.id } });
    if (!admin) throw new NotFoundError("Administrator");
    sendOk(res, { admin: publicAdmin(admin) });
  }),
);

adminAuthRouter.post(
  "/change-password",
  authLimiter,
  requireAdmin,
  controller(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword || newPassword.length < 10) {
      throw new UnauthenticatedError("A current password and a new password of at least 10 characters are required");
    }

    const admin = await prisma.admin.findUniqueOrThrow({ where: { id: currentAdminId(req) } });
    if (!(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new UnauthenticatedError("Your current password is incorrect");
    }

    await prisma.$transaction([
      prisma.admin.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(newPassword) },
      }),
      prisma.refreshSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    clearAuthCookies(res);
    sendOk(res, { passwordChanged: true });
  }),
);

/* ---------------------------- admin management --------------------------- */

adminAuthRouter.get(
  "/admins",
  requireAdmin,
  controller(async (_req, res) => {
    const admins = await prisma.admin.findMany({
      select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    sendOk(res, { admins });
  }),
);

adminAuthRouter.post(
  "/admins",
  requireAdmin,
  validate(adminCreateSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof adminCreateSchema>;

    const existing = await prisma.admin.findUnique({ where: { email: body.email }, select: { id: true } });
    if (existing) throw new ConflictError("An administrator with that email already exists");

    const admin = await prisma.admin.create({
      data: {
        email: body.email,
        fullName: body.fullName,
        passwordHash: await hashPassword(body.password),
        isActive: body.isActive,
      },
      select: { id: true, email: true, fullName: true, isActive: true, createdAt: true },
    });

    sendOk(res, { admin }, 201);
  }),
);

const adminIdParam = z.object({ id: z.coerce.number().int().positive() });

adminAuthRouter.patch(
  "/admins/:id/active",
  requireAdmin,
  validate(adminIdParam, "params"),
  controller(async (req, res) => {
    const id = param(req, "id");
    const isActive = Boolean((req.body as { isActive?: unknown }).isActive);

    // Refuse to disable or delete the last active administrator: that would lock
    // everyone out of the panel with no way back in.
    if (!isActive) {
      const activeAdmins = await prisma.admin.count({ where: { isActive: true } });
      if (activeAdmins <= 1) {
        throw new ConflictError("At least one active administrator must remain");
      }
    }

    const admin = await prisma.admin.update({
      where: { id },
      data: { isActive },
      select: { id: true, email: true, fullName: true, isActive: true },
    });

    // Revoke sessions immediately so a disabled account loses access now, not
    // when its access token happens to expire.
    if (!isActive) {
      await prisma.refreshSession.updateMany({
        where: { adminId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    sendOk(res, { admin });
  }),
);
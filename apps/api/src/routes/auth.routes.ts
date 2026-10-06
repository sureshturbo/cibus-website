import { Router } from "express";
import type { Response } from "express";
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
import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, UnauthenticatedError, ValidationError } from "../lib/errors.js";
import { sendOk, validate } from "../lib/http.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { optionalCustomer, requireCustomer } from "../middleware/auth.js";
import {
  addressBookEntrySchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "@cibus/shared";
import { z } from "zod";
import { controller, param } from "../lib/controller.js";

export const authRouter = Router();

/* ------------------------------- helpers --------------------------------- */

function publicCustomer(customer: {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: customer.id,
    email: customer.email,
    fullName: customer.fullName,
    phone: customer.phone,
    emailVerifiedAt: customer.emailVerifiedAt,
    createdAt: customer.createdAt,
  };
}

interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

interface SessionTarget {
  id: number;
  email: string;
}

/**
 * Create a refresh-session row and set the auth cookies. The access token is
 * signed here so it is derived from the same identity as the refresh token.
 */
async function issueSession(
  res: Response,
  account: SessionTarget,
  ctx: SessionContext,
): Promise<void> {
  const { token, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiryDate();

  await prisma.refreshSession.create({
    data: {
      customerId: account.id,
      tokenHash: hash,
      userAgent: ctx.userAgent ?? null,
      ipAddress: ctx.ipAddress ?? null,
      expiresAt,
    },
  });

  const accessToken = signAccessToken({ sub: account.id, aud: "customer", email: account.email });
  setAuthCookies(res, { accessToken, refreshToken: token, refreshExpiresAt: expiresAt });
}

function sessionContext(req: Parameters<typeof clientIp>[0]) {
  return { userAgent: userAgent(req), ipAddress: clientIp(req) };
}

/* ------------------------------- register -------------------------------- */

authRouter.post(
  "/register",
  authLimiter,
  validate(registerSchema),
  controller(async (req, res) => {
    const { email, password, fullName, phone } = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.customer.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictError("An account with that email already exists");
    }

    const customer = await prisma.customer.create({
      data: { email, passwordHash: await hashPassword(password), fullName, phone: phone ?? null },
    });

    await issueSession(res, customer, sessionContext(req));
    sendOk(res, { user: publicCustomer(customer) }, 201);
  }),
);

/* --------------------------------- login --------------------------------- */

authRouter.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  controller(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const customer = await prisma.customer.findUnique({ where: { email } });

    // Always run a verification so a missing account and a wrong password take
    // comparable time, leaving no timing oracle for account enumeration.
    const hash = customer?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$aaaa$bbbb";
    const passwordOk = await verifyPassword(hash, password);

    if (!customer || !passwordOk) {
      throw new UnauthenticatedError("Email or password is incorrect");
    }
    if (!customer.isActive) {
      throw new UnauthenticatedError("This account is no longer active");
    }

    await issueSession(res, customer, sessionContext(req));
    sendOk(res, { user: publicCustomer(customer) });
  }),
);

/* -------------------------------- refresh -------------------------------- */

authRouter.post(
  "/refresh",
  authLimiter,
  controller(async (req, res) => {
    const token = req.cookies?.["cibus_refresh"] as string | undefined;
    if (!token) throw new UnauthenticatedError("No active session");

    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { customer: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.customerId) {
      // A token that no longer resolves is either replayed or forged. Drop any
      // remaining sessions for that customer so a stolen token cannot persist.
      throw new UnauthenticatedError("Your session has expired. Please sign in again.");
    }

    // An admin session has no customer; the guard above already excluded it, but
    // the include is optional so the type has to be narrowed explicitly.
    const customer = session.customer;
    if (!customer) throw new UnauthenticatedError("Your session has expired. Please sign in again.");
    if (!customer.isActive) throw new UnauthenticatedError("This account is no longer active");

    // Rotate: the presented token is retired and replaced atomically.
    const { token: fresh, hash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiryDate();

    await prisma.$transaction([
      prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshSession.create({
        data: {
          customerId: customer.id,
          tokenHash: hash,
          userAgent: userAgent(req) ?? null,
          ipAddress: clientIp(req),
          expiresAt,
        },
      }),
      prisma.refreshSession.deleteMany({
        where: { customerId: customer.id, revokedAt: { not: null } },
      }),
    ]);

    const accessToken = signAccessToken({ sub: customer.id, aud: "customer", email: customer.email });
    setAuthCookies(res, { accessToken, refreshToken: fresh, refreshExpiresAt: expiresAt });
    sendOk(res, { user: publicCustomer(customer) });
  }),
);

/* --------------------------------- logout -------------------------------- */

authRouter.post(
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

/** Revoke every session for the signed-in customer ("log out everywhere"). */
authRouter.post(
  "/logout-all",
  requireCustomer,
  controller(async (req, res) => {
    const customerId = req.auth!.id;
    await prisma.refreshSession.updateMany({
      where: { customerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res);
    sendOk(res, { loggedOutEverywhere: true });
  }),
);

/* -------------------------------- session -------------------------------- */

authRouter.get(
  "/session",
  optionalCustomer,
  controller(async (req, res) => {
    if (!req.auth) {
      sendOk(res, { authenticated: false, user: null });
      return;
    }
    const customer = await prisma.customer.findUnique({ where: { id: req.auth.id } });
    if (!customer || !customer.isActive) {
      clearAuthCookies(res);
      sendOk(res, { authenticated: false, user: null });
      return;
    }
    sendOk(res, { authenticated: true, user: publicCustomer(customer) });
  }),
);

/* -------------------------------- profile -------------------------------- */

authRouter.patch(
  "/profile",
  requireCustomer,
  validate(updateProfileSchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof updateProfileSchema>;
    const customer = await prisma.customer.update({
      where: { id: req.auth!.id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      },
    });
    sendOk(res, { user: publicCustomer(customer) });
  }),
);

authRouter.post(
  "/change-password",
  authLimiter,
  requireCustomer,
  validate(changePasswordSchema),
  controller(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: req.auth!.id } });

    const ok = await verifyPassword(customer.passwordHash, currentPassword);
    if (!ok) throw new ValidationError("Your current password is incorrect");

    await prisma.$transaction([
      prisma.customer.update({
        where: { id: customer.id },
        data: { passwordHash: await hashPassword(newPassword) },
      }),
      // Changing a password invalidates every existing session, including this one.
      prisma.refreshSession.updateMany({
        where: { customerId: customer.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    clearAuthCookies(res);
    sendOk(res, { passwordChanged: true });
  }),
);

/* ------------------------------ address book ----------------------------- */

const addressIdParam = z.object({ id: z.coerce.number().int().positive() });

authRouter.get(
  "/addresses",
  requireCustomer,
  controller(async (req, res) => {
    const addresses = await prisma.address.findMany({
      where: { customerId: req.auth!.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    sendOk(res, { addresses });
  }),
);

authRouter.post(
  "/addresses",
  requireCustomer,
  validate(addressBookEntrySchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof addressBookEntrySchema>;
    const customerId = req.auth!.id;

    const address = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          customerId,
          label: body.label,
          fullName: body.fullName,
          phone: body.phone,
          line1: body.line1,
          line2: body.line2 || null,
          city: body.city,
          state: body.state,
          postalCode: body.postalCode,
          landmark: body.landmark || null,
          isDefault: body.isDefault,
        },
      });
    });

    sendOk(res, { address }, 201);
  }),
);

authRouter.delete(
  "/addresses/:id",
  requireCustomer,
  validate(addressIdParam, "params"),
  controller(async (req, res) => {
    const id = param(req, "id");
    const { count } = await prisma.address.deleteMany({ where: { id, customerId: req.auth!.id } });
    if (count === 0) throw new NotFoundError("Address");
    sendOk(res, { deleted: true });
  }),
);
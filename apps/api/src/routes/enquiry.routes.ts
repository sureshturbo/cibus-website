import { Router } from "express";
import { partnerEnquirySchema } from "@cibus/shared";
import { controller } from "../lib/controller.js";
import { sendOk, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { enquiryLimiter } from "../middleware/rateLimit.js";
import type { z } from "zod";

export const enquiryRouter = Router();

/**
 * Partner With Us submissions.
 *
 * Open by design: this is a public sales contact form, so it carries no
 * authentication. It is rate limited per IP and validated server-side, and the
 * email address is stored exactly as submitted so we can reply to it.
 */
enquiryRouter.post(
  "/",
  enquiryLimiter,
  validate(partnerEnquirySchema),
  controller(async (req, res) => {
    const body = req.body as z.infer<typeof partnerEnquirySchema>;

    const enquiry = await prisma.partnerEnquiry.create({
      data: {
        name: body.name,
        businessName: body.businessName,
        email: body.email,
        phone: body.phone,
        message: body.message,
      },
      select: { id: true, name: true, businessName: true, createdAt: true },
    });

    sendOk(
      res,
      {
        enquiry,
        message: "Thank you. Our partnerships team will be in touch within one working day.",
      },
      201,
    );
  }),
);
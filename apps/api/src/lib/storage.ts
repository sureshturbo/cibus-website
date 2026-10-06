import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import multer from "multer";
import sharp from "sharp";
import { env } from "../config/env.js";
import { ValidationError } from "../lib/errors.js";

/**
 * Image storage.
 *
 * Everything sits behind this one module so moving from local disk to S3 or
 * another object store later is a change to this file and nothing else.
 *
 * Uploads are validated, re-encoded and stripped of metadata before being
 * written. Never serve a file the user uploaded as-is: an SVG or a crafted JPEG
 * served from our own origin is a stored-XSS vector.
 */

/**
 * Output formats we allow. Listed explicitly rather than derived from sharp's
 * types so adding a format is a deliberate decision, not a library upgrade.
 */
type SharpFormat = "jpeg" | "png" | "webp" | "avif";

const ALLOWED_TYPES = new Map<string, { extension: string; sharpFormat: SharpFormat }>([
  ["image/jpeg", { extension: "jpg", sharpFormat: "jpeg" }],
  ["image/png", { extension: "png", sharpFormat: "png" }],
  ["image/webp", { extension: "webp", sharpFormat: "webp" }],
  ["image/avif", { extension: "avif", sharpFormat: "avif" }],
]);

const MAX_DIMENSION = 2000;
const QUALITY = 82;

/** Random filename: never trust the client-supplied name for a path component. */
function safeFilename(originalName: string, contentType: string): string {
  const config = ALLOWED_TYPES.get(contentType);
  if (!config) throw new ValidationError("Unsupported image format");
  const stamp = Date.now().toString(36);
  const suffix = randomBytes(6).toString("hex");
  return `${stamp}-${suffix}.${config.extension}`;
}

export function absoluteUploadDir(): string {
  return path.isAbsolute(env.UPLOAD_DIR) ? env.UPLOAD_DIR : path.resolve(process.cwd(), env.UPLOAD_DIR);
}

export async function ensureUploadDir(): Promise<string> {
  const dir = absoluteUploadDir();
  await fs.mkdir(path.join(dir, "products"), { recursive: true });
  await fs.mkdir(path.join(dir, "invoices"), { recursive: true });
  return dir;
}

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10 },
  fileFilter: (_req: Request, file, callback) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      callback(new ValidationError("Upload a JPEG, PNG, WebP or AVIF image"));
      return;
    }
    callback(null, true);
  },
});

export interface StoredImage {
  url: string;
  filename: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
}

/**
 * Normalise an uploaded image and write it to the products directory.
 *
 * Re-encoding through sharp serves three purposes: it strips EXIF and any
 * embedded payload, it normalises formats to something every browser renders,
 * and it caps the dimensions so a 40MP photo cannot become 40MB of page weight.
 */
export async function storeProductImage(file: Express.Multer.File): Promise<StoredImage> {
  const config = ALLOWED_TYPES.get(file.mimetype);
  if (!config) throw new ValidationError("Unsupported image format");

  let pipeline = sharp(file.buffer, { failOn: "error" }).rotate(); // honour EXIF orientation, then drop it

  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) {
    throw new ValidationError("That file is not a readable image");
  }

  pipeline = pipeline.resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  const output =
    config.sharpFormat === "jpeg"
      ? await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.toFormat(config.sharpFormat, { quality: QUALITY }).toBuffer({ resolveWithObject: true });

  const filename = safeFilename(file.originalname, file.mimetype);
  const dir = path.join(await ensureUploadDir(), "products");
  const destination = path.join(dir, filename);

  // Guard against a filename collision escaping the products directory.
  if (path.dirname(path.resolve(destination)) !== path.resolve(dir)) {
    throw new ValidationError("Invalid file name");
  }

  await fs.writeFile(destination, output.data);

  return {
    url: `/uploads/products/${filename}`,
    filename,
    width: output.info.width,
    height: output.info.height,
    bytes: output.info.size,
    contentType: `image/${config.extension === "jpg" ? "jpeg" : config.extension}`,
  };
}

/** Write a generated invoice PDF to disk and return its public path. */
export async function storeInvoicePdf(invoiceNumber: string, data: Buffer): Promise<string> {
  const dir = path.join(await ensureUploadDir(), "invoices");
  const filename = `${invoiceNumber.replace(/[^\w.-]/g, "_")}.pdf`;
  const destination = path.join(dir, filename);
  await fs.writeFile(destination, data);
  return `/uploads/invoices/${filename}`;
}

/**
 * Only ever serve files whose stored extension matches an allowed image type.
 * This is what stops an HTML or SVG payload from being served as a script from
 * our own origin.
 */
export function isServableUpload(pathname: string): boolean {
  const name = path.basename(pathname);
  if (!/^[a-z0-9._-]+$/i.test(name) || name.includes("..")) return false;
  const extension = path.extname(name).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".avif", ".pdf"].includes(extension);
}

export const IMAGE_CONTENT_TYPES = new Set([...ALLOWED_TYPES.keys()]);
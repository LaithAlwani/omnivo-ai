"use node";

import crypto from "node:crypto";
import { appError } from "./errors";

// -----------------------------------------------------------------------------
// Shared per-tenant credential encryption (AES-256-GCM). Used for BYO-SMTP
// passwords (emailNode) and Integrations API keys/tokens. The key is derived
// from the deployment secret EMAIL_SECRET (never stored in the database). Node
// runtime — only actions may import this.
//
// Ciphertext format: "ivB64:tagB64:ciphertextB64".
// -----------------------------------------------------------------------------

function encKey(): Buffer {
  const secret = process.env.EMAIL_SECRET;
  if (!secret) {
    appError(
      "CONFIG",
      "Set EMAIL_SECRET on the Convex deployment to store encrypted credentials.",
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptSecret(enc: string): string {
  const [ivB, tagB, ctB] = enc.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encKey(),
    Buffer.from(ivB, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

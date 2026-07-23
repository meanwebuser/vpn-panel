import { randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomPassword(): string {
  return randomBytes(12).toString("base64url");
}

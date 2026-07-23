import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/passwords.js";

test("scrypt password hashes verify only matching passwords", async () => {
  const hash = await hashPassword("correct horse");

  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong horse", hash), false);
});

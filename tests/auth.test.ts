import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { hashPassword } from "../src/passwords.js";
import { accountForCredentials, accountForLogin, basicCredentials } from "../src/auth.js";

test("basicCredentials parses Basic Auth without logging or transforming the password", () => {
  const password = "p a:ss/word";
  const header = `Basic ${Buffer.from(`vpn2-07:${password}`, "utf8").toString("base64")}`;
  assert.deepEqual(basicCredentials({ headers: { authorization: header } }), { login: "vpn2-07", password });
  assert.equal(basicCredentials({ headers: {} }), null);
  assert.equal(basicCredentials({ headers: { authorization: "Bearer secret" } }), null);
});

test("accountForCredentials accepts only an enabled user with the correct password", async () => {
  const passwordHash = await hashPassword("correct");
  const queries: unknown[][] = [];
  const pool = {
    async query(_sql: string, values: unknown[]) {
      queries.push(values);
      return {
        rows: [{ id: "7", login: "vpn2-07", display_name: "Masha", password_hash: passwordHash, role: "user", enabled: true }],
      };
    },
  } as never;

  const account = await accountForCredentials(pool, "vpn2-07", "correct", "user");
  assert.equal(account?.id, "7");
  assert.equal(await accountForCredentials(pool, "vpn2-07", "wrong", "user"), null);
  assert.deepEqual(queries[0], ["vpn2-07", "user"]);
});

test("accountForLogin resolves the fixed enabled profile without a password", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: "7", login: "vpn2-07", display_name: "Masha", password_hash: "not-used", role: "user", enabled: true }] };
    },
  } as never;

  const account = await accountForLogin(pool, "vpn2-07", "user");
  assert.equal(account?.login, "vpn2-07");
});

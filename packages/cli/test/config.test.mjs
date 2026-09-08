import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setConfig,
  clearConfig,
  readConfig,
  savedToken,
  configSummary,
} from "../src/config.mjs";

async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), "portal-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const values = new Map();
  const store = {
    get: async (key) => values.get(key),
    set: async (key, token) => {
      values.set(key, token);
    },
    delete: async (key) => values.delete(key),
  };
  return { file: join(dir, "config.json"), store, values };
}

test("configuration stores references, rotates tokens and never forwards credentials to a different server", async (t) => {
  const { file, store, values } = await harness(t);
  const first = await setConfig(
    file,
    { server: "https://agent.example/", token: "first-secret" },
    store,
  );
  assert.equal(first.server, "https://agent.example");
  assert(!Object.hasOwn(first, "token"));
  assert(!(await readFile(file, "utf8")).includes("first-secret"));
  assert(!JSON.stringify(configSummary(file, first)).includes("first-secret"));
  assert.equal(
    await savedToken(await readConfig(file), first.server, store),
    "first-secret",
  );
  assert.equal(
    await savedToken(first, "https://other.example", store),
    undefined,
  );
  assert.equal(
    (await setConfig(file, { server: first.server }, store)).credential,
    first.credential,
  );
  const next = await setConfig(file, { token: "second-secret" }, store);
  assert.equal(values.size, 1);
  assert.equal(values.has(first.credential), false);
  assert.equal(await savedToken(next, next.server, store), "second-secret");
  const changed = await setConfig(
    file,
    { server: "https://other.example" },
    store,
  );
  assert.equal(changed.credential, undefined);
  assert.equal(values.size, 0);
  await setConfig(file, { token: "third-secret" }, store);
  await clearConfig(file, store);
  await clearConfig(file, store);
  assert.deepEqual(await readConfig(file), {});
  assert.equal(values.size, 0);
});

test("failed credential writes and deletion preserve the previous configuration", async (t) => {
  const { file, store, values } = await harness(t);
  const previous = await setConfig(
    file,
    { server: "https://agent.example", token: "old-secret" },
    store,
  );
  const failed = async () => {
    throw new Error("store locked");
  };
  await assert.rejects(
    setConfig(file, { token: "new-secret" }, { ...store, set: failed }),
    /store locked/,
  );
  assert.deepEqual(await readConfig(file), previous);
  await assert.rejects(
    setConfig(
      file,
      { server: "https://other.example", token: "new-secret" },
      {
        ...store,
        delete: async (key) => {
          if (key === previous.credential) throw new Error("store locked");
          return store.delete(key);
        },
      },
    ),
    /store locked/,
  );
  assert.deepEqual(await readConfig(file), previous);
  assert.equal(values.size, 1);
  assert.equal(
    await savedToken(previous, previous.server, store),
    "old-secret",
  );
  await assert.rejects(
    clearConfig(file, { ...store, delete: failed }),
    /store locked/,
  );
  assert.deepEqual(await readConfig(file), previous);
});

test("missing credentials and malformed or plaintext configuration produce explicit errors", async (t) => {
  const { file, store, values } = await harness(t);
  const saved = await setConfig(
    file,
    { server: "http://localhost:8080", token: "secret" },
    store,
  );
  values.clear();
  await assert.rejects(savedToken(saved, saved.server, store), {
    code: "missing_credential",
  });
  for (const value of [
    { server: saved.server, token: "secret" },
    { server: "https://user:secret@host" },
    { server: 42 },
  ]) {
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(
      readConfig(file),
      (error) =>
        error.code === "invalid_config" && !error.message.includes("secret"),
    );
  }
});

test("configuration paths isolate credentials even for the same server", async (t) => {
  const a = await harness(t),
    b = await harness(t);
  const first = await setConfig(
    a.file,
    { server: "https://agent.example", token: "a-secret" },
    a.store,
  );
  const second = await setConfig(
    b.file,
    { server: "https://agent.example", token: "b-secret" },
    a.store,
  );
  assert.notEqual(first.credential, second.credential);
  await clearConfig(a.file, a.store);
  assert.equal(await savedToken(second, second.server, a.store), "b-secret");
});

test("a failed config-file write removes the newly created credential", async (t) => {
  const { file, store, values } = await harness(t);
  await assert.rejects(
    setConfig(
      file,
      { server: "https://agent.example", token: "test-secret" },
      {
        ...store,
        set: async (key, token) => {
          await store.set(key, token);
          // Simulate the destination becoming unwritable between read and commit.
          await mkdir(file);
        },
      },
    ),
    { code: "config_unwritable" },
  );
  assert.equal(values.size, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { credentials } from "../src/credentials.mjs";

// Explicit opt-in: uses only temporary entries in the real OS credential store.
test("native credentials persist across CLI processes and are removed by config clear", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portal-keychain-"));
  const file = join(dir, "config.json");
  const bin = fileURLToPath(
    new URL("../bin/agent-portal.mjs", import.meta.url),
  );
  const accounts = new Set();
  let received;
  const server = createServer((req, res) => {
    received = req.headers.authorization;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"topics":[]}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try {
      for (const account of accounts) await credentials.delete(account);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  const run = (args, input = "") =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args, "--config", file], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  const serverURL = `http://127.0.0.1:${server.address().port}`;
  for (const token of ["native-test-first", "native-test-second"]) {
    const result = await run(
      ["config", "set", "--server", serverURL, "--token-file", "-"],
      token,
    );
    assert.equal(result.code, 0, result.stderr);
    assert(!result.stdout.includes(token));
    const configText = await readFile(file, "utf8");
    assert(!configText.includes(token));
    accounts.add(JSON.parse(configText).credential);
    assert.equal((await run(["topics"])).code, 0);
    assert(received === `Bearer ${token}`, "request uses saved credential");
    assert.equal((await run(["config", "show"])).code, 0);
  }
  const override = await run(["topics", "--server", "https://other.invalid"]);
  assert.equal(override.code, 2);
  assert.equal(JSON.parse(override.stderr).error.code, "missing_token");
  assert.equal((await run(["config", "clear"])).code, 0);
  for (const account of accounts)
    assert.equal(await credentials.get(account), null);
  assert.equal(
    JSON.parse((await run(["config", "show"])).stdout).data.configured,
    false,
  );
});

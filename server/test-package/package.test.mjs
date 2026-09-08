import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
const exec = promisify(execFile);
const serverRoot = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
for (const key of [
  "PORTAL_DB",
  "PORTAL_HOST",
  "PORTAL_PORT",
  "PORTAL_BASE_URL",
])
  delete env[key];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test(
  "standalone tarball installs, persists settings/data and survives reinstallation",
  { timeout: 180000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "portal-server-package-"));
    const prefix = join(dir, "installation"),
      dataDir = join(dir, "state");
    const port = await freePort(),
      base = `http://127.0.0.1:${port}`;
    const npm = (args) =>
      exec(process.execPath, [process.env.npm_execpath, ...args], {
        cwd: dir,
        env,
        timeout: 90000,
        maxBuffer: 2 * 1024 * 1024,
      });
    let child, completed;
    const stop = async (signal = "SIGTERM") => {
      if (!child) return;
      child.kill(signal);
      let timer;
      let result;
      try {
        result = await Promise.race([
          completed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Server did not stop")),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      child = undefined;
      return result;
    };
    t.after(async () => {
      try {
        await stop();
      } finally {
        if (child) child.kill("SIGKILL");
        await rm(dir, { recursive: true, force: true });
      }
    });
    await npm(["pack", serverRoot, "--pack-destination", dir]);
    const tarball = join(
      dir,
      (await readdir(dir)).find((file) => file.endsWith(".tgz")),
    );
    const install = () =>
      npm(["install", "--global", "--prefix", prefix, "--omit=dev", tarball]);
    await install();
    const installed = join(
      prefix,
      ...(process.platform === "win32" ? [] : ["lib"]),
      "node_modules",
      "agent-portal-server",
    );
    const bin = join(installed, "bin", "agent-portal-server.mjs");
    await access(
      join(
        prefix,
        ...(process.platform === "win32" ? [] : ["bin"]),
        process.platform === "win32"
          ? "agent-portal-server.cmd"
          : "agent-portal-server",
      ),
    );
    for (const unwanted of ["src", "test", ".local", "node_modules/typescript"])
      await assert.rejects(access(join(installed, unwanted)), {
        code: "ENOENT",
      });
    await access(
      join(installed, "resources/protocol/schemas/core.schema.json"),
    );
    await access(join(installed, "deployment/macos-launchd.md"));
    const run = (args) =>
      exec(process.execPath, [bin, ...args, "--data-dir", dataDir], {
        cwd: dir,
        env,
        timeout: 15000,
      });
    assert.match((await run(["--help"])).stdout, /agent-portal-server start/);
    const uninitialized = JSON.parse((await run(["config", "show"])).stdout);
    assert.equal(uninitialized.data_dir, dataDir);
    assert.equal(uninitialized.database_exists, false);
    await assert.rejects(access(dataDir), { code: "ENOENT" });
    await assert.rejects(run(["config", "set"]), (error) => error.code === 1);
    await assert.rejects(
      run(["start"]),
      (error) => error.code === 1 && /Database not found/.test(error.stderr),
    );
    await assert.rejects(
      run(["init", "--port", "0"]),
      (error) => error.code === 1,
    );
    await run(["init", "--port", String(port)]);
    const secretsText = await readFile(
        join(dataDir, "credentials.json"),
        "utf8",
      ),
      secrets = JSON.parse(secretsText);
    const configText = await readFile(join(dataDir, "config.json"), "utf8");
    assert.deepEqual(JSON.parse(configText), { host: "127.0.0.1", port });
    assert(!configText.includes(secrets.admin.token));
    const shown = (await run(["config", "show"])).stdout;
    assert.equal(JSON.parse(shown).port, port);
    assert.equal(JSON.parse(shown).database, join(dataDir, "portal.sqlite"));
    assert.equal(JSON.parse(shown).database_exists, true);
    for (const credential of Object.values(secrets))
      assert(!shown.includes(credential.token));

    await run(["init"]);
    assert.equal(
      await readFile(join(dataDir, "credentials.json"), "utf8"),
      secretsText,
    );
    assert.equal(JSON.parse((await run(["token", "list"])).stdout).length, 3);
    const start = async () => {
      child = spawn(process.execPath, [bin, "start", "--data-dir", dataDir], {
        cwd: dir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stdout.resume();
      child.stderr.on("data", (chunk) => (stderr += chunk));
      completed = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal }));
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw Error(`Server exited: ${stderr}`);
        try {
          const response = await fetch(base + "/v1/capabilities", {
            headers: { Authorization: `Bearer ${secrets.reader.token}` },
            signal: AbortSignal.timeout(300),
          });
          if (response.ok) return;
        } catch {}
        await pause(50);
      }
      throw Error(`Server failed to start: ${stderr}`);
    };
    const get = async (path) => {
      const response = await fetch(base + path, {
        headers: { Authorization: `Bearer ${secrets.reader.token}` },
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await start();
    await assert.rejects(
      run(["start"]),
      (error) =>
        error.code === 1 && /Port is already in use/.test(error.stderr),
    );
    await run(["demo", "running"]);
    await run(["demo", "completed"]);
    const snapshot = await get("/v1/topics/demo/sync");
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].revision, 2);
    assert.equal(snapshot.notifications.length, 1);
    const history = await get("/v1/topics/demo/history");
    assert.equal(history.events.length, 3);
    // An open SSE connection must not prevent shutdown under a process manager.
    await run(["demo", "showcase"]);
    const showcase = await get("/v1/topics/demo/sync");
    assert.equal(showcase.items.length, 4);
    assert(showcase.items.some((item) => item.id === "morning-reading"));
    assert(showcase.items.some((item) => item.id === "night-watch"));
    assert(showcase.items.some((item) => item.id === "travel-archive"));
    assert.equal(showcase.notifications.length, 3);
    // Preserve the original package persistence assertions below with the expanded snapshot.
    snapshot.items = showcase.items;
    history.events = (await get("/v1/topics/demo/history")).events;
    const stream = await fetch(base + "/v1/topics/demo/stream", {
      headers: { Authorization: `Bearer ${secrets.reader.token}` },
      signal: AbortSignal.timeout(10000),
    });
    const reader = stream.body.getReader();
    await reader.read();
    assert.equal((await stop()).code, 0);
    await reader.cancel();
    await npm([
      "uninstall",
      "--global",
      "--prefix",
      prefix,
      "agent-portal-server",
    ]);
    assert.equal(
      await readFile(join(dataDir, "credentials.json"), "utf8"),
      secretsText,
    );
    await install();
    await start();
    assert.deepEqual((await get("/v1/topics/demo/sync")).items, snapshot.items);
    assert.deepEqual(
      (await get("/v1/topics/demo/history")).events,
      history.events,
    );
    await stop("SIGKILL");
    await start();
    assert.equal(
      (await get("/v1/topics/demo/sync")).items.find(
        (item) => item.id === "demo-report",
      ).revision,
      2,
    );
    const created = JSON.parse(
      (await run(["token", "create", "write", "demo"])).stdout,
    );
    await run(["token", "revoke", created.id]);
    assert.equal(
      JSON.parse((await run(["token", "list"])).stdout).find(
        (row) => row.id === created.id,
      ).revoked,
      1,
    );
    await run(["init"]);
    assert.equal(
      await readFile(join(dataDir, "config.json"), "utf8"),
      configText,
    );
    await stop();
  },
);

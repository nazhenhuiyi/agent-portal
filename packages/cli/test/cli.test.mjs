import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Store, hash } from "../../../server/dist/store.js";
import { createApp } from "../../../server/dist/app.js";
const bin = fileURLToPath(new URL("../bin/agent-portal.mjs", import.meta.url));
const run = (args, connection = [], input = "") =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args, ...connection], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout,
        stderr,
        json: JSON.parse(code === 0 ? stdout : stderr),
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), "portal-cli-"));
  const store = new Store(join(dir, "db.sqlite"));
  const app = createApp(store);
  const admin = store.issue(["admin"], []),
    writer = store.issue(["write"], ["demo"]),
    reader = store.issue(["read"], ["demo"]);
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(async () => {
    await app.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const config = join(dir, "config.json");
  // Persist the address once; HTTP tests use isolated token files to run on CI
  // without an unlocked desktop credential store.
  assert.equal(
    (await run(["config", "set", "--server", base, "--config", config])).code,
    0,
  );
  const tokenFiles = new Map();
  for (const [name, credential] of Object.entries({ admin, writer, reader })) {
    const file = join(dir, name + ".token");
    await writeFile(file, credential.token, { mode: 0o600 });
    tokenFiles.set(credential.token, file);
  }
  const call = (args, input = "", token = writer.token) =>
    run(
      args,
      [
        "--config",
        config,
        ...(args.includes("--token-file")
          ? []
          : ["--token-file", tokenFiles.get(token)]),
      ],
      input,
    );
  const created = await call(
    ["topic", "put", "demo", "--file", "-"],
    '{"name":"Demo"}',
    admin.token,
  );
  assert.equal(created.code, 0);
  return { dir, store, call, admin, reader, writer, base };
}

test("publishes independent resources, retries once logically and preserves atomic conditions", async (t) => {
  const { call, store, reader } = await harness(t);
  const notify = [
    "notify",
    "demo",
    "backup",
    "--title",
    "备份失败",
    "--body",
    "请看日志",
    "--key",
    "run-1",
  ];
  const first = await call(notify);
  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.json.data.content.title, "备份失败");
  assert.equal(first.json.etag, '"1"');
  assert.equal(first.json.idempotency_key, "run-1");
  assert.equal(store.sync("demo").items.length, 0);
  assert.deepEqual((await call(notify)).json, first.json);
  assert.equal(store.history("demo").events.length, 1);
  const item = await call(
    [
      "item",
      "put",
      "demo",
      "backup",
      "--file",
      "-",
      "--key",
      "item-1",
      "--if-revision",
      "0",
    ],
    '{"content":{"title":"独立展示","data":{"progress":0.5}}}',
  );
  assert.equal(item.code, 0);
  const combined = {
    item: { id: "backup", if_revision: 1, content: { title: "全部完成" } },
    notification: {
      id: "backup",
      if_revision: 99,
      content: { title: "完成提醒" },
    },
  };
  const conflict = await call(
    ["publish", "demo", "--file", "-", "--key", "combined"],
    JSON.stringify(combined),
  );
  assert.equal(conflict.code, 1);
  assert.equal(conflict.json.error.http_status, 412);
  assert.equal(store.sync("demo").items[0].revision, 1);
  combined.notification.if_revision = 1;
  const both = await call(
    ["publish", "demo", "--file", "-", "--key", "combined"],
    JSON.stringify(combined),
  );
  assert.equal(both.code, 0);
  assert.equal(both.json.data.item.revision, 2);
  assert.equal(both.json.data.notification.revision, 2);
  assert.equal(
    (await call(["notification", "clear", "demo", "backup", "--key", "clear"]))
      .code,
    0,
  );
  assert.equal(store.sync("demo").items.length, 1);
  assert.equal(store.sync("demo").notifications.length, 0);
  const history = await call(
    ["history", "demo", "--notification", "backup"],
    "",
    reader.token,
  );
  assert.equal(history.code, 0);
  assert(
    history.json.data.events.every((e) => e.type.startsWith("notification.")),
  );
  assert.equal(
    (
      await call([
        "item",
        "delete",
        "demo",
        "backup",
        "--key",
        "delete",
        "--if-revision",
        "2",
      ])
    ).code,
    0,
  );
  assert.equal(store.sync("demo").items.length, 0);
});

test("file and token inputs, permissions, snapshots and cursor pagination", async (t) => {
  const { call, dir, reader, writer } = await harness(t);
  const tokenFile = join(dir, "reader.token");
  await writeFile(tokenFile, reader.token, { mode: 0o600 });
  const snapshot = await call(["sync", "demo", "--token-file", tokenFile]);
  assert.equal(snapshot.code, 0);
  assert.equal(snapshot.json.data.mode, "snapshot");
  const contentFile = join(dir, "request.json");
  await writeFile(
    contentFile,
    '{"content":{"title":"From file"},"mode":"silent"}',
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await call([
          "notification",
          "put",
          "demo",
          "file",
          "--file",
          contentFile,
          "--key",
          `file-${i}`,
        ])
      ).code,
      0,
    );
  let cursor = snapshot.json.data.next_cursor,
    events = [];
  for (let i = 0; i < 3; i++) {
    const page = await call(
      ["sync", "demo", "--cursor", cursor, "--limit", "1"],
      "",
      reader.token,
    );
    assert.equal(page.code, 0);
    events.push(...page.json.data.events);
    cursor = page.json.data.next_cursor;
    assert.equal(page.json.data.has_more, i < 2);
  }
  assert.deepEqual(
    events.map((e) => e.revision),
    [1, 2, 3],
  );
  const forbidden = await call(
    ["notify", "demo", "x", "--title", "No", "--key", "no"],
    "",
    reader.token,
  );
  assert.equal(forbidden.code, 1);
  assert.equal(forbidden.json.error.http_status, 403);
  assert(!forbidden.stderr.includes(reader.token));
  assert.equal(
    (await call(["notification", "get", "demo", "file"], "", writer.token)).json
      .error.http_status,
    403,
  );
  const duplicate = await call(
    ["item", "put", "demo", "bad", "--file", "-", "--key", "bad"],
    '{"content":{"title":"a","title":"b"}}',
  );
  assert.equal(duplicate.json.error.code, "invalid_json");
});

test("template and static asset operations use the HTTP API", async (t) => {
  const { call, admin, reader, dir } = await harness(t);
  const template = await readFile(
    new URL("../../../examples/protocol/template.json", import.meta.url),
    "utf8",
  );
  assert.equal(
    (
      await call(
        ["template", "put", "report-card", "1", "--file", "-"],
        template,
        admin.token,
      )
    ).code,
    0,
  );
  assert.equal(
    (await call(["template", "get", "report-card", "1"], "", reader.token)).json
      .data.id,
    "report-card",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==",
    "base64",
  );
  const id = hash(png),
    output = join(dir, "download.png");
  const upload = await call(
    ["asset", "put", id, "--file", "-", "--type", "image/png"],
    png,
    admin.token,
  );
  assert.equal(upload.code, 0, upload.stderr);
  const download = await call(
    ["asset", "get", id, "--output", output],
    "",
    reader.token,
  );
  assert.equal(download.code, 0);
  assert.deepEqual(await readFile(output), png);
  assert.equal(
    (await call(["asset", "get", id, "--output", output], "", reader.token))
      .code,
    2,
  );
});

test("invalid arguments fail locally and network outcomes are explicit without retry", async (t) => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"ok":');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const dir = await mkdtemp(join(tmpdir(), "portal-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const token = "test-secret";
  const tokenFile = join(dir, "token");
  await writeFile(tokenFile, token, { mode: 0o600 });
  const connection = [
    "--config",
    join(dir, "config.json"),
    "--server",
    `http://127.0.0.1:${server.address().port}`,
    "--token-file",
    tokenFile,
  ];
  for (const args of [
    ["notify", "demo", "x", "--title", "Test"],
    ["notify", "demo", "x", "--title", "Test", "--key", "a", "--key", "b"],
    ["item", "delete", "demo", "x", "--key", "a", "--if-revision", "0"],
    ["sync", "demo", "--limit", "2"],
    ["history", "demo", "--item", "x", "--notification", "x"],
    ["publish", "demo", "--file", "-", "--key", "x", "--if-revision", "1"],
  ]) {
    const r = await run(args, connection);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
  }
  assert.equal(requests, 0);
  const failed = await run(
    [
      "notify",
      "demo",
      "x",
      "--title",
      "Test",
      "--key",
      "stable-key",
      "--timeout",
      "100",
    ],
    connection,
  );
  assert.equal(failed.code, 3);
  assert.equal(failed.json.idempotency_key, "stable-key");
  assert.equal(requests, 1);
  assert(!failed.stderr.includes(token));
});

test("missing connection settings provide actionable errors before reading input or sending HTTP", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portal-missing-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, "config.json");
  const connection = ["--config", config];
  const both = await run(["topics"], connection);
  assert.equal(both.code, 2);
  assert.equal(both.json.error.code, "missing_configuration");
  assert.match(
    both.json.error.message,
    /agent-portal config set --server URL --token-file FILE/,
  );
  assert.equal(both.stdout, "");
  const missingBody = await run(
    [
      "item",
      "put",
      "demo",
      "x",
      "--file",
      join(dir, "absent.json"),
      "--key",
      "x",
    ],
    connection,
  );
  assert.equal(missingBody.json.error.code, "missing_configuration");
  const missingServer = await run(
    ["topics", "--token-file", join(dir, "absent.token")],
    connection,
  );
  assert.equal(missingServer.json.error.code, "missing_server");
  const setup = await run(
    ["config", "set", "--token-file", "-"],
    connection,
    "test-token",
  );
  assert.equal(setup.json.error.code, "missing_server");
  const show = await run(["config", "show"], connection);
  assert.equal(show.json.data.server, null);
  assert.equal(show.json.data.configured, false);
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (await run(["config", "set", "--server", base], connection)).code,
    0,
  );
  const missingToken = await run(["topics"], connection);
  assert.equal(missingToken.code, 2);
  assert.equal(missingToken.json.error.code, "missing_token");
  assert.match(missingToken.json.error.message, /Token is not configured/);
  assert.equal(requests, 0);
});

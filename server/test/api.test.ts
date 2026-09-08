import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { Store, hash } from "../src/store.js";
import { limits, check } from "../src/validation.js";
async function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "portal-")),
    s = new Store(join(dir, "db.sqlite")),
    a = createApp(s),
    admin = s.issue(["admin"], []),
    writer = s.issue(["write"], ["demo"]),
    reader = s.issue(["read"], ["demo"]);
  t.after(async () => {
    await a.close();
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (
    method: any,
    url: string,
    body?: any,
    key = "key",
    token = admin.token,
    extra: any = {},
  ) =>
    a.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key,
        ...extra,
      },
      ...(body === undefined ? {} : { payload: body }),
    });
  await call("PUT", "/v1/topics/demo", { name: "Demo" });
  return { s, a, admin, writer, reader, call };
}
const path = "/v1/topics/demo/items/report";
const publish = (title = "Running") => ({ content: { title } });
test("atomic writes, conditional retries, history, deletion and resurrection", async (t) => {
  const { s, call, writer, reader } = await harness(t);
  const first = await call("PUT", path, publish(), "a", writer.token, {
    "if-none-match": "*",
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().revision, 1);
  const snapshot = (
    await call("GET", "/v1/topics/demo/sync", undefined, "", reader.token)
  ).json();
  const second = await call("PUT", path, publish("Done"), "b", writer.token, {
    "if-match": '"1"',
  });
  assert.equal(second.statusCode, 200);
  const retry = await call("PUT", path, publish("Done"), "b", writer.token, {
    "if-match": '"1"',
  });
  assert.deepEqual(retry.json(), second.json());
  assert.equal(
    (await call("PUT", path, publish("Other"), "b", writer.token)).statusCode,
    409,
  );
  assert.equal(
    (
      await call("PUT", path, publish(), "c", writer.token, {
        "if-match": '"1"',
      })
    ).statusCode,
    412,
  );
  const delta = (
    await call(
      "GET",
      "/v1/topics/demo/sync?cursor=" + snapshot.next_cursor,
      undefined,
      "",
      reader.token,
    )
  ).json();
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0].item.revision, 2);
  assert.equal(
    (await call("DELETE", path, undefined, "del", writer.token)).statusCode,
    204,
  );
  assert.equal(
    (await call("GET", path, undefined, "", reader.token)).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", path, undefined, "del2", writer.token)).statusCode,
    204,
  );
  const restored = await call(
    "PUT",
    path,
    publish("Restored"),
    "restore",
    writer.token,
  );
  assert.equal(restored.json().revision, 4);
  assert.equal(restored.json().created_at, first.json().created_at);
  const history = (
    await call("GET", "/v1/topics/demo/history", undefined, "", reader.token)
  ).json();
  assert.deepEqual(
    history.events.map((x: any) => x.revision),
    [4, 3, 2, 1],
  );
  const persisted = new Store(s.filename);
  assert.equal(
    JSON.parse(
      (persisted.db.prepare("SELECT json FROM items").get() as any).json,
    ).revision,
    4,
  );
  persisted.close();
});
test("pagination high water, retention and cursor scope are explicit", async (t) => {
  const { s, call } = await harness(t);
  const start = (await call("GET", "/v1/topics/demo/sync")).json().next_cursor;
  for (let i = 0; i < 3; i++) await call("PUT", path, publish("" + i), "k" + i);
  const page1 = (
    await call("GET", "/v1/topics/demo/sync?limit=1&cursor=" + start)
  ).json();
  assert(page1.has_more);
  await call("PUT", path, publish("new"), "new");
  const page2 = (
    await call("GET", "/v1/topics/demo/sync?cursor=" + page1.next_cursor)
  ).json();
  assert.deepEqual(
    page2.events.map((e: any) => e.revision),
    [2, 3],
  );
  assert.equal(page2.has_more, false);
  const page3 = (
    await call("GET", "/v1/topics/demo/sync?cursor=" + page2.next_cursor)
  ).json();
  assert.equal(page3.events[0].revision, 4);
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync?cursor=bad")).statusCode,
    400,
  );
  await call("PUT", "/v1/topics/other", { name: "Other" });
  assert.equal(
    (await call("GET", "/v1/topics/other/sync?cursor=" + start)).statusCode,
    400,
  );
  const hist = (await call("GET", "/v1/topics/demo/history?limit=2")).json();
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync?cursor=" + hist.next_before))
      .statusCode,
    400,
  );
  s.cleanup(Date.now() + limits.history_retention_seconds * 1000 + 1000);
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync?cursor=" + start)).statusCode,
    410,
  );
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync")).json().items[0].revision,
    4,
  );
});
test("permissions, strict inputs, template immutability and PNG assets", async (t) => {
  const { call, writer, reader } = await harness(t);
  assert.equal(
    (await call("GET", path, undefined, "", writer.token)).statusCode,
    403,
  );
  assert.equal(
    (await call("PUT", path, publish(), "x", reader.token)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { content: { title: "x", unexpected: true } },
        "x",
      )
    ).statusCode,
    422,
  );
  const dup = await call(
    "PUT",
    path,
    '{"content":{"title":"a","title":"b"}}',
    "x",
    undefined,
    { "content-type": "application/json" },
  );
  assert.equal(dup.statusCode, 400);
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { content: { title: "x", data: { n: 9007199254740992 } } },
        "x",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync?curser=x")).statusCode,
    400,
  );
  const template = JSON.parse(
    readFileSync(
      new URL("../../examples/protocol/template.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    (await call("PUT", "/v1/templates/report-card/versions/1", template))
      .statusCode,
    201,
  );
  assert.equal(
    (await call("PUT", "/v1/templates/report-card/versions/1", template))
      .statusCode,
    200,
  );
  const bad = structuredClone(template);
  bad.widget.children[0].style = "caption";
  assert.equal(
    (await call("PUT", "/v1/templates/report-card/versions/1", bad)).statusCode,
    409,
  );
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#246b5e" },
  })
    .png()
    .toBuffer();
  const id = hash(png);
  assert.equal(
    (
      await call("PUT", "/v1/assets/" + id, png, "x", undefined, {
        "content-type": "image/png",
      })
    ).statusCode,
    201,
  );
  assert.deepEqual(
    (await call("GET", "/v1/assets/" + id, undefined, "", reader.token))
      .rawPayload,
    png,
  );
});
test("concurrent retry has one event and SSE reconnect starts with a sync hint", async (t) => {
  const { a, s, admin, call } = await harness(t);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => call("PUT", path, publish(), "same")),
  );
  assert(responses.every((r) => r.statusCode === 201));
  assert.equal(
    (s.db.prepare("SELECT COUNT(*) AS n FROM events").get() as any).n,
    1,
  );
  await a.listen({ host: "127.0.0.1", port: 0 });
  const address = a.server.address() as any;
  const abort = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/v1/topics/demo/stream`,
    {
      headers: { authorization: `Bearer ${admin.token}` },
      signal: abort.signal,
    },
  );
  const stream = response.body!.getReader();
  const chunk = await stream.read();
  assert(new TextDecoder().decode(chunk.value).includes("sync_required"));
  await call("PUT", path, publish("done"), "next");
  assert(
    new TextDecoder()
      .decode((await stream.read()).value)
      .includes("sync_required"),
  );
  abort.abort();
});

test("independent notifications and display items, atomic combined publication and recovery", async (t) => {
  const { call, s, reader, writer } = await harness(t);
  const np = "/v1/topics/demo/notifications/report";
  const start = (await call("GET", "/v1/topics/demo/sync")).json().next_cursor;
  const n = {
    content: {
      title: "备份失败",
      body: "请查看日志",
      link: { type: "url", url: "https://example.com/failure" },
    },
  };
  const first = await call("PUT", np, n, "notification", writer.token);
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().mode, "alert");
  check("Notification", first.json());
  assert.equal((await call("GET", path)).statusCode, 404);
  assert.deepEqual(
    (await call("GET", "/v1/topics/demo/sync")).json().items,
    [],
  );
  const retry = await call("PUT", np, n, "notification", writer.token);
  assert.deepEqual(retry.json(), first.json());
  assert.equal(
    (await call("PUT", np, n, "stale", writer.token, { "if-match": '"2"' }))
      .statusCode,
    412,
  );
  assert.equal(
    (await call("PUT", np, n, "reader", reader.token)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "PUT",
        "/v1/topics/demo/notifications/invalid",
        { content: { title: "x", data: {} } },
        "invalid",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PUT",
        np,
        { content: { title: "x", body: "猫".repeat(501) } },
        "long",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PUT",
        np,
        {
          content: {
            title: "x",
            link: { type: "url", url: "https://user:pass@example.com" },
          },
        },
        "url",
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "PUT",
        path,
        { content: { title: "x" }, notify: { mode: "alert" } },
        "old",
      )
    ).statusCode,
    422,
  );
  await call(
    "PUT",
    path,
    {
      content: {
        title: "Agent 总览",
        body: "运行正常",
        data: { progress: 0.5, count: 12 },
        link: { type: "url", url: "https://example.com/overview" },
      },
    },
    "item",
  );
  assert.deepEqual((await call("GET", np)).json(), first.json());
  const combined = {
    item: {
      id: "report",
      content: { title: "日报详情", data: { count: 12 } },
      if_revision: 1,
    },
    notification: {
      id: "report",
      ...n,
      content: { title: "日报已完成" },
      if_revision: 1,
    },
  };
  const wrong = structuredClone(combined);
  wrong.notification.if_revision = 5;
  const count = () =>
    (s.db.prepare("SELECT COUNT(*) AS n FROM events").get() as any).n;
  const before = count();
  assert.equal(
    (await call("POST", "/v1/topics/demo/publish", wrong, "rollback"))
      .statusCode,
    412,
  );
  assert.equal((await call("GET", path)).json().revision, 1);
  assert.equal(count(), before);
  const both = await call(
    "POST",
    "/v1/topics/demo/publish",
    combined,
    "both",
    writer.token,
  );
  assert.equal(both.statusCode, 200);
  check("PublicationResult", both.json());
  assert.equal(both.json().item.revision, 2);
  assert.equal(both.json().notification.revision, 2);
  assert.notEqual(
    both.json().notification.content.title,
    both.json().item.content.title,
  );
  assert.deepEqual(
    (
      await call(
        "POST",
        "/v1/topics/demo/publish",
        combined,
        "both",
        writer.token,
      )
    ).json(),
    both.json(),
  );
  assert.equal(count(), before + 2);
  assert.equal(
    (await call("POST", "/v1/topics/demo/publish", {}, "empty")).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/v1/topics/demo/publish",
        combined,
        "header",
        undefined,
        { "if-match": '"2"' },
      )
    ).statusCode,
    400,
  );
  // Clearing a notification retains the display item; deleting an item retains its notifications.
  await call("DELETE", np, undefined, "clear");
  assert.equal((await call("GET", path)).json().revision, 2);
  assert.equal((await call("GET", np)).statusCode, 404);
  const resurrected = await call("PUT", np, n, "restore");
  assert.equal(resurrected.json().revision, 4);
  await call("DELETE", path, undefined, "delete-item");
  assert.equal((await call("GET", np)).json().revision, 4);
  const history = (
    await call("GET", "/v1/topics/demo/history?notification_id=report")
  ).json();
  assert(history.events.every((e: any) => e.type.startsWith("notification.")));
  assert(history.events.some((e: any) => e.type === "notification.cleared"));
  const itemHistory = (
    await call("GET", "/v1/topics/demo/history?item_id=report")
  ).json();
  assert(itemHistory.events.every((e: any) => e.type.startsWith("item.")));
  // Mixed stream paginates without loss; the same resource ID in both namespaces cannot collide.
  const events: any[] = [];
  let cursor = start;
  let more = true;
  while (more) {
    const page = (
      await call("GET", "/v1/topics/demo/sync?limit=1&cursor=" + cursor)
    ).json();
    check("SyncResponse", page);
    events.push(...page.events);
    cursor = page.next_cursor;
    more = page.has_more;
  }
  assert.equal(events.length, count());
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  const persisted = new Store(s.filename);
  assert.equal(persisted.sync("demo").notifications[0].revision, 4);
  persisted.close();
  s.db.prepare("UPDATE meta SET value='new-epoch' WHERE key='epoch'").run();
  assert.equal(
    (await call("GET", "/v1/topics/demo/sync?cursor=" + cursor)).statusCode,
    410,
  );
  const snapshot = (await call("GET", "/v1/topics/demo/sync")).json();
  check("Snapshot", snapshot);
  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.notifications[0].revision, 4);
});

test("legacy database migrates reminders without losing items or history", async (t) => {
  const { s, call } = await harness(t);
  await call("PUT", path, publish("Old item"), "legacy");
  const cursor = s.sync("demo").next_cursor;
  const row = s.db.prepare("SELECT * FROM events").get() as any;
  const e = JSON.parse(row.json);
  e.notification = {
    mode: "alert",
    expires_at: new Date(Date.now() + 600000).toISOString(),
  };
  s.db
    .prepare("UPDATE events SET json=? WHERE seq=?")
    .run(JSON.stringify(e), row.seq);
  s.db.prepare("UPDATE meta SET value='1' WHERE key='schema_version'").run();
  const migrated = new Store(s.filename);
  assert.equal(migrated.sync("demo").items[0].content.title, "Old item");
  assert.equal(
    migrated.sync("demo").notifications[0].content.title,
    "Old item",
  );
  assert.equal(migrated.history("demo").events.length, 2);
  assert.throws(
    () => migrated.sync("demo", cursor),
    (e: any) => e.status === 410,
  );
  migrated.close();
});

import Fastify, {
  type FastifyRequest,
  type FastifyReply,
  type FastifyError,
} from "fastify";
import sharp, { type Metadata } from "sharp";
import { Store, hash, type Token } from "./store.js";
import {
  ApiError,
  fail,
  check,
  strictJSON,
  normalizeItem,
  normalizeNotification,
  normalizePublication,
  templateCheck,
  canonical,
  limits,
  features,
  type ResourceInput,
} from "./validation.js";
declare module "fastify" {
  interface FastifyRequest {
    principal: Token | null;
  }
}

export function createApp(store: Store) {
  const app = Fastify({
    bodyLimit: limits.request_bytes,
    logger: false,
  });
  const streams = new Map<
    string,
    Set<{ reply: FastifyReply; token: string }>
  >();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      try {
        done(null, strictJSON(body as Buffer));
      } catch (e) {
        done(e as Error);
      }
    },
  );
  app.addContentTypeParser(
    ["image/png", "image/webp"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.setErrorHandler((e: FastifyError, req, reply) => {
    let status = e.statusCode ?? 500;
    let code = "invalid_request";
    if (e instanceof ApiError) {
      status = e.status;
      code = e.code;
    } else if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      status = 413;
      code = "request_too_large";
    } else if (e.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      status = 415;
      code = "unsupported_media_type";
    } else if (status < 400 || status >= 500) {
      status = 500;
      code = "internal_error";
    }
    reply.code(status).send({
      error: {
        code,
        message: status === 500 ? "Internal error" : e.message,
        request_id: req.id,
      },
    });
    if (status === 500) console.error(e);
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: "not_found", message: "Not found", request_id: req.id },
    }),
  );
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) fail(401, "unauthorized");
    req.principal = store.auth(auth.slice(7));
  });
  const principal = (r: FastifyRequest): Token => {
    if (!r.principal) fail(401, "unauthorized");
    return r.principal;
  };
  function scope(r: FastifyRequest, role = "read") {
    const p = r.params as Record<string, string>;
    if (p.topic) check("TopicId", p.topic);
    if (p.id) check("ItemId", p.id);
    store.permit(principal(r), role, p.topic);
    if (p.topic) store.topic(p.topic);
    return p;
  }
  function query(r: FastifyRequest, keys: string[]) {
    for (const k of Object.keys(r.query ?? {}))
      if (!keys.includes(k)) fail(400, "invalid_query");
    return r.query as Record<string, string>;
  }
  function page(v: unknown, fallback: number, max: number) {
    if (v === undefined) return fallback;
    if (
      typeof v !== "string" ||
      !/^\d+$/.test(v) ||
      Number(v) < 1 ||
      Number(v) > max
    )
      fail(400, "invalid_query");
    return Number(v);
  }
  function conditions(r: FastifyRequest, deleting = false) {
    const key = r.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[!-~]{1,128}$/.test(key))
      fail(400, "invalid_idempotency_key");
    const match = r.headers["if-match"],
      none = r.headers["if-none-match"];
    if (
      (match !== undefined &&
        (typeof match !== "string" || !/^"[1-9][0-9]*"$/.test(match))) ||
      (none !== undefined && none !== "*") ||
      (none && match) ||
      (deleting && none)
    )
      fail(400, "invalid_condition");
    return {
      key,
      condition: { ...(match ? { match } : {}), ...(none ? { none } : {}) },
    };
  }
  function ping(topic: string) {
    for (const c of streams.get(topic) ?? [])
      if (
        !c.reply.raw.write(
          `event: sync_required\ndata: ${JSON.stringify({ topic_id: topic })}\n\n`,
        )
      )
        c.reply.raw.end();
  }
  function respondToWrite(
    reply: FastifyReply,
    topic: string,
    result: ReturnType<Store["write"]>,
  ) {
    if (result.changed) ping(topic);
    return reply.code(result.status).headers(result.headers).send(result.body);
  }
  app.get("/v1/capabilities", async (r) => {
    query(r, []);
    return {
      api_version: "v1",
      template_renderer_versions: [1],
      template_features: features,
      limits,
    };
  });
  app.get("/v1/topics", async (r) => {
    query(r, []);
    const t = principal(r);
    store.permit(t, "read");
    return {
      topics: (
        store.db
          .prepare("SELECT id,name,description FROM topics ORDER BY id")
          .all() as any[]
      ).filter((x) => t.roles.includes("admin") || t.topics.includes(x.id)),
    };
  });
  app.put("/v1/topics/:topic", async (r, reply) => {
    query(r, []);
    store.permit(principal(r), "admin");
    const { topic } = r.params as { topic: string };
    check("TopicId", topic);
    check("TopicInput", r.body);
    const b = r.body as any;
    const existed = store.db
      .prepare("SELECT 1 FROM topics WHERE id=?")
      .get(topic);
    store.db
      .prepare(
        "INSERT INTO topics(id,name,description) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description",
      )
      .run(topic, b.name, b.description ?? "");
    return reply.code(existed ? 200 : 201).send(store.topic(topic));
  });
  function validateTemplate(content: ResourceInput["content"]) {
    if (
      content.template &&
      !store.db
        .prepare("SELECT 1 FROM templates WHERE id=? AND version=?")
        .get(content.template.id, content.template.version)
    )
      fail(422, "template_not_found");
  }
  app.post("/v1/topics/:topic/publish", async (r, reply) => {
    query(r, []);
    const { topic } = scope(r, "write"),
      { key, condition } = conditions(r);
    if (condition.match || condition.none)
      fail(
        400,
        "invalid_condition",
        "Use per-resource if_revision for a combined publication",
      );
    const body = normalizePublication(r.body);
    if (body.item) validateTemplate(body.item.content);
    const result = store.publish(principal(r), topic, key, body);
    return respondToWrite(reply, topic, result);
  });
  // The two independent resources share HTTP mechanics, not identity or content.
  for (const kind of ["item", "notification"] as const) {
    const path = `/v1/topics/:topic/${kind === "item" ? "items" : "notifications"}/:id`;
    app.get(path, async (request, reply) => {
      query(request, []);
      const { topic, id } = scope(request);
      const value = store.resource({ kind, topic, id });
      return reply.header("ETag", `"${value.revision}"`).send(value);
    });
    app.put(path, async (request, reply) => {
      query(request, []);
      const { topic, id } = scope(request, "write");
      const { key, condition } = conditions(request);
      const body =
        kind === "item"
          ? normalizeItem(request.body)
          : normalizeNotification(request.body);
      if (kind === "item") validateTemplate(body.content);
      const result = store.write({
        token: principal(request),
        topic,
        id,
        kind,
        key,
        body,
        condition,
      });
      return respondToWrite(reply, topic, result);
    });
    app.delete(path, async (request, reply) => {
      query(request, []);
      const { topic, id } = scope(request, "write");
      const { key, condition } = conditions(request, true);
      if (request.body !== undefined) fail(400, "unexpected_body");
      const result = store.write({
        token: principal(request),
        topic,
        id,
        kind,
        key,
        body: null,
        condition,
      });
      return respondToWrite(reply, topic, result);
    });
  }
  app.get("/v1/topics/:topic/sync", async (r) => {
    const { topic } = scope(r),
      q = query(r, ["cursor", "limit"]);
    if (q.limit !== undefined && q.cursor === undefined)
      fail(400, "invalid_query");
    if (q.cursor !== undefined && (!q.cursor || typeof q.cursor !== "string"))
      fail(400, "invalid_cursor");
    return store.sync(topic, q.cursor, page(q.limit, 100, 500));
  });
  app.get("/v1/topics/:topic/history", async (r) => {
    const { topic } = scope(r),
      q = query(r, ["item_id", "notification_id", "before", "limit"]);
    if (q.item_id !== undefined) check("ItemId", q.item_id);
    if (q.notification_id !== undefined)
      check("NotificationId", q.notification_id);
    if (q.item_id && q.notification_id) fail(400, "invalid_query");
    if (q.before !== undefined && (!q.before || typeof q.before !== "string"))
      fail(400, "invalid_cursor");
    return store.history(topic, {
      item: q.item_id,
      notification: q.notification_id,
      before: q.before,
      limit: page(q.limit, 50, 100),
    });
  });
  app.get("/v1/topics/:topic/stream", async (r, reply) => {
    const { topic } = scope(r);
    query(r, []);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client = { reply, token: principal(r).id };
    if (!streams.has(topic)) streams.set(topic, new Set());
    streams.get(topic)!.add(client);
    reply.raw.on("close", () => {
      streams.get(topic)?.delete(client);
      if (streams.get(topic)?.size === 0) streams.delete(topic);
    });
    reply.raw.write(
      `event: sync_required\ndata: ${JSON.stringify({ topic_id: topic })}\n\n`,
    );
  });
  function templatePath(r: FastifyRequest) {
    const { id, version } = r.params as Record<string, string>;
    check("TemplateId", id);
    if (!/^[1-9][0-9]*$/.test(version) || Number(version) > 2147483647)
      fail(400, "invalid_version");
    return { id, version: Number(version) };
  }
  app.put(
    "/v1/templates/:id/versions/:version",
    { bodyLimit: limits.template_bytes },
    async (r, reply) => {
      query(r, []);
      store.permit(principal(r), "admin");
      const p = templatePath(r),
        b = r.body as any;
      templateCheck(
        b,
        (id) => !!store.db.prepare("SELECT 1 FROM assets WHERE id=?").get(id),
      );
      if (b.id !== p.id || b.version !== p.version)
        fail(422, "template_identity_mismatch");
      const json = canonical(b),
        old = store.db
          .prepare("SELECT json FROM templates WHERE id=? AND version=?")
          .get(p.id, p.version) as any;
      if (old && old.json !== json) fail(409, "template_version_exists");
      if (!old)
        store.db
          .prepare("INSERT INTO templates VALUES (?,?,?)")
          .run(p.id, p.version, json);
      return reply.code(old ? 200 : 201).send(JSON.parse(json));
    },
  );
  app.get("/v1/templates/:id/versions/:version", async (r) => {
    query(r, []);
    store.permit(principal(r), "read");
    const p = templatePath(r),
      row = store.db
        .prepare("SELECT json FROM templates WHERE id=? AND version=?")
        .get(p.id, p.version) as any;
    if (!row) fail(404, "template_not_found");
    return JSON.parse(row.json);
  });
  app.put(
    "/v1/assets/:sha256",
    { bodyLimit: limits.asset_bytes },
    async (r, reply) => {
      query(r, []);
      store.permit(principal(r), "admin");
      const { sha256 } = r.params as { sha256: string };
      check("Sha256", sha256);
      if (!Buffer.isBuffer(r.body)) fail(415, "unsupported_media_type");
      if (hash(r.body) !== sha256) fail(422, "asset_hash_mismatch");
      let m: Metadata;
      try {
        m = await sharp(r.body, {
          limitInputPixels: limits.asset_max_dimension ** 2,
          animated: true,
        }).metadata();
        await sharp(r.body, {
          limitInputPixels: limits.asset_max_dimension ** 2,
        })
          .raw()
          .toBuffer();
      } catch {
        fail(422, "invalid_asset");
      }
      const mime =
        m.format === "png"
          ? "image/png"
          : m.format === "webp"
            ? "image/webp"
            : null;
      if (
        !mime ||
        mime !== r.headers["content-type"]?.split(";")[0] ||
        !m.width ||
        !m.height ||
        m.width > limits.asset_max_dimension ||
        m.height > limits.asset_max_dimension ||
        (m.pages ?? 1) > 1
      )
        fail(422, "invalid_asset");
      const metadata = {
        id: sha256,
        media_type: mime,
        bytes: r.body.length,
        width: m.width,
        height: m.height,
      };
      const result = store.db
        .prepare("INSERT OR IGNORE INTO assets VALUES (?,?,?)")
        .run(sha256, JSON.stringify(metadata), r.body);
      return reply.code(result.changes ? 201 : 200).send(metadata);
    },
  );
  app.get("/v1/assets/:sha256", async (r, reply) => {
    query(r, []);
    store.permit(principal(r), "read");
    const { sha256 } = r.params as { sha256: string };
    check("Sha256", sha256);
    const row = store.db
      .prepare("SELECT * FROM assets WHERE id=?")
      .get(sha256) as any;
    if (!row) fail(404, "asset_not_found");
    return reply
      .type(JSON.parse(row.metadata).media_type)
      .header("ETag", `"${sha256}"`)
      .send(row.bytes);
  });
  const heartbeat = setInterval(() => {
    for (const clients of streams.values())
      for (const c of clients)
        if (!store.active(c.token) || !c.reply.raw.write(": keepalive\n\n"))
          c.reply.raw.end();
  }, 15000);
  heartbeat.unref();
  const revoke = setInterval(() => {
    for (const clients of streams.values())
      for (const c of clients) if (!store.active(c.token)) c.reply.raw.end();
  }, 1000);
  revoke.unref();
  const cleanup = setInterval(() => store.cleanup(), 60000);
  cleanup.unref();
  app.addHook("preClose", async () => {
    for (const clients of streams.values())
      for (const c of clients) c.reply.raw.end();
  });
  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    clearInterval(revoke);
    clearInterval(cleanup);
  });
  return app;
}

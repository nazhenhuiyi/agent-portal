import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { migrate } from "./migrations.js";
import {
  canonical,
  fail,
  limits,
  type ResourceInput,
  type PublicationInput,
} from "./validation.js";
export type Token = { id: string; roles: string[]; topics: string[] };

type WriteResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  changed: boolean;
};
export type ResourceKind = "item" | "notification";
type Condition = { match?: string; none?: string };
type ResourceTarget = { topic: string; id: string; kind: ResourceKind };
type ResourceWrite = ResourceTarget & {
  body: ResourceInput | null;
  condition: Condition;
};
type WriteRequest = ResourceWrite & { token: Token; key: string };
type ResourceRow = { revision: number; created: string; json: string | null };
type EventRow = { seq: string; json: string };
const resourceTable = (kind: ResourceKind) =>
  kind === "item" ? "items" : "notifications";
const eventResourceKey = (kind: ResourceKind, id: string) =>
  kind === "item" ? id : "notification:" + id;

// Both sync and history obey the same event-count and encoded-byte limits.
function eventPage(rows: EventRow[], limit: number) {
  const events: unknown[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const size = Buffer.byteLength(row.json);
    if (bytes + size > limits.delta_bytes - 8192) break;
    events.push(JSON.parse(row.json));
    bytes += size;
  }
  const hasMore = rows.length > events.length;
  if (hasMore && !events.length) fail(409, "event_page_limit_exceeded");
  return { events, hasMore, last: rows[events.length - 1]?.seq };
}
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export class Store {
  db: Database.Database;
  constructor(public filename: string) {
    mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    chmodSync(filename, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    migrate(this.db);
  }
  getMeta(k: string) {
    return (this.db.prepare("SELECT value FROM meta WHERE key=?").get(k) as any)
      .value as string;
  }
  issue(roles: string[], topics: string[]) {
    const token = "portal_" + randomBytes(32).toString("base64url"),
      id = randomUUID();
    this.db
      .prepare("INSERT INTO tokens(id,hash,roles,topics) VALUES (?,?,?,?)")
      .run(id, hash(token), JSON.stringify(roles), JSON.stringify(topics));
    return { id, token, roles, topics };
  }
  auth(secret: string): Token {
    const t = this.db
      .prepare("SELECT * FROM tokens WHERE hash=? AND revoked=0")
      .get(hash(secret)) as any;
    if (!t) fail(401, "unauthorized");
    return {
      id: t.id,
      roles: JSON.parse(t.roles),
      topics: JSON.parse(t.topics),
    };
  }
  active(id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM tokens WHERE id=? AND revoked=0")
      .get(id);
  }
  permit(t: Token, role: string, topic?: string) {
    if (t.roles.includes("admin")) return;
    if (!t.roles.includes(role) || (topic && !t.topics.includes(topic)))
      fail(403, "forbidden");
  }
  topic(id: string) {
    const r = this.db
      .prepare("SELECT id,name,description FROM topics WHERE id=?")
      .get(id);
    if (!r) fail(404, "topic_not_found");
    return r;
  }
  private highWatermark(topic: string) {
    const r = this.db
      .prepare("SELECT CAST(MAX(seq) AS TEXT) AS n FROM events WHERE topic=?")
      .get(topic) as any;
    const w = this.watermark(topic);
    return r.n && BigInt(r.n) > w ? BigInt(r.n) : w;
  }
  watermark(topic: string) {
    return BigInt(
      (
        this.db
          .prepare("SELECT watermark FROM topics WHERE id=?")
          .get(topic) as any
      ).watermark,
    );
  }
  private encodeCursor(payload: any) {
    const raw = Buffer.from(
      JSON.stringify({ ...payload, epoch: this.getMeta("epoch") }),
    ).toString("base64url");
    return (
      raw +
      "." +
      createHmac("sha256", this.getMeta("cursor_key"))
        .update(raw)
        .digest("base64url")
    );
  }
  private decodeCursor(raw: string, type: string, topic: string): any {
    try {
      if (raw.length > 2048) throw 0;
      const [p, s, ...rest] = raw.split(".");
      const expected = createHmac("sha256", this.getMeta("cursor_key"))
        .update(p)
        .digest();
      const actual = Buffer.from(s ?? "", "base64url");
      if (
        rest.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw 0;
      const v = JSON.parse(Buffer.from(p, "base64url").toString());
      if (v.kind !== type || v.topic !== topic) throw 0;
      if (v.epoch !== this.getMeta("epoch"))
        fail(
          type === "sync" ? 410 : 400,
          type === "sync" ? "cursor_expired" : "invalid_cursor",
        );
      for (const k of ["pos", "end", "before"])
        if (
          v[k] !== undefined &&
          (!/^(0|[1-9][0-9]*)$/.test(v[k]) ||
            BigInt(v[k]) > 9223372036854775807n)
        )
          throw 0;
      return v;
    } catch (e: any) {
      if (e?.status) throw e;
      fail(400, "invalid_cursor");
    }
  }
  private idempotent(
    t: Token,
    key: string,
    request: unknown,
    action: () => WriteResult,
  ) {
    const digest = hash(canonical(request));
    return this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM idem WHERE token=? AND key=? AND time<?")
        .run(
          t.id,
          key,
          Date.now() - limits.idempotency_retention_seconds * 1000,
        );
      const prior = this.db
        .prepare("SELECT * FROM idem WHERE token=? AND key=?")
        .get(t.id, key) as { digest: string; response: string } | undefined;
      if (prior) {
        if (prior.digest !== digest) fail(409, "idempotency_conflict");
        const saved = JSON.parse(prior.response) as WriteResult;
        return { ...saved, changed: false };
      }
      const result = action();
      this.db
        .prepare("INSERT INTO idem VALUES (?,?,?,?,?)")
        .run(t.id, key, digest, JSON.stringify(result), Date.now());
      return result;
    })();
  }
  resource({ kind, topic, id }: ResourceTarget) {
    const row = this.db
      .prepare(
        `SELECT json FROM ${resourceTable(kind)} WHERE topic=? AND id=? AND json IS NOT NULL`,
      )
      .get(topic, id) as { json: string } | undefined;
    if (!row) fail(404, `${kind}_not_found`);
    return JSON.parse(row.json) as { revision: number };
  }
  write({ token, key, ...write }: WriteRequest) {
    const { kind, topic, id, body, condition } = write;
    return this.idempotent(
      token,
      key,
      {
        kind,
        method: body === null ? "DELETE" : "PUT",
        topic,
        id,
        body,
        condition,
      },
      () => this.mutate(write),
    );
  }
  publish(t: Token, topic: string, key: string, body: PublicationInput) {
    return this.idempotent(t, key, { method: "POST", topic, body }, () => {
      const result: Record<string, unknown> = {};
      for (const kind of ["item", "notification"] as const) {
        const publication = body[kind];
        if (!publication) continue;
        const { id, if_revision, ...input } = publication;
        const condition =
          if_revision === undefined
            ? {}
            : if_revision === 0
              ? { none: "*" }
              : { match: `"${if_revision}"` };
        result[kind] = this.mutate({
          topic,
          id,
          body: input,
          condition,
          kind,
        }).body;
      }
      return { status: 200, headers: {}, body: result, changed: true };
    });
  }
  private mutate({
    topic,
    id,
    body,
    condition,
    kind,
  }: ResourceWrite): WriteResult {
    const deleting = body === null;
    const table = resourceTable(kind);
    const old = this.db
      .prepare(`SELECT * FROM ${table} WHERE topic=? AND id=?`)
      .get(topic, id) as ResourceRow | undefined;
    if (
      condition.match &&
      (!old?.json || String(old.revision) !== condition.match.slice(1, -1))
    )
      fail(412, "revision_mismatch");
    if (condition.none && old?.json) fail(412, "revision_mismatch");
    if (deleting && !old?.json)
      return { status: 204, headers: {}, body: null, changed: false };
    if (old && old.revision >= Number.MAX_SAFE_INTEGER)
      fail(409, "revision_exhausted");
    if (!deleting && !old?.json) {
      const n = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE topic=? AND json IS NOT NULL`,
          )
          .get(topic) as any
      ).n;
      if (
        n >=
        (kind === "item"
          ? limits.items_per_topic
          : limits.notifications_per_topic)
      )
        fail(
          409,
          kind === "item" ? "item_limit_reached" : "notification_limit_reached",
        );
    }
    const now = new Date().toISOString(),
      revision = (old?.revision ?? 0) + 1,
      created = old?.created ?? now;
    const value = deleting
      ? null
      : {
          topic_id: topic,
          id,
          revision,
          created_at: created,
          updated_at: now,
          content: body.content,
          ...(kind === "notification"
            ? {
                mode: body.mode,
                expires_at:
                  body.mode === "silent"
                    ? null
                    : new Date(
                        Date.parse(now) + body.ttl_seconds! * 1000,
                      ).toISOString(),
              }
            : {}),
        };
    const event = {
      id: randomUUID(),
      topic_id: topic,
      [kind + "_id"]: id,
      revision,
      type:
        kind +
        (deleting ? (kind === "item" ? ".deleted" : ".cleared") : ".upserted"),
      recorded_at: now,
      [kind]: value,
    };
    this.db
      .prepare(
        `INSERT INTO ${table} VALUES (?,?,?,?,?) ON CONFLICT(topic,id) DO UPDATE SET revision=excluded.revision,json=excluded.json`,
      )
      .run(topic, id, revision, created, value ? JSON.stringify(value) : null);
    this.db
      .prepare("INSERT INTO events(topic,item,time,json) VALUES (?,?,?,?)")
      .run(
        topic,
        eventResourceKey(kind, id),
        Date.now(),
        JSON.stringify(event),
      );
    return {
      status: deleting ? 204 : old ? 200 : 201,
      headers: deleting
        ? {}
        : {
            ETag: `"${revision}"`,
            ...(!old ? { Location: `/v1/topics/${topic}/${table}/${id}` } : {}),
          },
      body: value,
      changed: true,
    };
  }
  sync(topic: string, cursor?: string, limit = 100) {
    return this.db.transaction(() => {
      const high = this.highWatermark(topic),
        now = new Date().toISOString();
      if (!cursor) {
        const items = this.db
          .prepare(
            "SELECT json FROM items WHERE topic=? AND json IS NOT NULL ORDER BY id",
          )
          .all(topic)
          .map((x: any) => JSON.parse(x.json));
        const result = {
          mode: "snapshot",
          topic_id: topic,
          items,
          notifications: this.db
            .prepare(
              "SELECT json FROM notifications WHERE topic=? AND json IS NOT NULL ORDER BY id",
            )
            .all(topic)
            .map((x: any) => JSON.parse(x.json)),
          next_cursor: this.encodeCursor({
            kind: "sync",
            topic,
            pos: String(high),
          }),
          has_more: false,
          server_time: now,
        };
        if (Buffer.byteLength(JSON.stringify(result)) > limits.snapshot_bytes)
          fail(409, "snapshot_limit_exceeded");
        return result;
      }
      const c = this.decodeCursor(cursor, "sync", topic);
      if (c.pos === undefined) fail(400, "invalid_cursor");
      const pos = BigInt(c.pos),
        end = c.end === undefined ? high : BigInt(c.end);
      if (pos < this.watermark(topic)) fail(410, "cursor_expired");
      if (end > high || pos > end) fail(400, "invalid_cursor");
      const rows = this.db
        .prepare(
          "SELECT CAST(seq AS TEXT) AS seq,json FROM events WHERE topic=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?",
        )
        .all(topic, pos, end, limit + 1) as EventRow[];
      const { events, hasMore, last } = eventPage(rows, limit);
      return {
        mode: "delta",
        topic_id: topic,
        events,
        next_cursor: this.encodeCursor({
          kind: "sync",
          topic,
          pos: hasMore ? last! : String(end),
          ...(hasMore ? { end: String(end) } : {}),
        }),
        has_more: hasMore,
        server_time: now,
      };
    })();
  }
  history(
    topic: string,
    {
      item,
      notification,
      before,
      limit = 50,
    }: {
      item?: string;
      notification?: string;
      before?: string;
      limit?: number;
    } = {},
  ) {
    return this.db.transaction(() => {
      let end = this.highWatermark(topic),
        pos = end + 1n;
      if (before) {
        const c = this.decodeCursor(before, "history", topic);
        if (
          c.item !== (item ?? null) ||
          c.notification !== (notification ?? null) ||
          c.end === undefined ||
          c.before === undefined
        )
          fail(400, "invalid_cursor");
        end = BigInt(c.end);
        pos = BigInt(c.before);
      }
      const resourceKey = item
        ? eventResourceKey("item", item)
        : notification
          ? eventResourceKey("notification", notification)
          : undefined;
      const rows = this.db
        .prepare(
          `SELECT CAST(seq AS TEXT) AS seq,json FROM events WHERE topic=? AND seq<=? AND seq<? ${resourceKey ? "AND item=?" : ""} ORDER BY seq DESC LIMIT ?`,
        )
        .all(
          topic,
          end,
          pos,
          ...(resourceKey ? [resourceKey] : []),
          limit + 1,
        ) as EventRow[];
      const { events, hasMore, last } = eventPage(rows, limit);
      return {
        events,
        next_before: hasMore
          ? this.encodeCursor({
              kind: "history",
              topic,
              item: item ?? null,
              notification: notification ?? null,
              end: String(end),
              before: last!,
            })
          : null,
      };
    })();
  }
  cleanup(now = Date.now()) {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM idem WHERE time<?")
        .run(now - limits.idempotency_retention_seconds * 1000);
      for (const { id } of this.db
        .prepare("SELECT id FROM topics")
        .all() as any[]) {
        const rows = this.db
          .prepare(
            "SELECT CAST(seq AS TEXT) AS seq,time FROM events WHERE topic=? ORDER BY seq LIMIT 250",
          )
          .all(id) as any[];
        let last: bigint | undefined;
        for (const r of rows) {
          if (r.time >= now - limits.history_retention_seconds * 1000) break;
          last = BigInt(r.seq);
        }
        if (last !== undefined) {
          this.db
            .prepare("DELETE FROM events WHERE topic=? AND seq<=?")
            .run(id, last);
          this.db
            .prepare("UPDATE topics SET watermark=? WHERE id=?")
            .run(String(last), id);
        }
      }
    })();
  }
  close() {
    this.db.close();
  }
}

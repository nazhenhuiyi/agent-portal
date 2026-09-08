import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsModule from "ajv-formats";
import { visit, parse, type ParseError } from "jsonc-parser";
const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = formatsModule as unknown as (a: Ajv2020) => void;
addFormats(ajv);
ajv.addSchema(
  JSON.parse(
    readFileSync(
      new URL(
        "../resources/protocol/schemas/core.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  "core",
);
ajv.addSchema(
  JSON.parse(
    readFileSync(
      new URL(
        "../resources/protocol/schemas/template.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  "template",
);
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message?: string): never {
  throw new ApiError(status, code, message);
}
export function check(type: string, value: unknown) {
  const v =
    ajv.getSchema(type === "Template" ? "template" : `core#/$defs/${type}`) ??
    ajv.compile({
      $ref: type === "Template" ? "template" : `core#/$defs/${type}`,
    });
  if (!v(value)) fail(422, "validation_failed", ajv.errorsText(v.errors));
}
export function strictJSON(bytes: Buffer) {
  let s: string;
  try {
    s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(400, "invalid_json");
  }
  const stack: Set<string>[] = [];
  let duplicate = false;
  visit(s!, {
    onObjectBegin: () => {
      stack.push(new Set());
    },
    onObjectProperty: (k) => {
      const set = stack.at(-1)!;
      if (set.has(k)) duplicate = true;
      set.add(k);
    },
    onObjectEnd: () => {
      stack.pop();
    },
  });
  const errors: ParseError[] = [];
  const value = parse(s!, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (errors.length || duplicate) fail(400, "invalid_json");
  function unicode(v: any): void {
    if (
      typeof v === "string" &&
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        v,
      )
    )
      fail(400, "invalid_json");
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        unicode(k);
        unicode(x);
      }
    }
  }
  unicode(value);
  return value;
}
export function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function contentCheck(c: any) {
  if (Buffer.byteLength(JSON.stringify(c)) > limits.content_bytes)
    fail(413, "content_too_large");
  function walk(v: any, d: number) {
    if (d > 8) fail(422, "content_too_deep");
    if (
      typeof v === "number" &&
      (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))
    )
      fail(422, "invalid_number");
    if (v && typeof v === "object")
      Object.values(v).forEach((x) => walk(x, d + 1));
  }
  walk(c, 1);
  if (c.link) {
    let u: URL;
    try {
      u = new URL(c.link.url);
    } catch {
      fail(422, "invalid_link");
    }
    if (
      !["http:", "https:"].includes(u!.protocol) ||
      !u!.hostname ||
      u!.username ||
      u!.password
    )
      fail(422, "invalid_link");
  }
}
export type ResourceInput = {
  content: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    template?: { id: string; version: number };
    link?: { type: "url"; url: string };
  };
  mode?: "alert" | "silent";
  ttl_seconds?: number;
};
export function normalizeItem(b: any): ResourceInput {
  check("PublishRequest", b);
  const c = { body: "", data: {}, ...b.content };
  contentCheck(c);
  return { content: c };
}
export function normalizeNotification(b: any): ResourceInput {
  check("NotificationRequest", b);
  const content = { body: "", ...b.content };
  contentCheck(content);
  const ttl = b.ttl_seconds ?? 600;
  const mode = b.mode === "silent" || ttl === 0 ? "silent" : "alert";
  return { content, mode, ttl_seconds: mode === "silent" ? 0 : ttl };
}
export type PublicationInput = Partial<
  Record<
    "item" | "notification",
    ResourceInput & { id: string; if_revision?: number }
  >
>;
export function normalizePublication(b: any): PublicationInput {
  check("PublicationRequest", b);
  const result: PublicationInput = {};
  for (const kind of ["item", "notification"] as const) {
    if (!b[kind]) continue;
    const { id, if_revision, ...input } = b[kind];
    result[kind] = {
      id,
      ...(if_revision === undefined ? {} : { if_revision }),
      ...(kind === "item"
        ? normalizeItem(input)
        : normalizeNotification(input)),
    };
  }
  return result;
}

export function templateCheck(t: any, hasAsset: (id: string) => boolean) {
  check("Template", t);
  if (Buffer.byteLength(JSON.stringify(t)) > limits.template_bytes)
    fail(413, "template_too_large");
  const features = new Set(["layout.basic"]),
    assets = new Set<string>();
  for (const tree of [t.widget, t.compact_widget].filter(Boolean)) {
    let count = 0;
    function walk(n: any, depth: number) {
      if (++count > 32 || depth > 4) fail(422, "template_too_complex");
      if (n.type === "text") features.add("text.bind");
      if (n.type === "progress") features.add("progress.bind");
      if (n.type === "image") {
        features.add("image.static");
        assets.add(n.asset_id);
      }
      for (const c of n.children ?? []) walk(c, depth + 1);
    }
    walk(tree, 1);
  }
  if (canonical([...features].sort()) !== canonical([...t.requires].sort()))
    fail(422, "template_capabilities_mismatch");
  if (canonical([...assets].sort()) !== canonical([...t.asset_ids].sort()))
    fail(422, "template_assets_mismatch");
  for (const id of assets) if (!hasAsset(id)) fail(422, "asset_not_found");
}
export const limits = {
  content_bytes: 16384,
  request_bytes: 32768,
  template_bytes: 65536,
  snapshot_bytes: 16777216,
  delta_bytes: 2097152,
  asset_bytes: 2097152,
  asset_max_dimension: 2048,
  items_per_topic: 500,
  notifications_per_topic: 500,
  history_retention_seconds: 2592000,
  idempotency_retention_seconds: 86400,
};
export const features = [
  "layout.basic",
  "text.bind",
  "image.static",
  "progress.bind",
];

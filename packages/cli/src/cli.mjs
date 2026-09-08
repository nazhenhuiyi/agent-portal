import { readFile, writeFile } from "node:fs/promises";
import { CliError } from "./errors.mjs";
import {
  configPath,
  readConfig,
  setConfig,
  savedToken,
  clearConfig,
  configSummary,
  serverURL,
  tokenText,
} from "./config.mjs";
import { parseArgs } from "node:util";

const usage = `Agent Portal CLI — Node.js 22+, HTTP only

  agent-portal config set --server URL --token-file FILE
  agent-portal config show
  agent-portal config clear
  agent-portal notify TOPIC ID --title TEXT [--body TEXT] [--link URL]
      [--mode alert|silent] [--ttl SECONDS] --key KEY
  agent-portal item put TOPIC ID --file FILE --key KEY
  agent-portal item get TOPIC ID
  agent-portal item delete TOPIC ID --key KEY
  agent-portal notification put TOPIC ID --file FILE --key KEY
  agent-portal notification get TOPIC ID
  agent-portal notification clear TOPIC ID --key KEY
  agent-portal publish TOPIC --file FILE --key KEY
  agent-portal topics
  agent-portal topic put TOPIC --file FILE
  agent-portal history TOPIC [--item ID | --notification ID] [--before CURSOR] [--limit N]
  agent-portal sync TOPIC [--cursor CURSOR] [--limit N]
  agent-portal capabilities
  agent-portal template get ID VERSION
  agent-portal template put ID VERSION --file FILE
  agent-portal asset get HASH --output FILE
  agent-portal asset put HASH --file FILE --type image/png|image/webp

Setup once: config set --server URL --token-file FILE. Daily commands use saved settings.
  Missing server/token fails locally with a setup hint; there is no default server.
  config set --token-file FILE replaces the saved token; use - to import from stdin.
  config show reports saved settings, not connectivity or token validity.
  config clear removes local settings and the OS credential; it does not revoke the token.
  Changing the saved server removes its token unless a new --token-file is supplied.

Options go after the subcommand:
  --config FILE       Separate config (default ~/.config/agent-portal/config.json).
  --server URL        One-off server override; a different server needs its own token.
  --token-file FILE   One-off token override; stdin is supported only by config set.
  --timeout MS        HTTP timeout, default 10000 (range 1..120000).
  --file FILE         API request body; - reads stdin. put replaces the whole content.
  --key KEY           Required for notification/item writes and publish, including clear/delete.
  --if-revision N     Optional write condition: 0=create only, positive=match revision.
                      Delete/clear reject 0. publish uses per-resource if_revision in JSON.
  Config commands accept only --config and the setup options shown above.
  Tokens use the OS credential store; config files contain only their references.
  PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TOKEN_FILE are not read.

notify is shorthand for notification put; it never creates a widget item.
  --mode defaults to alert; silent refreshes existing phone notifications only.
  --ttl defaults to 600 seconds and limits alert eligibility, not data retention.
  Item data uses its template; without a template the phone shows title/body.
  history pages use --before; sync uses --cursor (--limit requires a cursor).
  Asset downloads require a new output path and never overwrite files.

Results: JSON on stdout for success, JSON on stderr for errors; help is plain text.
  Exit 0=command succeeded, 1=HTTP error, 2=usage/config/file error, 3=transport/response error.
  Publication success means server persistence, not phone delivery.
  No automatic retries: new operation=new key; retries keep the key, body, target,
  token identity and conditions unchanged. No background connection or saved cursor.
`;

const invalid = (message) => {
  throw new CliError("invalid_arguments", message);
};
const stringOption = { type: "string" };
const common = ["config", "server", "token-file", "timeout"];
const writeOptions = ["key", "if-revision"];
const definitions = {
  "config set": { args: 0, options: ["server", "token-file"] },
  "config show": { args: 0, options: [] },
  "config clear": { args: 0, options: [] },
  notify: {
    args: 2,
    options: ["title", "body", "link", "mode", "ttl", ...writeOptions],
  },
  "item put": { args: 2, options: ["file", ...writeOptions] },
  "item get": { args: 2, options: [] },
  "item delete": { args: 2, options: writeOptions },
  "notification put": { args: 2, options: ["file", ...writeOptions] },
  "notification get": { args: 2, options: [] },
  "notification clear": { args: 2, options: writeOptions },
  publish: { args: 1, options: ["file", "key"] },
  topics: { args: 0, options: [] },
  "topic put": { args: 1, options: ["file"] },
  history: { args: 1, options: ["item", "notification", "before", "limit"] },
  sync: { args: 1, options: ["cursor", "limit"] },
  capabilities: { args: 0, options: [] },
  "template get": { args: 2, options: [] },
  "template put": { args: 2, options: ["file"] },
  "asset get": { args: 1, options: ["output"] },
  "asset put": { args: 1, options: ["file", "type"] },
};

function integer(value, min, max, name) {
  if (
    !/^(0|[1-9][0-9]*)$/.test(value ?? "") ||
    Number(value) < min ||
    Number(value) > max
  )
    invalid(`${name} must be an integer between ${min} and ${max}`);
  return Number(value);
}
function identifier(value, name, max = 128) {
  if (!new RegExp(`^[a-z0-9][a-z0-9_-]{0,${max - 1}}$`).test(value ?? ""))
    invalid(`Invalid ${name}`);
  return value;
}
function required(options, key) {
  if (!options[key]) invalid(`--${key} is required`);
  return options[key];
}
async function input(file) {
  try {
    if (file !== "-") return await readFile(file);
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    // File contents and credentials never appear in diagnostic messages.
    throw new CliError("input_unreadable", "Cannot read input file or stdin");
  }
}

function parse(argv) {
  const parts = argv.slice();
  let command = parts.shift();
  if (
    ["item", "notification", "topic", "template", "asset", "config"].includes(
      command,
    )
  )
    command += " " + parts.shift();
  const definition = definitions[command];
  if (!definition) invalid("Unknown command; use agent-portal --help");
  let parsed;
  try {
    parsed = parseArgs({
      args: parts,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        [
          ...(command.startsWith("config ") ? ["config"] : common),
          ...definition.options,
        ].map((key) => [key, stringOption]),
      ),
      tokens: true,
    });
  } catch {
    invalid("Unknown or incomplete option; use agent-portal --help");
  }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) invalid(`Repeated --${token.name}`);
    seen.add(token.name);
  }
  if (parsed.positionals.length !== definition.args)
    invalid(`Wrong number of arguments for ${command}`);
  return { command, args: parsed.positionals, options: parsed.values };
}

async function requestFor({ command, args, options }) {
  const [first, second] = args;
  const headers = {};
  let method = "GET",
    path,
    body,
    output;
  const topic = () => identifier(first, "topic", 64);
  if (command === "capabilities") path = "/v1/capabilities";
  else if (command === "topics") path = "/v1/topics";
  else if (command.startsWith("template ")) {
    path = `/v1/templates/${identifier(first, "template", 64)}/versions/${integer(second, 1, 2147483647, "version")}`;
    if (command.endsWith("put")) method = "PUT";
  } else if (command.startsWith("asset ")) {
    if (!/^[a-f0-9]{64}$/.test(first)) invalid("Invalid asset hash");
    path = `/v1/assets/${first}`;
    if (command.endsWith("get")) output = required(options, "output");
    else {
      method = "PUT";
      if (!["image/png", "image/webp"].includes(options.type))
        invalid("--type must be image/png or image/webp");
      headers["Content-Type"] = options.type;
    }
  } else if (command === "history" || command === "sync") {
    path = `/v1/topics/${topic()}/${command}`;
    const query = new URLSearchParams();
    if (options.item && options.notification)
      invalid("--item and --notification are mutually exclusive");
    if (command === "sync" && options.limit && !options.cursor)
      invalid("--limit requires --cursor for sync");
    for (const [key, value] of Object.entries(options)) {
      if (["item", "notification"].includes(key))
        query.set(key + "_id", identifier(value, key));
      if (["before", "cursor"].includes(key)) {
        if (!value) invalid(`--${key} cannot be empty`);
        query.set(key, value);
      }
      if (key === "limit")
        query.set(
          key,
          String(integer(value, 1, command === "sync" ? 500 : 100, "limit")),
        );
    }
    if (query.size) path += "?" + query;
  } else if (command === "topic put") {
    path = `/v1/topics/${topic()}`;
    method = "PUT";
  } else if (command === "publish") {
    path = `/v1/topics/${topic()}/publish`;
    method = "POST";
  } else {
    const notification =
      command === "notify" || command.startsWith("notification ");
    path = `/v1/topics/${topic()}/${notification ? "notifications" : "items"}/${identifier(second, "resource ID")}`;
    method = command.endsWith("get")
      ? "GET"
      : / (delete|clear)$/.test(command)
        ? "DELETE"
        : "PUT";
  }
  const resourceWrite =
    command === "notify" ||
    /^(item|notification) (put|delete|clear)$/.test(command);
  if (resourceWrite || command === "publish") {
    const key = required(options, "key");
    if (!/^[!-~]{1,128}$/.test(key))
      invalid("--key must be 1–128 printable ASCII characters without spaces");
    headers["Idempotency-Key"] = key;
  }
  if (options["if-revision"] !== undefined) {
    const revision = integer(
      options["if-revision"],
      0,
      Number.MAX_SAFE_INTEGER,
      "revision",
    );
    if (revision === 0) {
      if (method === "DELETE")
        invalid("--if-revision 0 is only valid for put/notify");
      headers["If-None-Match"] = "*";
    } else headers["If-Match"] = `"${revision}"`;
  }
  if (command === "notify") {
    const content = {
      title: required(options, "title"),
      body: options.body ?? "",
    };
    if (options.link !== undefined)
      content.link = { type: "url", url: options.link };
    if (
      options.mode !== undefined &&
      !["alert", "silent"].includes(options.mode)
    )
      invalid("--mode must be alert or silent");
    body = JSON.stringify({
      content,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.ttl === undefined
        ? {}
        : { ttl_seconds: integer(options.ttl, 0, 86400, "ttl") }),
    });
  } else if (method === "PUT" || method === "POST") {
    body = await input(required(options, "file"));
  }
  if (body !== undefined && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";
  return { method, path, headers, body, output };
}

async function configure(command, options) {
  const file = configPath(options.config);
  if (command === "config clear") {
    await clearConfig(file);
    return { ok: true, data: configSummary(file, {}) };
  }
  const existing = await readConfig(file);
  if (command === "config show")
    return { ok: true, data: configSummary(file, existing) };
  if (options.server === undefined && options["token-file"] === undefined)
    invalid("config set requires --server or --token-file");
  const token =
    options["token-file"] === undefined
      ? undefined
      : tokenText(
          (await input(required(options, "token-file"))).toString("utf8"),
        );
  const saved = await setConfig(file, { server: options.server, token });
  return { ok: true, data: configSummary(file, saved) };
}

async function execute(parsed) {
  const { options } = parsed;
  const saved = await readConfig(configPath(options.config));
  if (
    options.server === undefined &&
    saved.server === undefined &&
    options["token-file"] === undefined
  )
    throw new CliError(
      "missing_configuration",
      "Service address and token are not configured. Run agent-portal config set --server URL --token-file FILE first.",
    );
  const base = serverURL(options.server ?? saved.server);
  const file = options["token-file"];
  if (file === "-")
    invalid("Use config set --token-file - to save a token from stdin");
  const token =
    file === undefined
      ? await savedToken(saved, base)
      : tokenText((await input(file)).toString("utf8"));
  if (!token)
    throw new CliError(
      "missing_token",
      "Token is not configured for this service. Run agent-portal config set --server URL --token-file FILE; a different --server requires its own --token-file.",
    );
  const timeout =
    options.timeout === undefined
      ? 10000
      : integer(options.timeout, 1, 120000, "timeout");
  const request = await requestFor(parsed);
  let response, bytes;
  try {
    response = await fetch(base + request.path, {
      method: request.method,
      body: request.body,
      headers: { ...request.headers, Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new CliError(
      "transport_error",
      "No complete response received; the operation may have succeeded. Retry only with the same key, body, target and conditions.",
      3,
    );
  }
  let data = null;
  if (!request.output || !response.ok) {
    try {
      data = bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
    } catch {
      if (response.ok)
        throw new CliError(
          "invalid_response",
          "Service returned a non-JSON response; the write outcome may be unknown",
          3,
          { http_status: response.status },
        );
    }
  }
  if (!response.ok) {
    throw new CliError(
      data?.error?.code ?? "http_error",
      data?.error?.message ?? `HTTP ${response.status}`,
      1,
      { http_status: response.status },
    );
  }
  if (request.output) {
    try {
      await writeFile(request.output, bytes, { flag: "wx" });
    } catch {
      throw new CliError(
        "output_unwritable",
        "Cannot save asset; the output path must not already exist",
      );
    }
    data = { file: request.output, bytes: bytes.length };
  }
  return {
    ok: true,
    status: response.status,
    data,
    ...(response.headers.has("etag")
      ? { etag: response.headers.get("etag") }
      : {}),
    ...(request.headers["Idempotency-Key"]
      ? { idempotency_key: request.headers["Idempotency-Key"] }
      : {}),
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write(usage);
    return;
  }
  let key;
  try {
    const parsed = parse(argv);
    if (parsed.command.startsWith("config ")) {
      process.stdout.write(
        JSON.stringify(await configure(parsed.command, parsed.options)) + "\n",
      );
      return;
    }
    key = parsed.options.key;
    const result = await execute(parsed);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const known = error instanceof CliError;
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error: {
          code: known ? error.code : "cli_error",
          message: known ? error.message : "CLI failed",
          ...(known ? error.details : {}),
        },
        ...(key ? { idempotency_key: key } : {}),
      }) + "\n",
    );
    process.exitCode = known ? error.exitCode : 2;
  }
}

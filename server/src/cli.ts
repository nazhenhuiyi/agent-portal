import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { check } from "./validation.js";
import { randomUUID } from "node:crypto";
import { Store, hash } from "./store.js";
import { parseArgs } from "node:util";
import { settings, saveSettings, requireDatabase, localURL } from "./config.js";
import { start } from "./main.js";
const usage = `Agent Portal server — Node.js 22

  agent-portal-server init [--host HOST] [--port PORT]
  agent-portal-server start [--host HOST] [--port PORT]
  agent-portal-server config show
  agent-portal-server token create read,write TOPIC1,TOPIC2
  agent-portal-server token create admin
  agent-portal-server token list
  agent-portal-server token revoke ID
  agent-portal-server demo running|completed|notification|clear-notification|delete|showcase
  agent-portal-server rotate-epoch

All commands accept --data-dir DIR (default ~/.local/share/agent-portal).
init saves host/port and creates local credentials once; rerunning preserves tokens/data.
start runs in the foreground; its flags override saved settings only for that run.
config show prints effective paths and listen settings without reading credentials.
Defaults: 127.0.0.1:8080. Configuration: DATA_DIR/config.json.
Tokens and database: DATA_DIR/credentials.json and DATA_DIR/portal.sqlite.
Environment compatibility: PORTAL_DB, PORTAL_HOST, PORTAL_PORT; explicit flags win.
The demo uses the saved local address; PORTAL_BASE_URL can override its destination.
Use an external process manager for automatic restart or login/boot startup.
--help prints this text. Errors go to stderr and exit nonzero.
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "data-dir": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(usage);
    return;
  }
  const [command, ...args] = positionals;
  if (
    !["init", "start", "config", "token", "demo", "rotate-epoch"].includes(
      command!,
    )
  )
    throw Error("Unknown command; use agent-portal-server --help");
  if (
    !["init", "start"].includes(command!) &&
    (values.host !== undefined || values.port !== undefined)
  )
    throw Error("--host and --port are accepted only by init and start");
  if (["init", "start", "rotate-epoch"].includes(command!) && args.length)
    throw Error(`Unexpected arguments for ${command}`);
  if (
    command === "demo" &&
    (args.length > 1 ||
      (args[0] &&
        ![
          "showcase",
          "running",
          "completed",
          "notification",
          "clear-notification",
          "delete",
        ].includes(args[0])))
  )
    throw Error("Unknown demo step; use agent-portal-server --help");
  if (
    command === "token" &&
    !(
      (args[0] === "create" && (args.length === 2 || args.length === 3)) ||
      (args[0] === "list" && args.length === 1) ||
      (args[0] === "revoke" && args.length === 2)
    )
  )
    throw Error(
      "Usage: token create <roles> [topics] | token list | token revoke <id>",
    );
  if (command === "config" && (args.length !== 1 || args[0] !== "show"))
    throw Error("Usage: agent-portal-server config show");
  const config = settings(values);
  const dbPath = config.dbPath;
  const credsPath = join(config.dataDir, "credentials.json");
  if (command === "config") {
    console.log(
      JSON.stringify(
        {
          data_dir: config.dataDir,
          config_file: config.configPath,
          database: config.dbPath,
          database_exists: existsSync(config.dbPath),
          host: config.host,
          port: config.port,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command !== "init") requireDatabase(config);
  if (command === "start") {
    await start(config);
    return;
  }
  if (command === "init") {
    if (existsSync(credsPath) && !existsSync(dbPath))
      throw Error(
        "Credentials exist but the database is missing; restore the matching database before initializing",
      );
    const s = new Store(dbPath);
    try {
      const initialized = existsSync(credsPath);
      if (initialized) {
        let existing;
        try {
          existing = JSON.parse(readFileSync(credsPath, "utf8"));
        } catch {
          throw Error(
            "Cannot read existing credentials; inspect credentials.json before initializing again",
          );
        }
        if (
          !["admin", "writer", "reader"].every(
            (role) =>
              typeof existing?.[role]?.token === "string" &&
              s.db
                .prepare("SELECT id FROM tokens WHERE hash=?")
                .get(hash(existing[role].token)),
          )
        )
          throw Error(
            "Existing credentials do not match this database; inspect the data directory before initializing again",
          );
      } else {
        if (
          (
            s.db.prepare("SELECT COUNT(*) AS count FROM tokens").get() as {
              count: number;
            }
          ).count
        )
          throw Error(
            "Database is already initialized but credentials.json is missing; restore it or use token create to issue replacement credentials",
          );
        s.db.transaction(() => {
          const admin = s.issue(["admin"], []),
            writer = s.issue(["write"], ["demo"]),
            reader = s.issue(["read"], ["demo"]);
          writeFileSync(
            credsPath,
            JSON.stringify({ admin, writer, reader }, null, 2) + "\n",
            { flag: "wx", mode: 0o600 },
          );
          chmodSync(credsPath, 0o600);
        })();
      }
      saveSettings(config);
      console.log(
        `${initialized ? "Already initialized" : "Initialized"}. Credentials: ${credsPath}\nConfiguration: ${config.configPath}\nNext: agent-portal-server start${values["data-dir"] ? " --data-dir <same-directory>" : ""}`,
      );
    } finally {
      s.close();
    }
  } else if (command === "token") {
    const s = new Store(dbPath);
    try {
      if (args[0] === "create") {
        const roles = (args[1] ?? "").split(","),
          topics = (args[2] ?? "").split(",").filter(Boolean);
        if (
          !roles.length ||
          roles.some((x) => !["admin", "read", "write"].includes(x)) ||
          (!roles.includes("admin") && !topics.length)
        )
          throw Error("Usage: token create read,write topic1,topic2");
        for (const topic of topics) check("TopicId", topic);
        console.log(JSON.stringify(s.issue(roles, topics)));
      } else if (args[0] === "revoke" && args[1]) {
        s.db.prepare("UPDATE tokens SET revoked=1 WHERE id=?").run(args[1]);
        console.log("Token revoked.");
      } else if (args[0] === "list")
        console.log(
          JSON.stringify(
            s.db.prepare("SELECT id,roles,topics,revoked FROM tokens").all(),
            null,
            2,
          ),
        );
      else throw Error("Usage: token create|revoke|list");
    } finally {
      s.close();
    }
  } else if (command === "rotate-epoch") {
    const s = new Store(dbPath);
    s.db
      .prepare("UPDATE meta SET value=? WHERE key=?")
      .run(randomUUID(), "epoch");
    s.close();
    console.log("Log epoch rotated; clients will recover from snapshots.");
  } else if (command === "demo") {
    const credentials = JSON.parse(readFileSync(credsPath, "utf8")),
      base = process.env.PORTAL_BASE_URL ?? localURL(config);
    async function call(
      path: string,
      method: string,
      token: string,
      body?: any,
    ) {
      const r = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          "Idempotency-Key": randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error(await r.text());
      return r.status === 204 ? null : r.json();
    }
    if (args[0] === "showcase") {
      const load = (name: string) =>
        JSON.parse(
          readFileSync(
            new URL(
              `../resources/examples/showcase/${name}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      await call("/v1/topics/demo", "PUT", credentials.admin.token, {
        name: "场景示例",
        description:
          "晨间阅读、代码巡检与旅途相册归档。示例任务数据，不代表实际执行结果。",
      });
      for (const name of ["reading", "review", "archive"]) {
        const template = load(`${name}-template`);
        await call(
          `/v1/templates/${template.id}/versions/${template.version}`,
          "PUT",
          credentials.admin.token,
          template,
        );
      }
      for (const publication of load("publications")) {
        await call(
          "/v1/topics/demo/publish",
          "POST",
          credentials.writer.token,
          publication,
        );
      }
      console.log(
        "Published 3 showcase items and 2 independent notifications to demo. Sample task data; no agent jobs were run.",
      );
      return;
    }
    await call("/v1/topics/demo", "PUT", credentials.admin.token, {
      name: "演示",
      description: "生成中 → 已完成",
    });
    const example = (name: string) =>
      JSON.parse(
        readFileSync(
          new URL(
            `../resources/examples/protocol/${name}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    const template = example("template");
    await call(
      "/v1/templates/report-card/versions/1",
      "PUT",
      credentials.admin.token,
      template,
    );
    const step = args[0] ?? "running";
    if (step === "delete") {
      await call(
        "/v1/topics/demo/items/demo-report",
        "DELETE",
        credentials.writer.token,
      );
      console.log("Deleted current demo item; history retained.");
    } else if (step === "notification" || step === "clear-notification") {
      const body =
        step === "notification" ? example("notification-only") : undefined;
      await call(
        "/v1/topics/demo/notifications/daily-completed",
        step === "notification" ? "PUT" : "DELETE",
        credentials.writer.token,
        body,
      );
      console.log(
        step === "notification"
          ? "Published notification only; display item unchanged."
          : "Cleared notification only; display item and history retained.",
      );
    } else {
      if (!["running", "completed"].includes(step))
        throw Error(
          "demo running|completed|delete|notification|clear-notification",
        );
      const b = example(
        step === "completed" ? "publication-combined" : "publish-running",
      );
      if (step === "completed") {
        b.item.id = "demo-report";
        b.item.content.link = {
          type: "url",
          url: "https://example.com/overview",
        };
        b.notification.content.link = {
          type: "url",
          url: "https://example.com/report",
        };
      }
      const r: any = await call(
        step === "completed"
          ? "/v1/topics/demo/publish"
          : "/v1/topics/demo/items/demo-report",
        step === "completed" ? "POST" : "PUT",
        credentials.writer.token,
        b,
      );
      console.log(
        `Published ${step}: demo/demo-report revision ${(r.item ?? r).revision}`,
      );
    }
  }
}

try {
  await main();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  const message =
    code === "EADDRINUSE"
      ? "Port is already in use; stop the other instance or choose --port PORT"
      : code === "ENOENT"
        ? "Required file is missing; check the data directory and package installation"
        : code === "EACCES" || code === "EPERM"
          ? "Permission denied; check access to the data directory and listen address"
          : error instanceof Error
            ? error.message
            : "Server command failed";
  console.error(message);
  process.exitCode = 1;
}

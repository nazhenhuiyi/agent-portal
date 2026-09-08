import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type Options = { "data-dir"?: string; host?: string; port?: string };
export type Settings = {
  dataDir: string;
  dbPath: string;
  configPath: string;
  host: string;
  port: number;
};

export function settings(
  options: Options,
  environment: NodeJS.ProcessEnv = process.env,
): Settings {
  if (options["data-dir"] !== undefined && !options["data-dir"].trim())
    throw Error("--data-dir must not be empty");
  const legacyDb =
    options["data-dir"] === undefined ? environment.PORTAL_DB : undefined;
  const dataDir = resolve(
    options["data-dir"] ??
      (legacyDb
        ? dirname(resolve(legacyDb))
        : join(homedir(), ".local", "share", "agent-portal")),
  );
  const configPath = join(dataDir, "config.json");
  let saved: { host?: string; port?: number } = {};
  if (existsSync(configPath)) {
    try {
      saved = JSON.parse(readFileSync(configPath, "utf8"));
      if (
        !saved ||
        Array.isArray(saved) ||
        typeof saved !== "object" ||
        Object.keys(saved).some((key) => !["host", "port"].includes(key)) ||
        (saved.host !== undefined && typeof saved.host !== "string") ||
        (saved.port !== undefined && !Number.isInteger(saved.port))
      )
        throw Error();
    } catch {
      throw Error(`Invalid server configuration: ${configPath}`);
    }
  }
  const host =
    options.host ?? environment.PORTAL_HOST ?? saved.host ?? "127.0.0.1";
  const portText =
    options.port ?? environment.PORTAL_PORT ?? String(saved.port ?? 8080);
  const port = Number(portText);
  if (!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
    throw Error(
      "Host must be a hostname or IP address, without a scheme or port",
    );
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("Port must be an integer between 1 and 65535");
  return {
    dataDir,
    dbPath: legacyDb ? resolve(legacyDb) : join(dataDir, "portal.sqlite"),
    configPath,
    host,
    port,
  };
}

export function saveSettings(config: Settings) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const temporary = join(config.dataDir, `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(
      temporary,
      JSON.stringify({ host: config.host, port: config.port }, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    renameSync(temporary, config.configPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function requireDatabase(config: Settings) {
  if (!existsSync(config.dbPath))
    throw Error(
      `Database not found: ${config.dbPath}. Run agent-portal-server init with the same --data-dir first.`,
    );
}

export function localURL(config: Settings) {
  const host = ["0.0.0.0", "::"].includes(config.host)
    ? "127.0.0.1"
    : config.host;
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
}

import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError } from "./errors.mjs";
import { credentials } from "./credentials.mjs";

export const configPath = (file) =>
  resolve(file ?? join(homedir(), ".config", "agent-portal", "config.json"));

export function serverURL(value) {
  if (value === undefined)
    throw new CliError(
      "missing_server",
      "Service address is not configured. Run agent-portal config set --server URL --token-file FILE, or provide --server URL for this command.",
    );
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("invalid_server", "Service URL is invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CliError(
      "invalid_server",
      "Use an HTTP(S) service URL without credentials, query or fragment",
    );
  return url.toString().replace(/\/+$/, "");
}

export function tokenText(value) {
  const token = value.trim();
  if (!token || !/^[!-~]+$/.test(token))
    throw new CliError(
      "invalid_token",
      "Provide a file containing only the token",
    );
  return token;
}

export async function readConfig(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new CliError("config_unreadable", "Cannot read CLI configuration");
  }
  try {
    const config = JSON.parse(raw);
    if (
      !config ||
      typeof config !== "object" ||
      Array.isArray(config) ||
      Object.keys(config).some(
        (key) => !["server", "credential"].includes(key),
      ) ||
      typeof config.server !== "string" ||
      (config.credential !== undefined &&
        (typeof config.credential !== "string" ||
          !/^[a-f0-9-]{36}$/.test(config.credential)))
    )
      throw Error();
    return {
      server: serverURL(config.server),
      ...(config.credential === undefined
        ? {}
        : { credential: config.credential }),
    };
  } catch {
    throw new CliError(
      "invalid_config",
      "CLI configuration is invalid; correct the configuration file",
    );
  }
}

export async function saveConfig(file, config) {
  const temporary = join(dirname(file), `.portal-${randomUUID()}.tmp`);
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } catch {
    throw new CliError("config_unwritable", "Cannot save CLI configuration");
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function removeConfig(file) {
  try {
    await rm(file, { force: true });
  } catch {
    throw new CliError("config_unwritable", "Cannot remove CLI configuration");
  }
}

export function configSummary(file, config) {
  return {
    path: file,
    configured: config.server !== undefined,
    server: config.server ?? null,
    has_token: config.credential !== undefined,
    token_storage: "os-credential-store",
  };
}

export async function savedToken(config, server, store = credentials) {
  if (config.server !== server || !config.credential) return undefined;
  const token = await store.get(config.credential);
  if (!token)
    throw new CliError(
      "missing_credential",
      "Saved token is missing from the OS credential store; run config set --token-file FILE again",
    );
  return tokenText(token);
}

// New tokens get a new entry: failed writes cannot overwrite a working credential.
export async function setConfig(file, { server, token }, store = credentials) {
  const previous = await readConfig(file);
  server = serverURL(server ?? previous.server);
  const next = { server };
  if (token !== undefined) {
    token = tokenText(token);
    next.credential = randomUUID();
    await store.set(next.credential, token);
  } else if (server === previous.server && previous.credential) {
    next.credential = previous.credential;
  }
  let committed = false;
  try {
    await saveConfig(file, next);
    committed = true;
    if (previous.credential && previous.credential !== next.credential)
      await store.delete(previous.credential);
  } catch (error) {
    let recoveryFailed = false;
    try {
      if (committed) {
        if (previous.server) await saveConfig(file, previous);
        else await removeConfig(file);
      }
    } catch {
      recoveryFailed = true;
    }
    try {
      if (token !== undefined) await store.delete(next.credential);
    } catch {
      recoveryFailed = true;
    }
    if (recoveryFailed) {
      throw new CliError(
        "config_recovery_failed",
        "Configuration update and cleanup failed; check config show and the agent-portal entries in your OS credential store",
      );
    }
    throw error;
  }
  return next;
}

export async function clearConfig(file, store = credentials) {
  const previous = await readConfig(file);
  // Keep the reference until deletion succeeds so a failed clear can be retried.
  if (previous.credential) await store.delete(previous.credential);
  await removeConfig(file);
}

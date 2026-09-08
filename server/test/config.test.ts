import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  settings,
  saveSettings,
  requireDatabase,
  localURL,
} from "../src/config.js";

function directory(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "portal-server-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("server config persists independently of installation and honors explicit overrides", (t) => {
  const dir = directory(t),
    options = { "data-dir": dir };
  const initial = settings(options, {});
  assert.equal(initial.host, "127.0.0.1");
  assert.equal(initial.port, 8080);
  assert.equal(existsSync(initial.configPath), false);
  saveSettings(settings({ ...options, host: "0.0.0.0", port: "8081" }, {}));
  const saved = readFileSync(initial.configPath, "utf8");
  assert.equal(settings(options, {}).port, 8081);
  const environment = {
    PORTAL_HOST: "localhost",
    PORTAL_PORT: "8082",
    PORTAL_DB: join(dir, "legacy.sqlite"),
  };
  assert.equal(settings(options, environment).port, 8082);
  assert.equal(settings({ ...options, port: "8083" }, environment).port, 8083);
  assert.equal(
    settings(options, environment).dbPath,
    join(dir, "portal.sqlite"),
  );
  assert.equal(settings({}, environment).dbPath, environment.PORTAL_DB);
  assert.equal(settings({}, environment).dataDir, dir);
  assert.equal(readFileSync(initial.configPath, "utf8"), saved);
  assert.equal(
    localURL(settings({ ...options, host: "::", port: "8080" }, {})),
    "http://127.0.0.1:8080",
  );
  assert.equal(
    localURL(settings({ ...options, host: "::1", port: "8080" }, {})),
    "http://[::1]:8080",
  );
});

test("invalid server configuration fails before creating data", (t) => {
  const dir = directory(t),
    options = { "data-dir": dir };
  for (const port of ["0", "65536", "1.5", "abc", ""])
    assert.throws(() => settings({ ...options, port }, {}), /Port/);
  for (const host of ["http://localhost", "localhost:8080", "a b", ""])
    assert.throws(() => settings({ ...options, host }, {}), /Host/);
  assert.throws(() => settings({ "data-dir": "" }, {}), /must not be empty/);
  const config = settings(options, {});
  assert.throws(() => requireDatabase(config), /Run agent-portal-server init/);
  assert.equal(existsSync(config.dbPath), false);
  writeFileSync(config.configPath, '{"port":"8080"}');
  assert.throws(() => settings(options, {}), /Invalid server configuration/);
});

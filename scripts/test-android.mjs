import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import Database from "../server/node_modules/better-sqlite3/lib/index.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentials = JSON.parse(
  fs.readFileSync(path.join(root, ".local/credentials.json"), "utf8"),
);
const base = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:8080";
function run(command, args) {
  const r = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`${command} failed`);
  return r.stdout ?? "";
}
const adbArgs = process.env.ANDROID_SERIAL
  ? ["-s", process.env.ANDROID_SERIAL]
  : [];
const adb = (...args) => run("adb", [...adbArgs, ...args]);
run("./clients/android/gradlew", [
  "-p",
  "clients/android",
  "assembleDebug",
  "assembleDebugAndroidTest",
  "--console=plain",
]);
adb(
  "install",
  "-r",
  "clients/android/app/build/outputs/apk/debug/app-debug.apk",
);
adb(
  "install",
  "-r",
  "clients/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
);
adb(
  "shell",
  "pm",
  "grant",
  "dev.agentportal",
  "android.permission.POST_NOTIFICATIONS",
);
adb("shell", "appwidget", "grantbind", "--package", "dev.agentportal");
const cli = (...args) =>
  spawnSync(
    "npm",
    ["--prefix", "server", "run", "--silent", "cli", "--", ...args],
    { cwd: root, encoding: "utf8" },
  );
function issue(role) {
  const r = cli("token", "create", role, "integration");
  if (r.status) throw Error("Failed to create test credential");
  return JSON.parse(r.stdout);
}
const read = issue("read"),
  write = issue("write");
const topic = await fetch(base + "/v1/topics/integration", {
  method: "PUT",
  headers: {
    Authorization: "Bearer " + credentials.admin.token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "Integration checks" }),
});
if (!topic.ok) throw Error("Service must be running");
const db = new Database(path.join(root, ".local/portal.sqlite"), {
  readonly: true,
});
const key = db
  .prepare("SELECT value FROM meta WHERE key=?")
  .get("cursor_key").value;
db.close();
const raw = Buffer.from(
  JSON.stringify({
    kind: "sync",
    topic: "integration",
    pos: "0",
    epoch: "stale-test-epoch",
  }),
).toString("base64url");
const expiredCursor =
  raw + "." + createHmac("sha256", key).update(raw).digest("base64url");
function instrument(method, reader, writer, expired) {
  const args = [
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    "-e",
    "class",
    `dev.agentportal.PortalIntegrationTest#${method}`,
    "-e",
    "base",
    process.env.PORTAL_ANDROID_BASE_URL ?? "http://10.0.2.2:8080",
    "-e",
    "reader",
    reader,
    "-e",
    "writer",
    writer,
  ];
  if (expired) args.push("-e", "expiredCursor", expired);
  args.push("dev.agentportal.test/androidx.test.runner.AndroidJUnitRunner");
  const output = adb(...args);
  if (!output.includes("OK (1 test)"))
    throw Error("Android instrumentation checks failed");
}
try {
  instrument("endToEnd", read.token, write.token, expiredCursor);
  instrument("independentPresentation", read.token, write.token);
  instrument("allTemplateNodes", read.token, write.token);
  adb(
    "shell",
    "pm",
    "revoke",
    "dev.agentportal",
    "android.permission.POST_NOTIFICATIONS",
  );
  instrument("notificationsDisabled", read.token, write.token);
  adb(
    "shell",
    "pm",
    "grant",
    "dev.agentportal",
    "android.permission.POST_NOTIFICATIONS",
  );
  instrument("prepareDemo", credentials.reader.token, credentials.writer.token);
} finally {
  adb("shell", "appwidget", "revokebind", "--package", "dev.agentportal");
  adb(
    "shell",
    "pm",
    "grant",
    "dev.agentportal",
    "android.permission.POST_NOTIFICATIONS",
  );
  cli("token", "revoke", read.id);
  cli("token", "revoke", write.id);
}
adb("shell", "am", "start", "-n", "dev.agentportal/.MainActivity");
console.log(
  "Android functional checks passed; demo connection restored. No performance tests.",
);

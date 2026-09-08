import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import "./resources.mjs";

await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
execFileSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/typescript/bin/tsc", import.meta.url),
    ),
    "-p",
    fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  ],
  { stdio: "inherit" },
);

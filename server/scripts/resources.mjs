import { mkdir, copyFile, cp } from "node:fs/promises";

// Ship only runtime schemas and the fixtures used by the demo command.
for (const path of [
  "protocol/schemas/core.schema.json",
  "protocol/schemas/template.schema.json",
  ...[
    "template",
    "publish-running",
    "publication-combined",
    "notification-only",
  ].map((name) => `examples/protocol/${name}.json`),
]) {
  const destination = new URL(`../resources/${path}`, import.meta.url);
  await mkdir(new URL(".", destination), { recursive: true });
  await copyFile(new URL(`../../${path}`, import.meta.url), destination);
}

await cp(
  new URL("../../docs/deployment/", import.meta.url),
  new URL("../deployment/", import.meta.url),
  { recursive: true },
);

await cp(
  new URL("../../examples/showcase/", import.meta.url),
  new URL("../resources/examples/showcase/", import.meta.url),
  { recursive: true },
);

import { createApp } from "./app.js";
import { Store } from "./store.js";
import { requireDatabase, type Settings } from "./config.js";

export async function start(config: Settings) {
  requireDatabase(config);
  const store = new Store(config.dbPath);
  const app = createApp(store);
  try {
    const address = await app.listen({ host: config.host, port: config.port });
    console.log(`HTTP: ${address}\nData: ${config.dataDir}`);
  } catch (error) {
    await app.close();
    store.close();
    throw error;
  }
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void app
      .close()
      .then(() => {
        store.close();
      })
      .catch(() => {
        console.error("Failed to close the server cleanly");
        process.exitCode = 1;
      })
      .finally(() => {
        process.off("SIGINT", close);
        process.off("SIGTERM", close);
      });
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

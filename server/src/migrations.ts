import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";

// Startup-only schema setup and upgrades. Preserve existing data and log semantics.
export function migrate(db: Database.Database) {
  db.transaction(() => {
    db.exec(`
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,roles TEXT NOT NULL,topics TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,watermark TEXT NOT NULL DEFAULT '0');
 CREATE TABLE IF NOT EXISTS items(topic TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,json TEXT,PRIMARY KEY(topic,id),FOREIGN KEY(topic) REFERENCES topics(id));
 CREATE TABLE IF NOT EXISTS notifications(topic TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,json TEXT,PRIMARY KEY(topic,id),FOREIGN KEY(topic) REFERENCES topics(id));
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,topic TEXT NOT NULL,item TEXT NOT NULL,time INTEGER NOT NULL,json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_topic_seq ON events(topic,seq);
 CREATE TABLE IF NOT EXISTS idem(token TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,time INTEGER NOT NULL,PRIMARY KEY(token,key));
 CREATE TABLE IF NOT EXISTS templates(id TEXT NOT NULL,version INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(id,version));
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,bytes BLOB NOT NULL);
 `);
    for (const [k, v] of [
      ["schema_version", "1"],
      ["epoch", randomUUID()],
      ["cursor_key", randomBytes(32).toString("hex")],
    ])
      db.prepare("INSERT OR IGNORE INTO meta VALUES (?,?)").run(k, v);
    if (
      (
        db
          .prepare("SELECT value FROM meta WHERE key='schema_version'")
          .get() as { value: string }
      ).value === "1"
    ) {
      // Preserve existing display items and history. Legacy reminders become separate records.
      const rows = db
        .prepare("SELECT * FROM events ORDER BY seq")
        .all() as any[];
      db.exec("DELETE FROM events");
      for (const row of rows) {
        const event = JSON.parse(row.json),
          policy = event.notification;
        delete event.notification;
        db.prepare(
          "INSERT INTO events(topic,item,time,json) VALUES (?,?,?,?)",
        ).run(row.topic, row.item, row.time, JSON.stringify(event));
        const old = db
          .prepare("SELECT * FROM notifications WHERE topic=? AND id=?")
          .get(row.topic, row.item) as any;
        if (policy?.mode !== "alert" && !old?.json) continue;
        const notification = event.item
          ? {
              topic_id: row.topic,
              id: row.item,
              revision: event.revision,
              created_at: old?.created ?? event.recorded_at,
              updated_at: event.recorded_at,
              content: {
                title: event.item.content.title,
                body: [...event.item.content.body].slice(0, 500).join(""),
                ...(event.item.content.link
                  ? { link: event.item.content.link }
                  : {}),
              },
              mode: policy?.mode ?? "silent",
              expires_at: policy?.expires_at ?? null,
            }
          : null;
        db.prepare(
          "INSERT INTO notifications VALUES (?,?,?,?,?) ON CONFLICT(topic,id) DO UPDATE SET revision=excluded.revision,json=excluded.json",
        ).run(
          row.topic,
          row.item,
          event.revision,
          old?.created ?? event.recorded_at,
          notification ? JSON.stringify(notification) : null,
        );
        const ne = {
          id: randomUUID(),
          topic_id: row.topic,
          notification_id: row.item,
          revision: event.revision,
          recorded_at: event.recorded_at,
          type: notification ? "notification.upserted" : "notification.cleared",
          notification,
        };
        db.prepare(
          "INSERT INTO events(topic,item,time,json) VALUES (?,?,?,?)",
        ).run(
          row.topic,
          "notification:" + row.item,
          row.time,
          JSON.stringify(ne),
        );
      }
      db.prepare("UPDATE meta SET value='2' WHERE key='schema_version'").run();
      db.prepare("UPDATE meta SET value=? WHERE key='epoch'").run(randomUUID());
    }
  })();
}

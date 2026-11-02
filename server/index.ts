import { createServer } from "node:http";
import { MongoClient } from "mongodb";
import { accessVerifier } from "./access.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { readConfig } from "./config.ts";
import { prepareDatabase } from "./database.ts";
import { LiveConnections } from "./live.ts";
import { SessionManager } from "./session-manager.ts";
import { Weights } from "./weights.ts";

const config = readConfig();
const client = new MongoClient(
  process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
  { serverSelectionTimeoutMS: 5000 },
);

await client.connect();

const db = client.db(process.env.MONGODB_DATABASE?.trim() || "zetafly");
await prepareDatabase(db);

const auth = createAuth(db);
const weights = new Weights(db);
const identify = accessVerifier(auth, db);
const live = new LiveConnections(identify, config.origins);
const sessions = new SessionManager(
  db,
  (ownerId, packet) => live.broadcast(ownerId, packet),
  weights,
);
const app = createApp({
  db,
  auth,
  weights,
  sessions,
  identify,
  config,
  disconnectSession: (id) => live.disconnectSession(id),
});
const server = createServer(app);
live.attach(server, sessions);

server.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "127.0.0.1",
  () => console.log("Zetafly: http://localhost:3000"),
);

async function shutdown() {
  await sessions.close();
  live.close();
  server.close();
  await client.close();
}

process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));

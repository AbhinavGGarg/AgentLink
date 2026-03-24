import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { startAgentWorker } from "./lib/agents/worker";
import { initSocketServer } from "./lib/socket/server";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => handle(req, res));

    initSocketServer(server);
    startAgentWorker();

    server.listen(port, hostname, () => {
      console.log(`> AgentLink ready on http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start AgentLink server", error);
    process.exit(1);
  });

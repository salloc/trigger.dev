import { wssCatalog, WSSCatalog, ZodPublisher } from "internal-platform";
import { createServer } from "node:http";
import process from "node:process";
import { WebSocketServer } from "ws";
import { env } from "./env";
import { pulsarClient } from "./pulsarClient";
import { TriggerServer } from "./server";

// Create an HTTP server
const server = createServer((req, res) => {
  res.end("Hello, World!");
});

const triggerServers = new Map<string, TriggerServer>();

let shuttingDown = false;

process.on("SIGINT", async (code) => {
  await shutdown();

  process.exit();
});

process.on("SIGHUP", async (code) => {
  await shutdown();

  process.exit();
});

async function shutdown() {
  console.log("Shutting down...");

  shuttingDown = true;

  // Close all the trigger servers in a Promise.all
  await Promise.all(
    Array.from(triggerServers.values()).map((triggerServer) =>
      triggerServer.close()
    )
  );
}

// main
async function main() {
  const triggerPublisher = new ZodPublisher<WSSCatalog>({
    schema: wssCatalog,
    client: pulsarClient,
    config: {
      topic: `persistent://public/default/wss-events`,
    },
  });

  await triggerPublisher.initialize();

  // Listen on port from env
  const port = env.PORT;
  server.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    const apiKey = req.headers.authorization;

    if (!apiKey || typeof apiKey !== "string") {
      ws.close(1008, "Invalid API Key");
      return;
    }

    const keyPart = apiKey.split(" ")[1];

    const triggerServer = new TriggerServer(ws, keyPart, triggerPublisher);
    triggerServer.listen();

    triggerServers.set(keyPart, triggerServer);

    triggerServer.onClose.attach(() => {
      console.log(
        `Trigger server for key ${keyPart} closed. Removing it from the map.`
      );

      triggerServers.delete(keyPart);
    });
  });

  // Upgrade an HTTP connection to a WebSocket connection
  // Only accept the upgrade if there is a valid API Key in the authorization header
  server.on("upgrade", async (req, socket, head) => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }

    console.log(
      `Attemping to upgrade connection at url ${
        req.url
      } with headers: ${JSON.stringify(req.headers)}`
    );

    const url = new URL(req.url ?? "", "http://localhost");

    // Only upgrade the connecting if the path is `/ws`
    if (url.pathname !== "/ws") {
      socket.destroy(
        new Error(
          "Cannot connect because of invalid path: Please include `/ws` in the path of your upgrade request."
        )
      );
      return;
    }

    console.log(`Client connected, upgrading their connection...`);

    // Handle the WebSocket connection
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}

main().then(() => {
  console.log("Started");
});

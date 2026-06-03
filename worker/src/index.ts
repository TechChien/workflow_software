import { buildServer } from "./api/server.js";
import { env } from "./config/env.js";
import { startPoller } from "./worker/poller.js";

const server = await buildServer();

await server.listen({ host: env.HOST, port: env.PORT });
server.log.info(`worker API listening on ${env.HOST}:${env.PORT}`);

if (env.WORKER_POLLING_ENABLED) {
  startPoller();
}

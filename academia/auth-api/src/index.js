import { buildServer } from "./server.js";
import { config } from "./config.js";

const app = await buildServer();

app.listen({ port: config.port, host: config.host });


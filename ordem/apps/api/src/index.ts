import "dotenv/config";
import { buildServer } from "./server.js";
import { loadEnv } from "./config.js";

const env = loadEnv();

buildServer()
  .then((app) =>
    app.listen({ port: env.PORT, host: "0.0.0.0" }).then((address: string) => {
      app.log.info(`Ordem API listening on ${address}`);
    })
  )
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });

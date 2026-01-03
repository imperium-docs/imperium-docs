import "dotenv/config";
import { buildServer } from "./server";
import { loadEnv } from "./config";

const env = loadEnv();

buildServer()
  .then((app) =>
    app.listen({ port: env.PORT, host: "0.0.0.0" }).then((address) => {
      app.log.info(`Ordem API listening on ${address}`);
    })
  )
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

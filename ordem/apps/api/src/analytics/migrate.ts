import { runAnalyticsMigrations } from "./migrations.js";

runAnalyticsMigrations()
  .then(() => {
    console.log("Analytics migrations completed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

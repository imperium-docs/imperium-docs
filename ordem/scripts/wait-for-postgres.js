import net from "node:net";

const host = process.env.POSTGRES_HOST || "127.0.0.1";
const port = Number(process.env.POSTGRES_PORT || 5432);
const timeoutMs = Number(process.env.POSTGRES_WAIT_TIMEOUT || 60000);
const start = Date.now();

function check() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
  });
}

async function wait() {
  while (Date.now() - start < timeoutMs) {
    const ready = await check();
    if (ready) {
      console.log("Postgres is ready.");
      process.exit(0);
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  console.error("Timed out waiting for Postgres.");
  process.exit(1);
}

wait();

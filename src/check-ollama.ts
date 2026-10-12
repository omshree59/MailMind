import "dotenv/config";
import { configFromEnv } from "./config";
import { probeOllama } from "./analyze";

async function main(): Promise<void> {
  const config = configFromEnv();
  const probe = await probeOllama(config.ollamaBaseUrl, config.ollamaModel);
  console.log(JSON.stringify({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel, ...probe }, null, 2));
  if (!probe.ok || !probe.installed) process.exitCode = 1;
}

void main();

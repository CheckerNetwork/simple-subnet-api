import '../lib/instrument.js'
import { createApp } from '../lib/app.js'
import { DATABASE_URL, HOST, PORT, REQUEST_LOGGING, poolConfig } from '../lib/config.js'
import { RoundService } from '../lib/round-service.js'
import { createPgPool } from '../lib/pool.js'

const app = createApp({
  databaseUrl: DATABASE_URL,
  dbPoolConfig: poolConfig,
  logger: {
    level: ['1', 'true'].includes(REQUEST_LOGGING) ? 'info' : 'error'
  }
})
console.log('Starting the http server on host %j port %s', HOST, PORT)
const serverUrl = await app.listen({ host: HOST, port: Number(PORT) })
console.log(serverUrl)

const pool = await createPgPool(DATABASE_URL)
const roundService = new RoundService(
  pool,
  {
    roundDurationMs: 20 * 60 * 1000, // 20 minutes
    maxTasks: 100,
    maxTasksPerNode: 10,
    checkRoundIntervalMs: 1 * 60 * 1000 // 1 minute
  }
);

roundService.start();

process.on('SIGINT', async () => {
  console.log('Stopping round service...');
  roundService.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Stopping round service...');
  roundService.stop();
  process.exit(0);
});

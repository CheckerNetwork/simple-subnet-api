import '../lib/instrument.js'
import { createApp } from '../lib/app.js'
import { DATABASE_URL, HOST, PORT, REQUEST_LOGGING, poolConfig, roundServiceConfig, taskingServiceConfig } from '../lib/config.js'
import { TaskingService } from '../lib/tasking-service.js'
import { RoundService } from '../lib/round-service.js'
import { createPgPool } from '../lib/pool.js'

const pool = await createPgPool(DATABASE_URL)
const taskingService = new TaskingService(
  pool,
  taskingServiceConfig
)
const roundService = new RoundService(
  pool,
  taskingService,
  roundServiceConfig
)

roundService.start().catch((error) => {
  console.error('Failed to start round service:', error)
  process.exit(1)
})

process.on('SIGINT', async () => {
  console.log('Stopping round service...')
  roundService.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Stopping round service...')
  roundService.stop()
  process.exit(0)
})

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

import '../lib/instrument.js'
import { createApp } from '../lib/app.js'
import { DATABASE_URL, HOST, PORT, REQUEST_LOGGING, poolConfig } from '../lib/config.js'

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

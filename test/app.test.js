import { after, before, describe, it } from 'node:test'
import { migrateWithPgClient } from '../lib/migrate.js'
import { createPgPool } from '../lib/pool.js'
import { createApp } from '../lib/app.js'
import { assertResponseStatus } from './test-helpers.js'
import { DATABASE_URL, poolConfig } from '../lib/config.js'

describe('HTTP request handler', () => {
  /** @type {import('pg').Pool} */
  let pgPool
  /** @type {import('fastify').FastifyInstance} */
  let app
  /** @type {string} */
  let baseUrl

  before(async () => {
    pgPool = await createPgPool(DATABASE_URL)
    await migrateWithPgClient(pgPool)
    await pgPool.end()

    app = createApp({
      databaseUrl: DATABASE_URL,
      dbPoolConfig: poolConfig,
      logger: {
        level:
          process.env.DEBUG === '*' || process.env.DEBUG?.includes('test')
            ? 'debug'
            : 'error'
      }
    })

    baseUrl = await app.listen()
  })

  after(async () => {
    await app.close()
  })

  it('returns 200 for GET /', async () => {
    const res = await fetch(new URL('/', baseUrl))
    await assertResponseStatus(res, 200)
  })

  it('returns 404 when the path starts with double slash', async () => {
    const res = await fetch(`${baseUrl}//path-not-found`)
    await assertResponseStatus(res, 404)
  })

  it('returns 404 for unknown path', async () => {
    const res = await fetch(new URL('/unknown-path', baseUrl))
    await assertResponseStatus(res, 404)
  })
})

import assert from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { migrateWithPgClient } from '../lib/migrate.js'
import { createPgPool } from '../lib/pool.js'
import { createApp } from '../lib/app.js'
import {
  assertResponseStatus,
  postMeasurement,
  withSubnetMeasurements
} from './test-helpers.js'
import { DATABASE_URL, poolConfig } from '../lib/config.js'
import { today, yesterday } from '../lib/date.js'

describe('Subnet routes', () => {
  /** @type {import('pg').Pool} */
  let pgPool
  /** @type {import('fastify').FastifyInstance} */
  let app
  /** @type {string} */
  let baseUrl

  before(async () => {
    pgPool = await createPgPool(DATABASE_URL)
    await migrateWithPgClient(pgPool)

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
    await pgPool.end()
  })

  beforeEach(async () => {
    await pgPool.query('DELETE FROM daily_measurements')
  })

  describe('/:subnet/measurement', () => {
    it('submit successful measurement - no previous daily_measurements', async () => {
      const day = today()
      const subnet = 'walrus'
      const res = await postMeasurement(baseUrl, subnet, { retrievalSucceeded: true })
      await assertResponseStatus(res, 200)

      const { rows } = await pgPool.query(
        'SELECT total, successful FROM daily_measurements WHERE subnet = $1 AND day = $2',
        [subnet, day]
      )
      assert.deepStrictEqual(rows, [{ total: 1n, successful: 1n }])
    })

    it('submit successful measurement - has previous daily_measurements', async () => {
      const day = today()
      const subnet = 'walrus'
      await withSubnetMeasurements({ pgPool, day, subnet, successful: 0, total: 0 })
      const res = await postMeasurement(baseUrl, subnet, { retrievalSucceeded: true })
      await assertResponseStatus(res, 200)

      const { rows } = await pgPool.query(
        'SELECT total, successful FROM daily_measurements WHERE subnet = $1 AND day = $2',
        [subnet, day]
      )
      assert.deepStrictEqual(rows, [{ total: 1n, successful: 1n }])
    })

    it('submit unsuccessful measurement - no previous measurements', async () => {
      const day = today()
      const subnet = 'walrus'
      const res = await postMeasurement(baseUrl, subnet, { retrievalSucceeded: false })
      await assertResponseStatus(res, 200)
      const { rows } = await pgPool.query(
        'SELECT total, successful FROM daily_measurements WHERE subnet = $1 AND day = $2',
        [subnet, day]
      )
      assert.deepStrictEqual(rows, [{ total: 1n, successful: 0n }])
    })

    it('submit unsuccessful measurement - has previous measurements', async () => {
      const day = today()
      const subnet = 'walrus'
      await withSubnetMeasurements({ pgPool, day, subnet, total: 0, successful: 0 })
      const res = await postMeasurement(baseUrl, subnet, { retrievalSucceeded: false })
      await assertResponseStatus(res, 200)
      const { rows } = await pgPool.query(
        'SELECT total, successful FROM daily_measurements WHERE subnet = $1 AND day = $2',
        [subnet, day]
      )
      assert.deepStrictEqual(rows, [{ total: 1n, successful: 0n }])
    })

    it('submit successful measurement - unknown subnet', async () => {
      const day = today()
      const subnet = 'walrus'
      const unknownSubnet = 'unknown-subnet'
      await withSubnetMeasurements({ pgPool, day, subnet, total: 0, successful: 0 })

      const res = await postMeasurement(baseUrl, /** @type {any} */(unknownSubnet), { retrievalSucceeded: true })

      await assertResponseStatus(res, 400)
    })
  })

  describe('/:subnet/retrieval-success-rate', () => {
    it('returns retrieval success rate for today by default', async () => {
      const subnet = 'walrus'
      await withSubnetMeasurements({ pgPool, day: yesterday(), subnet, total: 10, successful: 5 })
      await withSubnetMeasurements({ pgPool, day: today(), subnet, total: 5, successful: 3 })

      const res = await fetch(new URL(`/${subnet}/retrieval-success-rate`, baseUrl))
      await assertResponseStatus(res, 200)

      /** @type {any} */
      const data = await res.json()
      assert.deepStrictEqual(data, [{ day: today(), total: '5', successful: '3' }])
    })

    it('sets default query string value for time range', async () => {
      const subnet = 'walrus'
      await withSubnetMeasurements({ pgPool, day: yesterday(), subnet, total: 10, successful: 5 })
      await withSubnetMeasurements({ pgPool, day: today(), subnet, total: 5, successful: 3 })

      const res = await fetch(new URL(`/${subnet}/retrieval-success-rate?from=${yesterday()}`, baseUrl))
      await assertResponseStatus(res, 200)

      /** @type {any} */
      const data = await res.json()
      assert.deepStrictEqual(data, [
        { day: yesterday(), total: '10', successful: '5' },
        { day: today(), total: '5', successful: '3' }
      ])
    })

    it('returns retrieval success rate for specified range', async () => {
      const from = '2025-01-01'
      const to = '2025-01-02'
      const subnet = 'walrus'
      // before range
      await withSubnetMeasurements({ pgPool, day: '2024-12-01', subnet, total: 5, successful: 5 })
      await withSubnetMeasurements({ pgPool, day: '2024-12-02', subnet, total: 3, successful: 2 })
      // in range
      await withSubnetMeasurements({ pgPool, day: '2025-01-01', subnet, total: 10, successful: 7 })
      await withSubnetMeasurements({ pgPool, day: '2025-01-02', subnet, total: 20, successful: 0 })
      // after range
      await withSubnetMeasurements({ pgPool, day: yesterday(), subnet, total: 10, successful: 5 })
      await withSubnetMeasurements({ pgPool, day: today(), subnet, total: 5, successful: 3 })

      const res = await fetch(new URL(`/${subnet}/retrieval-success-rate?from=${from}&to=${to}`, baseUrl))
      await assertResponseStatus(res, 200)

      /** @type {any} */
      const data = await res.json()
      assert.deepStrictEqual(data, [
        { day: from, total: '10', successful: '7' },
        { day: to, total: '20', successful: '0' }
      ])
    })

    it('returns 400 for unknown subnets', async () => {
      const res = await fetch(new URL('/unknown-subnet/retrieval-success-rate', baseUrl))
      await assertResponseStatus(res, 400)
    })
  })
})

import assert from 'assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createPgPool } from '../lib/pool.js'
import { migrateWithPgClient } from '../lib/migrate.js'
import { DATABASE_URL } from '../lib/config.js'
import { RoundService } from '../lib/round-service.js'
import { TaskingService } from '../lib/tasking-service.js'

const DEFAULT_CONFIG = {
  roundDurationMs: 1000,
  checkRoundIntervalMs: 200
}

describe('RoundService', () => {
  /** @type {import('pg').Pool} */
  let pgPool
  /** @type {TaskingService} */
  let taskingService

  before(async () => {
    pgPool = await createPgPool(DATABASE_URL)
    await migrateWithPgClient(pgPool)
    taskingService = new TaskingService(pgPool)
  })

  after(async () => {
    await pgPool.end()
  })

  beforeEach(async () => {
    // Reset the database state before each test
    await pgPool.query('DELETE FROM checker_rounds')
  })

  describe('rounds', () => {
    it('should create a new round if no active round exists', async () => {
      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()
      roundService.stop()

      const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      assert.strictEqual(rounds.length, 1)
      assert.ok(new Date(rounds[0].end_time) > new Date())
    })

    it('should resume an active round if one exists', async () => {
      const now = new Date()
      const endTime = new Date(now.getTime() + DEFAULT_CONFIG.roundDurationMs)
      await pgPool.query(`
        INSERT INTO checker_rounds (start_time, end_time, active)
        VALUES ($1, $2, $3)
      `, [now, endTime, true])

      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()
      roundService.stop()

      const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      assert.strictEqual(rounds.length, 1)
      assert.strictEqual(new Date(rounds[0].start_time).toISOString(), now.toISOString())
    })

    it('should stop the round service and prevent further round checks', async () => {
      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()
      roundService.stop()

      const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      assert.strictEqual(rounds.length, 1)

      // Wait for the check interval to pass and ensure no new rounds are created
      await new Promise(resolve => setTimeout(resolve, DEFAULT_CONFIG.checkRoundIntervalMs + 1000))

      const { rows: newRounds } = await pgPool.query('SELECT * FROM checker_rounds')
      assert.strictEqual(newRounds.length, 1)
    })
  })

  describe('round transitions', () => {
    it('should deactivate the old round and create a new one when the current round ends', async () => {
      const now = new Date()
      const endTime = new Date(now.getTime() + 1000) // 1 second duration
      await pgPool.query(`
        INSERT INTO checker_rounds (start_time, end_time, active)
        VALUES ($1, $2, $3)
      `, [now, endTime, true])

      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()

      // Wait for the current round to end
      await new Promise(resolve => setTimeout(resolve, 2000))

      roundService.stop()

      const { rows: activeRounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      assert.strictEqual(activeRounds.length, 1)
      assert.ok(new Date(activeRounds[0].start_time) > endTime)

      const { rows: allRounds } = await pgPool.query('SELECT * FROM checker_rounds')
      assert.strictEqual(allRounds.length, 2)
    })
  })
})

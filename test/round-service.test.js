import assert from 'assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createPgPool } from '../lib/pool.js'
import { migrateWithPgClient } from '../lib/migrate.js'
import { DATABASE_URL } from '../lib/config.js'
import { RoundService } from '../lib/round-service.js'
import { TaskingService } from '../lib/tasking-service.js'
import { withRound } from './test-helpers.js'

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
    taskingService = new TaskingService()
  })

  after(async () => {
    await pgPool.end()
  })

  beforeEach(async () => {
    // Reset the database state before each test
    await pgPool.query('DELETE FROM checker_rounds')
    await pgPool.query('ALTER SEQUENCE checker_rounds_id_seq RESTART WITH 1')
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
      await withRound({
        pgPool,
        roundDurationMs: DEFAULT_CONFIG.roundDurationMs,
        active: true
      })

      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()
      roundService.stop()

      const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      assert.strictEqual(rounds.length, 1)
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
      await withRound({
        pgPool,
        roundDurationMs: 1000, // 1 second duration
        active: true
      })

      const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

      await roundService.start()
      // Wait for the current round to end
      await new Promise(resolve => setTimeout(resolve, 2000))

      roundService.stop()

      const { rows: activeRounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
      const { rows: allRounds } = await pgPool.query('SELECT * FROM checker_rounds')
      assert.strictEqual(activeRounds.length, 1)
      assert.strictEqual(allRounds.length, 2)
    })
  })
})

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

describe('round and tasking service', () => {
  /** @type {import('pg').Pool} */
  let pgPool

  before(async () => {
    pgPool = await createPgPool(DATABASE_URL)
    await migrateWithPgClient(pgPool)
  })

  after(async () => {
    await pgPool.end()
  })

  beforeEach(async () => {
    // Reset the database state before each test
    await pgPool.query('DELETE FROM checker_rounds')
    await pgPool.query('ALTER SEQUENCE checker_rounds_id_seq RESTART WITH 1')
    await pgPool.query('DELETE FROM checker_subnet_tasks')
    await pgPool.query('ALTER SEQUENCE checker_subnet_tasks_id_seq RESTART WITH 1')
  })

  describe('RoundService', () => {
    describe('rounds', () => {
      it('should create a new round if no active round exists', async () => {
        const startTime = new Date()
        const endTime = new Date(startTime.getTime() + 1000) // 1 second duration
        await withRound({
          pgPool,
          startTime,
          endTime,
          active: false
        })
        const taskingService = new TaskingService(pgPool)
        const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

        await roundService.start()
        roundService.stop()

        const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
        assert.strictEqual(rounds.length, 1)
        assert.ok(new Date(rounds[0].end_time) > new Date())
      })

      it('should resume an active round if one exists', async () => {
        const startTime = new Date()
        const endTime = new Date(startTime.getTime() + 1000) // 1 second duration
        await withRound({
          pgPool,
          startTime,
          endTime,
          active: true
        })

        const taskingService = new TaskingService(pgPool)
        const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

        await roundService.start()
        roundService.stop()

        const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
        assert.strictEqual(rounds.length, 1)
        assert.strictEqual(new Date(rounds[0].start_time).toISOString(), startTime.toISOString())
      })

      it('should stop the round service and prevent further round checks', async () => {
        const taskingService = new TaskingService(pgPool)
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
        const startTime = new Date()
        const endTime = new Date(startTime.getTime() + 1000) // 1 second duration
        await withRound({
          pgPool,
          startTime,
          endTime,
          active: true
        })

        const taskingService = new TaskingService(pgPool)
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

  describe('TaskingService', () => {
    describe('registerTaskSampler', () => {
      it('should register a task sampler for a subnet', () => {
        const taskingService = new TaskingService(pgPool)
        const samplerFn = async () => []
        taskingService.registerTaskSampler('subnet1', samplerFn)

        assert.doesNotThrow(() => taskingService.registerTaskSampler('subnet1', samplerFn))
      })

      it('should throw an error if samplerFn is not a function', () => {
        const taskingService = new TaskingService(pgPool)
        assert.throws(
          // @ts-ignore
          () => taskingService.registerTaskSampler('subnet1', null),
          /Task sampler for subnet subnet1 must be a function/
        )
      })
    })

    describe('task generation', () => {
      it('should generate tasks for all registered subnets that dont throw errors', async () => {
        const taskingService = new TaskingService(pgPool)

        taskingService.registerTaskSampler('subnet1', async () => [
          { payloadId: 'task1', nodeId: 'node1' },
          { payloadId: 'task2', nodeId: 'node2' }
        ])

        taskingService.registerTaskSampler('subnet2', async () => [
          { payloadId: 'task3', nodeId: 'node3' }
        ])

        taskingService.registerTaskSampler('subnet3', async () => {
          throw new Error('Error sampling tasks')
        })

        const startTime = new Date()
        const endTime = new Date(startTime.getTime() + 1000) // 1 second duration
        const round = await withRound({
          pgPool,
          startTime,
          endTime
        })
        await taskingService.generateTasksForRound(round.id)
        const { rows: tasks } = await pgPool.query('SELECT * FROM checker_subnet_tasks WHERE round_id = $1', [round.id])

        const taskPayloads = tasks.map(task => task.task_definition)
        assert.deepStrictEqual(taskPayloads.sort(), [
          { payloadId: 'task1', nodeId: 'node1' },
          { payloadId: 'task2', nodeId: 'node2' },
          { payloadId: 'task3', nodeId: 'node3' }
        ])
      })

      it('should not generate tasks if no samplers are registered', async () => {
        const taskingService = new TaskingService(pgPool)
        const startTime = new Date()
        const endTime = new Date(startTime.getTime() + 1000) // 1 second duration
        const round = await withRound({
          pgPool,
          startTime,
          endTime,
          active: true
        })
        taskingService.generateTasksForRound(round.id)

        const { rows: tasks } = await pgPool.query('SELECT * FROM checker_subnet_tasks WHERE round_id = $1', [round.id])
        assert.strictEqual(tasks.length, 0)
      })
    })
  })
})

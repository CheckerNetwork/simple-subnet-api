import assert from 'assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createPgPool } from '../lib/pool.js'
import { migrateWithPgClient } from '../lib/migrate.js'
import { DATABASE_URL, poolConfig } from '../lib/config.js'
import { RoundService } from '../lib/round-service.js'
import { TaskingService } from '../lib/tasking-service.js'
import { createApp } from '../lib/app.js'

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
    await pgPool.query('DELETE FROM checker_subnet_tasks')
  })

  describe('RoundService', () => {
    describe('rounds', () => {
      it('should create a new round if no active round exists', async () => {
        const taskingService = new TaskingService(pgPool)
        const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

        await roundService.initializeRound()

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

        const taskingService = new TaskingService(pgPool)
        const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)

        await roundService.initializeRound()

        const { rows: rounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
        assert.strictEqual(rounds.length, 1)
        assert.strictEqual(new Date(rounds[0].start_time).toISOString(), now.toISOString())
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
        const now = new Date()
        const startTime = new Date(now.getTime() - 5000) // 5 seconds in the past
        const endTime = new Date(now.getTime() - 1000) // 1 second in the past
        // insert old round
        await pgPool.query(`
        INSERT INTO checker_rounds (start_time, end_time, active)
        VALUES ($1, $2, $3)
      `, [startTime, endTime, true])

        const taskingService = new TaskingService(pgPool)
        const roundService = new RoundService(pgPool, taskingService, DEFAULT_CONFIG)
        await roundService.initializeRound()

        // // Wait for the current round to end
        // await new Promise(resolve => setTimeout(resolve, 2000))

        const { rows: activeRounds } = await pgPool.query('SELECT * FROM checker_rounds WHERE active = true')
        assert.strictEqual(activeRounds.length, 1)
        // assert.ok(new Date(activeRounds[0].start_time) > now)

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

        const mockRound = await givenRound(pgPool)
        await taskingService.generateTasksForRound(mockRound.id)

        console.log('mockRound.id', mockRound.id)

        const { rows: tasks } = await pgPool.query('SELECT * FROM checker_subnet_tasks WHERE round_id = $1', [mockRound.id])

        const taskPayloads = tasks.map(task => task.task_definition)
        assert.deepStrictEqual(taskPayloads.sort(), [
          { payloadId: 'task1', nodeId: 'node1' },
          { payloadId: 'task2', nodeId: 'node2' },
          { payloadId: 'task3', nodeId: 'node3' }
        ])
      })

      it('should not generate tasks if no samplers are registered', async () => {
        const taskingService = new TaskingService(pgPool)

        const round = await givenRound(pgPool)
        taskingService.generateTasksForRound(round.id)

        const { rows: tasks } = await pgPool.query('SELECT * FROM checker_subnet_tasks WHERE round_id = $1', [round.id])
        assert.strictEqual(tasks.length, 0)
      })
    })
  })
  describe('round API routes', () => {
    /** @type {import('fastify').FastifyInstance} */
    let app
    /** @type {string} */
    let baseUrl

    before(async () => {
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

    describe('GET /rounds/current', () => {
      it('should return the current active round with tasks', async () => {
        const now = new Date()
        const endTime = new Date(now.getTime() + 1000)
        const round = await pgPool.query(`
          INSERT INTO checker_rounds (start_time, end_time, max_tasks_per_node, active)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [now, endTime, DEFAULT_CONFIG.maxTasksPerNode, true])

        const roundId = round.rows[0].id
        await pgPool.query(`
          INSERT INTO checker_subnet_tasks (round_id, subnet, task_definition)
          VALUES ($1, $2, $3)
        `, [roundId, 'walrus', { key: 'value' }])

        /** @type {any} */
        const response = await fetch(`${baseUrl}/rounds/current`)
        assert.strictEqual(response.status, 200)
        const responseBody = await response.json()
        assert.equal(responseBody.id, roundId)
        assert.strictEqual(responseBody.active, true)
        assert.strictEqual(responseBody.tasks.length, 1)
        assert.deepStrictEqual(responseBody.tasks, [{
          subnet: 'walrus',
          task_definition: { key: 'value' }
        }])
      })

      it('should return 404 if no current active', async () => {
        /** @type {any} */
        const response = await fetch(`${baseUrl}/rounds/current`)
        assert.strictEqual(response.status, 404)
      })
    })

    describe('GET /rounds/:roundId', () => {
      it('should return the round with the specified ID and its tasks', async () => {
        const now = new Date()
        const endTime = new Date(now.getTime() + 1000)
        const round = await pgPool.query(`
          INSERT INTO checker_rounds (start_time, end_time, max_tasks_per_node, active)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [now, endTime, DEFAULT_CONFIG.maxTasksPerNode, false])

        const roundId = round.rows[0].id
        await pgPool.query(`
          INSERT INTO checker_subnet_tasks (round_id, subnet, task_definition)
          VALUES ($1, $2, $3)
        `, [roundId, 'arweave', { key: 'value' }])

        /** @type {any} */
        const response = await fetch(`${baseUrl}/rounds/${roundId}`)
        assert.strictEqual(response.status, 200)
        const responseBody = await response.json()
        assert.equal(responseBody.id, roundId)
        assert.strictEqual(responseBody.active, false)
        assert.strictEqual(responseBody.tasks.length, 1)
        assert.deepStrictEqual(responseBody.tasks, [{
          subnet: 'arweave',
          task_definition: { key: 'value' }
        }])
      })

      it('should return 400 if roundId is not a number', async () => {
        const response = await fetch(`${baseUrl}/rounds/invalid`)
        assert.strictEqual(response.status, 400)
      })

      it('should return 404 if round is not found', async () => {
        /** @type {any} */
        const response = await fetch(`${baseUrl}/rounds/999999`)
        assert.strictEqual(response.status, 404)
      })
    })
  })
})

/**
 *
 * @param {import('../lib/typings.js').PgPool} pgPool
 */
const givenRound = async (pgPool, active = false) => {
  const now = new Date()
  const endTime = new Date(now.getTime() + 1000) // 1 second duration

  const { rows } = await pgPool.query(`
    INSERT INTO checker_rounds (start_time, end_time, active)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [now, endTime, active])

  return rows[0]
}

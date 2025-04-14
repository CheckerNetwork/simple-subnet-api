import assert from 'assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createPgPool } from '../lib/pool.js'
import { migrateWithPgClient } from '../lib/migrate.js'
import { DATABASE_URL } from '../lib/config.js'
import { TaskingService } from '../lib/tasking-service.js'

const DEFAULT_CONFIG = {
  maxTasks: 100
}

describe('TaskingService', () => {
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
    await pgPool.query('DELETE FROM checker_subnet_tasks')
  })

  describe('registerTaskSampler', () => {
    it('should register a task sampler for a subnet', () => {
      const taskingService = new TaskingService(pgPool, DEFAULT_CONFIG)
      const samplerFn = async () => []
      taskingService.registerTaskSampler('subnet1', samplerFn)

      assert.doesNotThrow(() => taskingService.registerTaskSampler('subnet1', samplerFn))
    })

    it('should throw an error if samplerFn is not a function', () => {
      const taskingService = new TaskingService(pgPool, DEFAULT_CONFIG)
      assert.throws(
        // @ts-ignore
        () => taskingService.registerTaskSampler('subnet1', null),
        /Task sampler for subnet subnet1 must be a function/
      )
    })
  })

  describe('task generation', () => {
    it('should generate tasks for all registered subnets that dont throw errors', async () => {
      const taskingService = new TaskingService(pgPool, DEFAULT_CONFIG)

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
      const taskingService = new TaskingService(pgPool, DEFAULT_CONFIG)

      const round = await givenRound(pgPool)
      taskingService.generateTasksForRound(round.id)

      const { rows: tasks } = await pgPool.query('SELECT * FROM checker_subnet_tasks WHERE round_id = $1', [round.id])
      assert.strictEqual(tasks.length, 0)
    })
  })
})

/**
 *
 * @param {import('../lib/typings.js').PgPool} pgPool
 */
const givenRound = async (pgPool, maxTasksPerNode = 100) => {
  const now = new Date()
  const endTime = new Date(now.getTime() + 1000) // 1 second duration
  const { rows } = await pgPool.query(`
    INSERT INTO checker_rounds (start_time, end_time, max_tasks_per_node, active)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [now, endTime, maxTasksPerNode, false])

  return rows[0]
}

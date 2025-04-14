/** @typedef {any} Task */
/** @typedef {(maxTasks: number) => Promise<Task[]>} TaskSamplingFn */
/** @typedef {{ maxTasksPerSubnet: number }} TaskingConfig */

export class TaskingService {
  #db
  #config
  /**
   * @type {Record<string, TaskSamplingFn>}
   */
  #taskSamplers = {}

  /**
   * @param {import('./typings.js').PgPool} db
   * @param {TaskingConfig} config
   */
  constructor (db, config) {
    this.#db = db
    this.#config = config
  }

  /**
   * Register a task sampler for a specific subnet
   * @param {string} subnet - The subnet identifier
   * @param {TaskSamplingFn} sampleFn - Function that generates tasks for a subnet
   */
  registerTaskSampler (subnet, sampleFn) {
    if (typeof sampleFn !== 'function') {
      throw new Error(`Task sampler for subnet ${subnet} must be a function`)
    }
    this.#taskSamplers[subnet] = sampleFn
    console.log(`Task sampler registered for subnet: ${subnet}`)
  }

  /**
   * Generate tasks for all registered subnets for a specific round
   * @param {number} roundId
   */
  async generateTasksForRound (roundId) {
    console.log(`Generating tasks for round #${roundId}`)

    const subnets = Object.keys(this.#taskSamplers)
    if (subnets.length === 0) {
      console.warn('No task samplers registered. No tasks will be generated.')
      return
    }

    await Promise.all(subnets.map(subnet => this.#generateTasksForSubnet(roundId, subnet)))
  }

  /**
   * Generate tasks for a specific subnet
   * @param {number} roundId
   * @param {string} subnet
   */
  async #generateTasksForSubnet (roundId, subnet) {
    try {
      const taskSamplingFn = this.#taskSamplers[subnet]
      if (!taskSamplingFn) return

      console.log(`Sampling tasks for subnet: ${subnet}`)
      const tasks = await Promise.resolve(taskSamplingFn(this.#config.maxTasksPerSubnet))

      if (Array.isArray(tasks) && tasks.length > 0) {
        await this.#storeTasks(roundId, subnet, tasks)
        console.log(`Generated ${tasks.length} tasks for subnet ${subnet} in round #${roundId}`)
      } else {
        console.warn(`No tasks generated for subnet ${subnet} in round #${roundId}`)
      }
    } catch (error) {
      console.error(`Error generating tasks for subnet ${subnet}:`, error)
    }
  }

  /**
   * Store tasks in the database
   * @param {number} roundId
   * @param {string} subnet
   * @param {Array<Task>} tasks
   */
  async #storeTasks (roundId, subnet, tasks) {
    const client = await this.#db.connect()

    try {
      await client.query('BEGIN')
      await client.query(`
        INSERT INTO checker_subnet_tasks (round_id, subnet, task_definition)
        SELECT $1, $2, task_definition
        FROM UNNEST($3::JSONB[]) AS t(task_definition)
      `, [
        roundId,
        subnet,
        tasks.map(task => JSON.stringify(task))
      ])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      console.error(`Error storing tasks for subnet ${subnet}:`, error)
      throw error
    } finally {
      client.release()
    }
  }
}

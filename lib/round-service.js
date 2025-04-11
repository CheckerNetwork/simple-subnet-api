/** @typedef {any} Task */
/** @typedef {{id: number; start_time: string; end_time: string; max_tasks_per_node: number; }} Round */
/** @typedef {{ roundDurationMs: number; maxTasks: number; maxTasksPerNode: number; checkRoundIntervalMs: number }} Config */

export class RoundService {
  /**
   * @type {Object<string, Function>}
   * @description A mapping of subnet identifiers to their task sampler functions.
   */
  #taskSamplers = {}
  /**
   * @type {Round | null}
   */
  #currentRound = null
  #isInitializing = false
  /**
   * @type {NodeJS.Timeout | null}
   */
  #checkRoundIntervalId = null
  #db
  #config

  /**
   * @param {import('./typings.js').PgPool} db
   * @param {Config} config
   */
  constructor (db, config) {
    this.#db = db
    this.#config = config
  }

  /**
   * Register a task sampler for a specific subnet
   * @param {string} subnet - The subnet identifier
   * @param {Function} samplerFn - Function that generates tasks for a subnet
   */
  registerTaskSampler (subnet, samplerFn) {
    if (typeof samplerFn !== 'function') {
      throw new Error(`Task sampler for subnet ${subnet} must be a function`)
    }
    this.#taskSamplers[subnet] = samplerFn
    console.log(`Task sampler registered for subnet: ${subnet}`)
  }

  /**
   * Start the round service
   */
  async start () {
    if (this.#isInitializing) return
    this.#isInitializing = true

    try {
      await this.#initializeRound()
      this.#scheduleRoundCheck()
      console.log(`Round service started. Round duration: ${this.#config.roundDurationMs / 60000} minutes`)
    } catch (error) {
      console.error('Failed to start round service:', error)
    } finally {
      this.#isInitializing = false
    }
  }

  /**
   * Stop the round service
   */
  stop () {
    if (this.#checkRoundIntervalId) clearInterval(this.#checkRoundIntervalId)
    console.log('Round service stopped')
  }

  /**
   * Initialize the current round
   */
  async #initializeRound () {
    const activeRound = await this.#getActiveRound()

    if (activeRound) {
      this.#currentRound = activeRound
      console.log(`Resuming active round #${activeRound.id}`)
    } else {
      await this.#startNewRound()
    }
  }

  /**
   * Schedule periodic checks for round end
   */
  #scheduleRoundCheck () {
    this.#checkRoundIntervalId = setInterval(async () => {
      if (!this.#currentRound) return

      const now = new Date()
      if (new Date(this.#currentRound.end_time) <= now) {
        try {
          await this.#startNewRound()
        } catch (error) {
          console.error('Error handling round end:', error)
        }
      }
    }, this.#config.checkRoundIntervalMs)
  }

  /**
   * Start a new round
   */
  async #startNewRound () {
    const previousRound = await this.#getActiveRound()
    this.#currentRound = await this.#createNewRound()
    if (!this.#currentRound) {
      throw new Error('Failed to start a new round')
    }

    if (previousRound) {
      await this.changeRoundActive(previousRound.id, false)
    }

    await this.changeRoundActive(this.#currentRound.id, true)
    await this.#generateTasksForRound(this.#currentRound.id)
  }

  /**
   * Get the current active round from the database
   */
  async #getActiveRound () {
    try {
      const { rows } = await this.#db.query(`
        SELECT * FROM checker_rounds 
        WHERE active = true
        ORDER BY start_time DESC
        LIMIT 1
      `)
      return rows[0] || null
    } catch (error) {
      console.error('Error getting active round:', error)
      return null
    }
  }

  /**
   * Create a new round
   */
  async #createNewRound () {
    try {
      const now = new Date()
      const endTime = new Date(now.getTime() + this.#config.roundDurationMs)

      const { rows } = await this.#db.query(`
        INSERT INTO checker_rounds (start_time, end_time, max_tasks_per_node, active)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [now, endTime, this.#config.maxTasksPerNode, true])

      const round = rows[0]
      console.log(`Created new round #${round.id} starting at ${round.start_time}`)
      return round
    } catch (error) {
      console.error('Error creating new round:', error)
      throw error
    }
  }

  /**
   * Change the status of a round using a transaction
   * @param {number} roundId
   * @param {Boolean} active
   */
  async changeRoundActive (roundId, active) {
    const client = await this.#db.connect()

    try {
      await client.query('BEGIN')
      const { rows } = await client.query(`
        UPDATE checker_rounds
        SET active = $1
        WHERE id = $2
        RETURNING *
      `, [active, roundId])
      await client.query('COMMIT')

      console.log(`Round #${rows[0].id} active: ${rows[0].active}`)
      return rows[0]
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Error changing round status:', error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Generate tasks for all registered subnets for a specific round
   * @param {number} roundId
   */
  async #generateTasksForRound (roundId) {
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
      const sampler = this.#taskSamplers[subnet]
      if (!sampler) return

      console.log(`Sampling tasks for subnet: ${subnet}`)
      const tasks = await Promise.resolve(sampler())

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

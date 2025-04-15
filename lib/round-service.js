/** @typedef {{id: number; start_time: string; end_time: string; }} Round */
/** @typedef {{ roundDurationMs: number; checkRoundIntervalMs: number }} RoundConfig */

export class RoundService {
  /**
   * @type {Round | null}
   */
  #currentRound = null
  /**
   * @type {NodeJS.Timeout | null}
   */
  #checkRoundIntervalId = null
  #db
  #config
  #taskingService

  /**
   * @param {import('./typings.js').PgPool} db
   * @param {import('./tasking-service.js').TaskingService} taskingService
   * @param {RoundConfig} config
   */
  constructor (db, taskingService, config) {
    this.#db = db
    this.#config = config
    this.#taskingService = taskingService
  }

  /**
   * Start the round service
   */
  async start () {
    try {
      await this.#initializeRound()
      this.#scheduleRoundCheck()
      console.log(`Round service started. Round duration: ${this.#config.roundDurationMs / 60000} minutes`)
    } catch (error) {
      console.error('Failed to start round service:', error)
      throw err
      throw error
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

    if (activeRound && !activeRound.is_expired) {
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

    await this.#taskingService.generateTasksForRound(this.#currentRound.id)

    if (previousRound) {
      await this.#changeRoundActive({ roundId: previousRound.id, active: false })
    }

    await this.#changeRoundActive({ roundId: this.#currentRound.id, active: true })
  }

  /**
   * Get the current active round from the database
   * @returns {Promise<Round & {is_expired: Boolean} | null>}
   */
  async #getActiveRound () {
    try {
      const { rows } = await this.#db.query(`
        SELECT 
          cr.*, 
          cr.end_time <= NOW() AS is_expired
        FROM checker_rounds cr
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
   *
   * @returns {Promise<Round>}
   * @throws {Error} if the round creation fails
   */
  async #createNewRound () {
    try {
      const { rows } = await this.#db.query(`
        INSERT INTO checker_rounds (start_time, end_time, active)
        VALUES (
          NOW(), 
          NOW() + ($1 || ' milliseconds')::INTERVAL,
          $2
        )
        RETURNING *
      `, [this.#config.roundDurationMs, false])

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
   * @param {object} args
   * @param {number} args.roundId
   * @param {Boolean} args.active
   */
  async #changeRoundActive ({ roundId, active }) {
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
}

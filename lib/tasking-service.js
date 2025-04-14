/** @typedef {any} Task */
/** @typedef {() => Promise<Task[]>} TaskSamplingFn */
/** @typedef {{ maxTasks: number }} TaskingConfig */

export class TaskingService {
  #db
  #config

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
    console.warn('Registering task sampler is not implmented.')
  }

  /**
   * Generate tasks for all registered subnets for a specific round
   * @param {number} roundId
   */
  async generateTasksForRound (roundId) {
    // TODO: Implement the logic to generate tasks for all registered subnets
    console.warn('Tasking service is not implemented.')
  }
}

import { AssertionError } from 'node:assert'

/**
 * @param {Response} res
 * @param {number} status
 */
export const assertResponseStatus = async (res, status) => {
  if (res.status !== status) {
    throw new AssertionError({
      actual: res.status,
      expected: status,
      message: await res.text()
    })
  }
}

/**
 * @param {object} args
 * @param {import('../lib/typings.js').PgPool} args.pgPool
 * @param {string} args.day
 * @param {import('../lib/typings.js').Subnet} args.subnet
 * @param {number} args.total
 * @param {number} args.successful
 */
export const withSubnetMeasurements = async ({
  pgPool,
  day,
  subnet,
  total,
  successful
}) => {
  await pgPool.query(
    'INSERT INTO daily_measurements (day, subnet, total, successful) VALUES ($1, $2, $3, $4)',
    [day, subnet, total, successful]
  )
}

/**
 * @param {string} baseUrl
 * @param {import('../lib/typings.js').Subnet} subnet
 * @param {{retrievalSucceeded: boolean}} measurement
 */
export const postMeasurement = (baseUrl, subnet, measurement) => {
  return fetch(new URL(`/${subnet}/measurement`, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(measurement)
  })
}

/**
 * @param {object} args
 * @param {import('../lib/typings.js').PgPool} args.pgPool
 * @param {Date} args.startTime
 * @param {Date} args.endTime
 * @param {boolean} [args.active=false]
 */
export const withRound = async ({ pgPool, startTime, endTime, active = false }) => {
  const { rows } = await pgPool.query(`
    INSERT INTO checker_rounds (start_time, end_time, active)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [startTime, endTime, active])

  return rows[0]
}

/**
 *
 * @param {import('../lib/typings.js').PgPool} pgPool
 * @param {string} roundId
 * @param {string} subnet
 * @param {object} task
 */
export const withSubnetTasks = async (pgPool, roundId, subnet, task) => {
  await pgPool.query(`
    INSERT INTO checker_subnet_tasks (round_id, subnet, task_definition)
    VALUES ($1, $2, $3)`, [roundId, subnet, task])
}

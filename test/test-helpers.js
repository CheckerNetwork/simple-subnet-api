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

// @ts-ignore
export const withSubnetMeasurements = async (
  pgPool,
  subnet,
  total,
  successful
) => {
  await pgPool.query(
    'INSERT INTO measurements (subnet_id, total, successful) VALUES ($1, $2, $3)',
    [subnet, total, successful]
  )
}

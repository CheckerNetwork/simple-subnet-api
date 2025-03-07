/** @import { RequestWithSubnet } from './typings.js' */
/** @import { FastifyInstance, FastifyReply } from 'fastify' */

import { today } from './date.js'

const subnetRoutesDefaultParamsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subnet: {
      type: 'string',
      pattern: '^(walrus|arweave)$'
    }
  },
  required: ['subnet']
}

/**
 * Define the subnet routes
 * @param {FastifyInstance} app
 */
export const subnetRoutes = (app) => {
  app.post(
    '/:subnet/measurement',
    {
      schema: {
        params: subnetRoutesDefaultParamsSchema,
        body: {
          type: 'object',
          properties: {
            retrievalSucceeded: {
              type: 'boolean'
            }
          },
          required: ['retrievalSucceeded']
        }
      }
    },
    /**
     * @param {RequestWithSubnet<{retrievalSucceeded: boolean}>} request
     * @param {FastifyReply} reply
     */
    async (request, reply) => {
      const client = await app.pg.connect()
      try {
        await client.query(
          `INSERT INTO daily_measurements (subnet, day, total, successful)
           VALUES ($1, current_date, 1, $2)
           ON CONFLICT (subnet, day)
           DO UPDATE SET total = daily_measurements.total + 1, successful = daily_measurements.successful + $2`,
          [request.params.subnet, request.body.retrievalSucceeded ? 1 : 0]
        )
      } finally {
        client.release()
      }
    }
  )

  app.get(
    '/:subnet/retrieval-success-rate',
    {
      schema: {
        params: subnetRoutesDefaultParamsSchema,
        querystring: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              format: 'date'
            },
            to: {
              type: 'string',
              format: 'date'
            }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: {
                  type: 'string',
                  format: 'date'
                },
                total: {
                  type: 'string',
                  format: 'int64',
                  pattern: '^[0-9]*$'
                },
                successful: {
                  type: 'string',
                  format: 'int64',
                  pattern: '^[0-9]*$'
                }
              },
              required: ['total', 'successful']
            }
          }
        }
      }
    },
    /**
     * @param {RequestWithSubnet<{}, {from: string; to: string}>} request
     * @param {FastifyReply} reply
     */
    async (request, reply) => {
      const client = await app.pg.connect()
      const from = request.query.from || today()
      const to = request.query.to || today()
      try {
        const { rows } = await client.query(
          `SELECT day, total, successful FROM daily_measurements
           WHERE subnet = $1 AND day >= $2 AND day <= $3
           GROUP BY subnet, day ORDER BY day`,
          [request.params.subnet, from, to]
        )
        reply.send(rows)
      } finally {
        client.release()
      }
    }
  )
}

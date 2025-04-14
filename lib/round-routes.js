/** @import { RequestWithRoundId } from './typings.js' */
/** @import { FastifyInstance, FastifyReply } from 'fastify' */

const roundResponse = {
  200: {
    type: 'object',
    properties: {
      id: {
        type: 'number',
        format: 'bigint'
      },
      start_time: {
        type: 'string',
        format: 'datetime'
      },
      end_time: {
        type: 'string',
        format: 'datetime'
      },
      active: {
        type: 'boolean'
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subnet: {
              type: 'string',
              pattern: '^(walrus|arweave)$'
            },
            task_definition: {
              type: 'object'
            }
          }
        }
      }
    }
  }
}

/**
 * Define the round routes
 * @param {FastifyInstance} app
 */
export const roundRoutes = (app) => {
  app.get(
    '/rounds/current',
    {
      schema: {
        response: roundResponse
      }
    },
    /**
     * @param {RequestWithRoundId} request
     * @param {FastifyReply} reply
     */
    async (request, reply) => {
      const client = await app.pg.connect()
      try {
        const { rows } = await client.query(
          `SELECT
              cr.*,
              CASE
                  WHEN COUNT(cst.*) > 0 THEN json_agg(
                      json_build_object(
                          'subnet', cst.subnet,
                          'task_definition', cst.task_definition
                      )
                  )
                  ELSE '[]'::json
              END AS tasks
          FROM
              checker_rounds cr
          LEFT JOIN
              checker_subnet_tasks cst ON cr.id = cst.round_id
          WHERE
              cr.active = true
          GROUP BY
              cr.id
          ORDER BY
              cr.id DESC
          LIMIT 1`
        )
        reply.send(rows[0])
      } finally {
        client.release()
      }
    })

  app.get(
    '/rounds/:roundId',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          properties: {
            roundId: {
              type: 'number'
            }
          },
          required: ['roundId']
        },
        response: roundResponse
      }
    },
    /**
       * @param {RequestWithRoundId} request
       * @param {FastifyReply} reply
       */
    async (request, reply) => {
      const client = await app.pg.connect()
      try {
        const roundId = Number(request.params.roundId)
        const { rows } = await client.query(
            `SELECT
                cr.*,
                CASE
                    WHEN COUNT(cst.*) > 0 THEN json_agg(
                        json_build_object(
                            'subnet', cst.subnet,
                            'task_definition', cst.task_definition
                        )
                    )
                    ELSE '[]'::json
                END AS tasks
            FROM
                checker_rounds cr
            LEFT JOIN
                checker_subnet_tasks cst ON cr.id = cst.round_id
            WHERE
                cr.id = $1
            GROUP BY
                cr.id`,
            [roundId]
        )
        reply.send(rows[0])
      } finally {
        client.release()
      }
    })
}

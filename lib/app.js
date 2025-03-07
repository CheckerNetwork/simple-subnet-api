import * as Sentry from '@sentry/node'
import Fastify from 'fastify'
import pg from '@fastify/postgres'
import { subnetRoutes } from './subnet-routes.js'

/**
 * @param {object} args
 * @param {string} args.databaseUrl
 * @param {import('pg').PoolConfig} args.dbPoolConfig
 * @param {Fastify.FastifyLoggerOptions} args.logger
 * @returns
 */
export const createApp = ({ databaseUrl, dbPoolConfig, logger }) => {
  const app = Fastify({ logger })
  Sentry.setupFastifyErrorHandler(app)
  app.register(pg, { ...dbPoolConfig, connectionString: databaseUrl })
  app.get('/', async function handler (request, reply) {
    return 'OK'
  })

  app.register(subnetRoutes)
  return app
}

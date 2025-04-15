const {
  // DATABASE_URL points to `simple_subnet_api` database managed by this repository
  DATABASE_URL = 'postgres://localhost:5432/simple_subnet_api',
  PORT = '8080',
  HOST = '127.0.0.1',
  REQUEST_LOGGING = 'true'
} = process.env

const poolConfig = {
  // allow the pool to close all connections and become empty
  min: 0,
  // this values should correlate with service concurrency hard_limit configured in fly.toml
  // and must take into account the connection limit of our PG server, see
  // https://fly.io/docs/postgres/managing/configuration-tuning/
  max: 100,
  // close connections that haven't been used for one second
  idleTimeoutMillis: 1000,
  // automatically close connections older than 60 seconds
  maxLifetimeSeconds: 60
}

const roundServiceConfig = {
  roundDurationMs: 1_200_000, // 20 minutes
  checkRoundExpirationIntervalMs: 60_000 // 1 minute
}

export { DATABASE_URL, PORT, HOST, REQUEST_LOGGING, poolConfig, roundServiceConfig }

import pg from "pg";
import { FastifyRequest } from "fastify";

export type Subnet = "walrus" | "arweave";

export type RequestWithSubnet = FastifyRequest<{
  Parameters: { subnet: string };
}>;

export interface Logger {
  info: typeof console.info;
  error: typeof console.error;
  request: typeof console.info;
}

export type PgPool = pg.Pool;

// Copied from import('@types/pg').
export type Queryable = Pick<Pool, "query">;
export type UnknownRow = Record<string, unknown>;
export type QueryResultWithUnknownRows = pg.QueryResult<UnknownRow>;

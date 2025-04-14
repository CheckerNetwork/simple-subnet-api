import pg from "pg";
import { FastifyRequest } from "fastify";

export type Subnet = "walrus" | "arweave";

export type RequestWithSubnet<TBody = {}, UQuery = {}> = FastifyRequest<{
  Params: { subnet: string };
  Body: TBody;
  Querystring: UQuery;
}>;

export type RequestWithRoundId<TBody = {}, UQuery = {}> = FastifyRequest<{
  Params: { roundId: string };
  Body: TBody;
  Querystring: UQuery;
}>;

export interface Logger {
  info: typeof console.info;
  error: typeof console.error;
  request: typeof console.info;
}

export type PgPool = pg.Pool;

export type Queryable = Pick<Pool, "query">;
export type UnknownRow = Record<string, unknown>;
export type QueryResultWithUnknownRows = pg.QueryResult<UnknownRow>;

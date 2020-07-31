import { ApolloServerExpressConfig } from "apollo-server-express";
import * as express from "express";
import { ExecutionParams } from "subscriptions-transport-ws";
import { ContainerInstance } from "@kaviar/core";

export interface IApolloBundleConfig {
  port?: number;
  apollo?: ApolloServerExpressConfig;
  enableSubscriptions?: boolean;
  middlewares?: any[];
  routes?: IRouteType[];
}

export interface IRouteType {
  type: "post" | "get" | "put" | "all";
  path: string;
  handler: (
    req: express.Request,
    res: express.Response,
    container: ContainerInstance
  ) => any;
  urlencoded?: boolean;
  json?: boolean;
}

export interface IGraphQLContext {
  req: express.Request;
  res: express.Response;
  connection?: ExecutionParams;
  container: ContainerInstance;
}

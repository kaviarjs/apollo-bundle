import "@kaviar/graphql-bundle";
import { ContainerInstance } from "@kaviar/core";
import * as express from "express";
import { ExecutionParams } from "subscriptions-transport-ws";

declare module "@kaviar/graphql-bundle" {
  export interface IGraphQLContext {
    container: ContainerInstance;
    req: express.Request;
    res: express.Response;
    connection?: ExecutionParams;
  }
}

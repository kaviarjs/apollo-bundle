import "@kaviar/graphql-bundle";
import { ContainerInstance } from "@kaviar/core";

declare module "@kaviar/graphql-bundle" {
  export interface IGraphQLContext {
    container: ContainerInstance;
  }
}

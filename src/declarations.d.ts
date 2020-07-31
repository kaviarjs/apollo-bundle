import "@kaviar/loader";
import { ContainerInstance } from "@kaviar/core";

declare module "@kaviar/loader" {
  export interface IGraphQLContext {
    container: ContainerInstance;
  }
}

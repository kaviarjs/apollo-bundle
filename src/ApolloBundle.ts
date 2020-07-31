import { Bundle, KernelAfterInitEvent, EventManager } from "@kaviar/core";
import { Loader, IResolverMap } from "@kaviar/loader";
import { DateScalar, JSONScalar } from "./scalars";
import * as http from "http";
import * as express from "express";
import { ApolloServer, ApolloServerExpressConfig } from "apollo-server-express";

import {
  ApolloServerAfterInitEvent,
  ApolloServerBeforeInitEvent,
  WebSocketOnConnectEvent,
  WebSocketOnDisconnectEvent,
} from "./events";
import { IApolloBundleConfig } from "./defs";
import { ApolloResolverExceptionEvent } from "./events";

export class ApolloBundle extends Bundle<IApolloBundleConfig> {
  defaultConfig = {
    port: 4000,
    apollo: {},
    enableSubscriptions: false,
    middlewares: [],
  };

  public httpServer: http.Server;
  public app: express.Application;
  public server: ApolloServer;

  async validate(config) {
    const keys = Object.keys(config.apollo);
    if (
      keys.includes("typeDefs") ||
      keys.includes("schemaDirectives") ||
      keys.includes("resolvers") ||
      keys.includes("subscriptions")
    ) {
      throw new Error(
        `You have to use the 'Loader' if you wish to load these into the API`
      );
    }
  }

  async prepare() {
    // We add the container to the context in the preparation phase
    // As loading should be done in initial phase and we have the container as the first reducer
    const loader = this.get<Loader>(Loader);

    loader.load({
      contextReducers: [this.getContainerContextReducer()],
    });
  }

  async init() {
    const manager = this.get<EventManager>(EventManager);

    manager.addListener(KernelAfterInitEvent, async () => {
      await this.setupApolloServer();
    });
  }

  /**
   * Creates the config, initialises the server and starts it.
   */
  private async setupApolloServer() {
    const apolloServerConfig = this.getApolloConfig();
    await this.initialiseServer(apolloServerConfig);
    return this.startServer();
  }

  /**
   * Starts the http server listening process
   */
  protected async startServer() {
    const { app, httpServer, server } = this;
    const manager = this.get<EventManager>(EventManager);

    // server starting
    const appUrl = this.kernel.parameters.APP_URL || "http://localhost";
    console.log("Starting Apollo Server...");
    return new Promise((resolve) => {
      httpServer.listen(this.config.port, (data) => {
        console.log(`Server ready: ${appUrl}:${this.config.port}/graphql`);
        resolve();
        manager.emit(
          new ApolloServerAfterInitEvent({
            app,
            httpServer,
            server,
          })
        );
      });
    });
  }

  /**
   * This function purely initialises the server
   */
  protected async initialiseServer(
    apolloServerConfig: ApolloServerExpressConfig
  ) {
    const manager = this.get<EventManager>(EventManager);

    const apolloServer = new ApolloServer(apolloServerConfig);
    const app = express();

    if (this.config.middlewares.length) {
      app.use(...this.config.middlewares);
    }

    app.use((req, res, next) => {
      res.setHeader("X-Framework", "Kaviar");
      next();
    });

    apolloServer.applyMiddleware({ app });

    const httpServer = http.createServer(app);

    if (this.config.enableSubscriptions) {
      apolloServer.installSubscriptionHandlers(httpServer);
    }

    this.app = app;
    this.httpServer = httpServer;
    this.server = apolloServer;

    await manager.emit(
      new ApolloServerBeforeInitEvent({
        app,
        httpServer,
        server: apolloServer,
      })
    );
  }

  /**
   * Returns the ApolloConfiguration for ApolloServer
   */
  protected getApolloConfig(): ApolloServerExpressConfig {
    const loader = this.get<Loader>(Loader);

    loader.load(DateScalar);
    loader.load(JSONScalar);
    loader.load({
      typeDefs: `
        type Query { framework: String }
      `,
      resolvers: {
        Query: {
          framework: () => "Kaviar",
        },
      },
    });

    let {
      typeDefs,
      resolvers,
      schemaDirectives,
      contextReducers,
    } = loader.getSchema();

    this.manipulateResolversToEmitExceptionEvent(resolvers);

    return Object.assign(
      {
        cors: true,
        formatError: (e) => {
          console.error(`Error has occured`, JSON.stringify(e, null, 4));

          return {
            message: e.message,
            locations: e.locations,
            path: e.path,
          };
        },
      },
      this.config.apollo,
      {
        typeDefs,
        resolvers,
        schemaDirectives,
        subscriptions: this.createSubscriptions(contextReducers),
        context: this.createContext(contextReducers),
      }
    );
  }

  /**
   * Creates the function for handling GraphQL contexts
   */
  protected createContext(contextReducers = []) {
    const contextHandler = async (context) => {
      context = await this.applyContextReducers(context, contextReducers);

      return context;
    };

    return contextHandler;
  }

  /**
   * Creates the object necessary to pass `subscriptions` to apollo
   */
  protected createSubscriptions(contextReducers: any) {
    const manager = this.get<EventManager>(EventManager);

    return {
      onConnect: async (connectionParams, webSocket, context) => {
        context = await this.applyContextReducers(context, contextReducers);

        await manager.emit(
          new WebSocketOnConnectEvent({
            connectionParams,
            webSocket,
            context,
          })
        );

        return context;
      },
      onDisconnect: async (webSocket, context) => {
        await manager.emit(
          new WebSocketOnDisconnectEvent({
            webSocket,
            context,
          })
        );

        return context;
      },
    };
  }

  /**
   * Injects container into context
   */
  protected getContainerContextReducer() {
    return async (context) => ({
      ...context,
      container: this.container,
    });
  }

  /**
   * Applies reducing of context
   */
  protected async applyContextReducers(context: any, reducers: any) {
    for (const reducer of reducers) {
      context = await reducer(context);
    }

    return context;
  }

  /**
   * This just wraps the functions to also emit an error event when this happens
   * @param resolvers
   */
  protected manipulateResolversToEmitExceptionEvent(resolvers: IResolverMap) {
    const eventManager = this.get<EventManager>(EventManager);
    const resolverKeys = ["Query", "Mutation"];

    resolverKeys.forEach((key) => {
      for (const name in resolvers[key]) {
        const oldFn = resolvers[key][name];
        resolvers[key][name] = async (...args) => {
          try {
            return await oldFn.call(null, ...args);
          } catch (e) {
            await eventManager.emit(
              new ApolloResolverExceptionEvent({
                arguments: args,
                resolverType: key,
                resolverName: name,
                exception: e,
              })
            );

            throw e;
          }
        };
      }
    });
  }

  /**
   * Add a middleware for express() before server initialises
   */
  public addMiddleware(middleware) {
    this.config.middlewares.push(middleware);
  }

  /**
   * @param path
   * @param handler
   */
  public addServerSideRoute(path, handler) {
    // TODO:
  }
}

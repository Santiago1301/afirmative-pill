/**
 * Punto de entrada. ÚNICO endpoint expuesto: /graphql
 *   • HTTP POST/GET  → Queries y Mutations (Apollo Server)
 *   • WebSocket      → Subscriptions (graphql-ws), mismo path
 * No existe ninguna ruta REST (Zero-REST Mandate).
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@as-integrations/express5';
import { makeExecutableSchema } from '@graphql-tools/schema';
import cors from 'cors';
import express from 'express';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { startProcessManager } from './events/processManager.js';
import { startProjector } from './events/projector.js';
import { buildContext, type Context } from './graphql/context.js';
import { resolvers } from './graphql/resolvers.js';

const typeDefs = readFileSync(new URL('../schema.graphql', import.meta.url), 'utf8');
const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = createServer(app);

// ---- Subscriptions (WebSocket en /graphql) ----
const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });
const wsCleanup = useServer({ schema, context: () => buildContext() }, wsServer);

// ---- Queries & Mutations (HTTP en /graphql) ----
const apollo = new ApolloServer<Context>({
  schema,
  introspection: true,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    { async serverWillStart() { return { async drainServer() { await wsCleanup.dispose(); } }; } },
    {
      // Log de cada operación: nombre y tipo, para seguir el flujo en el video.
      async requestDidStart() {
        return {
          async didResolveOperation({ operationName, operation }) {
            if (operationName === 'IntrospectionQuery') return;
            console.log(`\n\x1b[1m▶ ${operation?.operation.toUpperCase()} ${operationName ?? '(anónima)'}\x1b[0m`);
          },
        };
      },
    },
  ],
});
await apollo.start();

app.use(
  '/graphql',
  cors<cors.CorsRequest>({ origin: [/^http:\/\/localhost:\d+$/], credentials: true }),
  express.json({ limit: '1mb' }),
  expressMiddleware(apollo, { context: async () => buildContext() }),
);

// Cualquier otra ruta no existe: no hay API REST.
app.use((_req, res) => {
  res.status(404).json({ error: 'Solo existe /graphql. Esta API no expone endpoints REST.' });
});

await pool.query('SELECT 1');
startProjector();
startProcessManager();

httpServer.listen(config.port, () => {
  console.log(`🚀 GraphQL (HTTP)  → http://localhost:${config.port}/graphql`);
  console.log(`🔌 GraphQL (WS)    → ws://localhost:${config.port}/graphql`);
  console.log(`⚙️  Proyector y process manager activos (delay proyección ${config.projectionDelayMs}ms, aprobación ${config.approvalDelayMs}ms)`);
});

import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { OperationTypeNode } from 'graphql';
import { createClient } from 'graphql-ws';

const HTTP_URL = process.env.NEXT_PUBLIC_GRAPHQL_HTTP ?? 'http://localhost:4000/graphql';
const WS_URL = process.env.NEXT_PUBLIC_GRAPHQL_WS ?? 'ws://localhost:4000/graphql';

/**
 * Único canal cliente-servidor: GraphQL en /graphql.
 *   • Queries y Mutations → HTTP
 *   • Subscriptions       → WebSocket (graphql-ws)
 */
export function makeApolloClient() {
  const httpLink = new HttpLink({ uri: HTTP_URL });

  const link =
    typeof window === 'undefined'
      ? httpLink
      : ApolloLink.split(
          (op) => op.operationType === OperationTypeNode.SUBSCRIPTION,
          new GraphQLWsLink(createClient({ url: WS_URL, retryAttempts: Infinity })),
          httpLink,
        );

  return new ApolloClient({
    link,
    cache: new InMemoryCache({
      // Necesario para resolver fragmentos sobre la interfaz UserError.
      possibleTypes: {
        UserError: [
          'ValidationError', 'NotFoundError', 'EmptyCartError', 'OutOfStockError',
          'PrescriptionRequiredError', 'InvalidStateTransitionError',
        ],
      },
      typePolicies: {
        Query: {
          fields: {
            // El carrito activo cambia de id tras el checkout: siempre reemplazar la referencia.
            cart: { merge: (_existing, incoming) => incoming },
            // Catálogo paginado: cada combinación de filtros/orden es una entrada distinta.
            medications: { keyArgs: ['filter', 'sort', 'page'] },
          },
        },
        Cart: {
          fields: { items: { merge: (_existing, incoming) => incoming } },
        },
        OrderSummary: {
          fields: {
            items: { merge: (_existing, incoming) => incoming },
            statusHistory: { merge: (_existing, incoming) => incoming },
          },
        },
      },
    }),
  });
}

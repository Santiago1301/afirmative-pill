'use client';

import { ApolloProvider } from '@apollo/client/react';
import { useState, type ReactNode } from 'react';
import { makeApolloClient } from '@/lib/apollo';

/**
 * Raíz del árbol de contexto de Apollo: todos los componentes debajo comparten
 * el mismo cliente, la misma caché normalizada y la misma conexión WebSocket.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeApolloClient);
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

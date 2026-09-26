import { PubSub } from 'graphql-subscriptions';
import type { OrderSummaryView } from '../read/orders.js';

/**
 * Bus en memoria para GraphQL Subscriptions. Suficiente para un monolito modular
 * de una sola instancia; con varias réplicas se cambiaría por Redis/Postgres LISTEN.
 */
export const pubsub = new PubSub<{ ORDER_UPDATED: OrderSummaryView }>();

export const ORDER_UPDATED = 'ORDER_UPDATED' as const;

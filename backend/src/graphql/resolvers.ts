/**
 * Resolvers GraphQL — adaptadores delgados entre el contrato y la aplicación:
 *   Query        → módulos de lectura  (src/read/*)
 *   Mutation     → command handlers    (src/write/commands/*)
 *   Subscription → pubsub alimentado por el proyector (src/events/*)
 * Las relaciones anidadas (category, manufacturer, medication, patient) SIEMPRE
 * pasan por DataLoader para evitar N+1.
 */
import { withFilter } from 'graphql-subscriptions';
import { config } from '../config.js';
import { ORDER_UPDATED, pubsub } from '../events/pubsub.js';
import type { CategoryView, ManufacturerView, MedicationView } from '../read/catalog.js';
import { listCategories, listManufacturers, searchMedications } from '../read/catalog.js';
import type { CartView, OrderLineView, OrderSummaryView } from '../read/orders.js';
import { getActiveCart, getOrderSummary, listOrderSummaries } from '../read/orders.js';
import * as cartCommands from '../write/commands/cart.js';
import * as orderCommands from '../write/commands/orders.js';
import type { UserError } from '../write/domain.js';
import type { Context } from './context.js';
import { DateScalar, DateTime, Money, PositiveInt } from './scalars.js';

type CartItemParent = { medicationId: number; quantity: number };

const EMPTY_CART = (patientId: string): CartView => ({ id: `empty-${patientId}`, items: [] });

async function cartMedications(cart: CartView, ctx: Context) {
  const meds = await ctx.loaders.medicationById.loadMany(cart.items.map((i) => i.medicationId));
  return meds.filter((m): m is MedicationView => !!m && !(m instanceof Error));
}

async function currentCart(ctx: Context) {
  return (await getActiveCart(ctx.patientId)) ?? EMPTY_CART(ctx.patientId);
}

export const resolvers = {
  DateTime,
  Date: DateScalar,
  Money,
  PositiveInt,

  // =================================================================== QUERIES
  Query: {
    medications: (_: unknown, args: { filter?: any; sort: any; page: any }) =>
      searchMedications(args.filter ?? {}, args.sort, args.page),
    medication: (_: unknown, { id }: { id: string }, ctx: Context) =>
      Number.isInteger(Number(id)) ? ctx.loaders.medicationById.load(Number(id)) : null,
    categories: () => listCategories(),
    manufacturers: () => listManufacturers(),
    me: (_: unknown, __: unknown, ctx: Context) => ctx.loaders.patientById.load(ctx.patientId),
    cart: (_: unknown, __: unknown, ctx: Context) => currentCart(ctx),
    order: (_: unknown, { id }: { id: string }, ctx: Context) =>
      /^[0-9a-f-]{36}$/i.test(id) ? getOrderSummary(id, ctx.patientId) : null,
    myOrders: (_: unknown, args: { status?: string; page: { limit: number; offset: number } }, ctx: Context) =>
      listOrderSummaries(ctx.patientId, args.status ?? null, args.page),
  },

  // =================================================================== MUTATIONS (comandos)
  Mutation: {
    addToCart: async (_: unknown, { input }: any, ctx: Context) => {
      const result = await cartCommands.addToCart(ctx.patientId, input);
      return { errors: result.errors, cart: await currentCart(ctx) };
    },
    updateCartItem: async (_: unknown, { input }: any, ctx: Context) => {
      const result = await cartCommands.updateCartItem(ctx.patientId, input);
      return { errors: result.errors, cart: await currentCart(ctx) };
    },
    removeFromCart: async (_: unknown, { input }: any, ctx: Context) => {
      const result = await cartCommands.removeFromCart(ctx.patientId, input);
      return { errors: result.errors, cart: await currentCart(ctx) };
    },
    placeOrder: async (_: unknown, { input }: any, ctx: Context) => {
      const result = await orderCommands.placeOrder(ctx.patientId, input ?? {});
      return {
        orderId: result.orderId ?? null,
        status: result.status ?? null,
        acceptedAt: result.acceptedAt ?? null,
        errors: result.errors,
        cart: await currentCart(ctx),
      };
    },
    cancelOrder: async (_: unknown, { input }: any, ctx: Context) => {
      const r = await orderCommands.cancelOrder(ctx.patientId, input);
      return { orderId: r.orderId ?? input.orderId, status: r.status ?? null, errors: r.errors };
    },
    dispatchOrder: async (_: unknown, { input }: any) => {
      const r = await orderCommands.dispatchOrder(input);
      return { orderId: r.orderId ?? input.orderId, status: r.status ?? null, errors: r.errors };
    },
  },

  // =================================================================== SUBSCRIPTIONS
  Subscription: {
    orderUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(ORDER_UPDATED),
        (payload?: OrderSummaryView, args?: { orderId: string }, ctx?: Context) =>
          payload?.id === args?.orderId && payload?.patientId === ctx?.patientId,
      ),
      resolve: (payload: OrderSummaryView) => payload,
    },
    myOrdersUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterableIterator(ORDER_UPDATED),
        (payload?: OrderSummaryView, _args?: unknown, ctx?: Context) => payload?.patientId === ctx?.patientId,
      ),
      resolve: (payload: OrderSummaryView) => payload,
    },
  },

  // =================================================================== TIPOS
  Medication: {
    stockLevel: (m: MedicationView) =>
      m.stock === 0 ? 'OUT_OF_STOCK' : m.stock <= config.lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK',
    category: (m: MedicationView, _: unknown, ctx: Context) => ctx.loaders.categoryById.load(m.categoryId),
    manufacturer: (m: MedicationView, _: unknown, ctx: Context) => ctx.loaders.manufacturerById.load(m.manufacturerId),
  },

  Category: {
    medications: async (c: CategoryView, { limit }: { limit: number }, ctx: Context) =>
      (await ctx.loaders.medicationsByCategory.load(c.id)).slice(0, limit),
    medicationCount: async (c: CategoryView, _: unknown, ctx: Context) =>
      (await ctx.loaders.medicationsByCategory.load(c.id)).length,
  },

  Manufacturer: {
    medications: async (m: ManufacturerView, { limit }: { limit: number }, ctx: Context) =>
      (await ctx.loaders.medicationsByManufacturer.load(m.id)).slice(0, limit),
  },

  Cart: {
    itemCount: (cart: CartView) => cart.items.reduce((n, i) => n + i.quantity, 0),
    subtotal: async (cart: CartView, _: unknown, ctx: Context) => {
      const meds = new Map((await cartMedications(cart, ctx)).map((m) => [m.id, m]));
      return cart.items.reduce((sum, i) => sum + (meds.get(i.medicationId)?.price ?? 0) * i.quantity, 0);
    },
    requiresPrescription: async (cart: CartView, _: unknown, ctx: Context) =>
      (await cartMedications(cart, ctx)).some((m) => m.requiresPrescription),
    prescriptionRequiredFor: async (cart: CartView, _: unknown, ctx: Context) =>
      (await cartMedications(cart, ctx)).filter((m) => m.requiresPrescription),
  },

  CartItem: {
    medication: (i: CartItemParent, _: unknown, ctx: Context) => ctx.loaders.medicationById.load(i.medicationId),
    lineTotal: async (i: CartItemParent, _: unknown, ctx: Context) =>
      ((await ctx.loaders.medicationById.load(i.medicationId))?.price ?? 0) * i.quantity,
  },

  OrderSummary: {
    isFinal: (o: OrderSummaryView) => o.status === 'DISPATCHED' || o.status === 'CANCELLED',
    patient: (o: OrderSummaryView, _: unknown, ctx: Context) => ctx.loaders.patientById.load(o.patientId),
  },

  OrderLine: {
    medication: (l: OrderLineView, _: unknown, ctx: Context) => ctx.loaders.medicationById.load(l.medicationId),
  },

  // ----- Errores de dominio -----
  UserError: {
    __resolveType: (e: UserError) => e.__typename,
  },
  OutOfStockError: {
    medication: (e: { medicationId: number }, _: unknown, ctx: Context) => ctx.loaders.medicationById.load(e.medicationId),
  },
  PrescriptionRequiredError: {
    medications: (e: { medicationIds: number[] }, _: unknown, ctx: Context) =>
      ctx.loaders.medicationById.loadMany(e.medicationIds),
  },
};

/**
 * Documentos GraphQL del cliente. Cada vista pide SOLO los campos que pinta
 * (el catálogo no descarga descripción, laboratorio ni categoría: eso es de la ficha).
 */
import { gql, type TypedDocumentNode } from '@apollo/client';

// ---------------------------------------------------------------- Tipos
export type OrderStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'DISPATCHED' | 'CANCELLED';
export type PrescriptionStatus = 'NOT_REQUIRED' | 'SUBMITTED' | 'VALIDATED' | 'REJECTED';
export type StockLevel = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface MedicationCard {
  __typename: 'Medication';
  id: string;
  name: string;
  presentation: string;
  price: number;
  requiresPrescription: boolean;
  stockLevel: StockLevel;
}

export interface UserError {
  __typename: string;
  code: string;
  message: string;
  field: string[] | null;
  medication?: { id: string; name: string };
  available?: number;
  medications?: { id: string; name: string }[];
}

export interface Cart {
  __typename: 'Cart';
  id: string;
  itemCount: number;
  subtotal: number;
  requiresPrescription: boolean;
  items: {
    quantity: number;
    lineTotal: number;
    medication: MedicationCard & { stock: number };
  }[];
}

export interface OrderSummary {
  __typename: 'OrderSummary';
  id: string;
  status: OrderStatus;
  prescriptionStatus: PrescriptionStatus;
  statusNote: string | null;
  totalAmount: number;
  itemCount: number;
  placedAt: string;
  updatedAt: string;
  isFinal: boolean;
  items: { quantity: number; unitPrice: number; subtotal: number; medication: { id: string; name: string; presentation: string } }[];
  statusHistory: { status: OrderStatus; at: string; note: string | null }[];
}

// ---------------------------------------------------------------- Fragments
const USER_ERROR_FIELDS = gql`
  fragment UserErrorFields on UserError {
    __typename
    code
    message
    field
    ... on OutOfStockError { available medication { id name } }
    ... on PrescriptionRequiredError { medications { id name } }
  }
`;

const CART_FIELDS = gql`
  fragment CartFields on Cart {
    id
    itemCount
    subtotal
    requiresPrescription
    items {
      quantity
      lineTotal
      medication { id name presentation price requiresPrescription stockLevel stock }
    }
  }
`;

const ORDER_SUMMARY_FIELDS = gql`
  fragment OrderSummaryFields on OrderSummary {
    id
    status
    prescriptionStatus
    statusNote
    totalAmount
    itemCount
    placedAt
    updatedAt
    isFinal
    items { quantity unitPrice subtotal medication { id name presentation } }
    statusHistory { status at note }
  }
`;

// ---------------------------------------------------------------- Queries (read model)
export const CATALOG_QUERY: TypedDocumentNode<
  { medications: { totalCount: number; hasMore: boolean; items: MedicationCard[] } },
  { filter?: Record<string, unknown>; page?: { limit: number; offset: number } }
> = gql`
  query Catalog($filter: MedicationFilter, $page: PageInput) {
    medications(filter: $filter, page: $page) {
      totalCount
      hasMore
      items { id name presentation price requiresPrescription stockLevel }
    }
  }
`;

export const CATEGORIES_QUERY: TypedDocumentNode<{ categories: { id: string; name: string; medicationCount: number }[] }> = gql`
  query Categories {
    categories { id name medicationCount }
  }
`;

export const MEDICATION_DETAIL_QUERY: TypedDocumentNode<
  {
    medication: null | (MedicationCard & {
      sku: string; activeIngredient: string; dosage: string; description: string; stock: number;
      category: { id: string; name: string };
      manufacturer: { id: string; name: string };
    });
  },
  { id: string }
> = gql`
  query MedicationDetail($id: ID!) {
    medication(id: $id) {
      id sku name activeIngredient dosage presentation price stock stockLevel
      requiresPrescription description
      category { id name }
      manufacturer { id name }
    }
  }
`;

export const CART_QUERY: TypedDocumentNode<{ cart: Cart }> = gql`
  query Cart {
    cart { ...CartFields }
  }
  ${CART_FIELDS}
`;

export const ORDER_QUERY: TypedDocumentNode<{ order: OrderSummary | null }, { id: string }> = gql`
  query Order($id: ID!) {
    order(id: $id) { ...OrderSummaryFields }
  }
  ${ORDER_SUMMARY_FIELDS}
`;

export const MY_ORDERS_QUERY: TypedDocumentNode<{ myOrders: OrderSummary[] }> = gql`
  query MyOrders {
    myOrders { ...OrderSummaryFields }
  }
  ${ORDER_SUMMARY_FIELDS}
`;

// ---------------------------------------------------------------- Mutations (comandos)
type CartPayload = { cart: Cart | null; errors: UserError[] };

export const ADD_TO_CART: TypedDocumentNode<{ addToCart: CartPayload }, { medicationId: string; quantity: number }> = gql`
  mutation AddToCart($medicationId: ID!, $quantity: PositiveInt!) {
    addToCart(input: { medicationId: $medicationId, quantity: $quantity }) {
      cart { ...CartFields }
      errors { ...UserErrorFields }
    }
  }
  ${CART_FIELDS}
  ${USER_ERROR_FIELDS}
`;

export const UPDATE_CART_ITEM: TypedDocumentNode<{ updateCartItem: CartPayload }, { medicationId: string; quantity: number }> = gql`
  mutation UpdateCartItem($medicationId: ID!, $quantity: PositiveInt!) {
    updateCartItem(input: { medicationId: $medicationId, quantity: $quantity }) {
      cart { ...CartFields }
      errors { ...UserErrorFields }
    }
  }
  ${CART_FIELDS}
  ${USER_ERROR_FIELDS}
`;

export const REMOVE_FROM_CART: TypedDocumentNode<{ removeFromCart: CartPayload }, { medicationId: string }> = gql`
  mutation RemoveFromCart($medicationId: ID!) {
    removeFromCart(input: { medicationId: $medicationId }) {
      cart { ...CartFields }
      errors { ...UserErrorFields }
    }
  }
  ${CART_FIELDS}
  ${USER_ERROR_FIELDS}
`;

export interface PrescriptionInput {
  doctorName: string;
  doctorLicense: string;
  issuedAt: string;
  diagnosis?: string;
}

export const PLACE_ORDER: TypedDocumentNode<
  { placeOrder: { orderId: string | null; status: OrderStatus | null; acceptedAt: string | null; cart: Cart | null; errors: UserError[] } },
  { prescription?: PrescriptionInput | null }
> = gql`
  mutation PlaceOrder($prescription: PrescriptionInput) {
    placeOrder(input: { prescription: $prescription }) {
      orderId
      status
      acceptedAt
      cart { ...CartFields }
      errors { ...UserErrorFields }
    }
  }
  ${CART_FIELDS}
  ${USER_ERROR_FIELDS}
`;

type OrderCommandPayload = { orderId: string | null; status: OrderStatus | null; errors: UserError[] };

export const CANCEL_ORDER: TypedDocumentNode<{ cancelOrder: OrderCommandPayload }, { orderId: string; reason?: string }> = gql`
  mutation CancelOrder($orderId: ID!, $reason: String) {
    cancelOrder(input: { orderId: $orderId, reason: $reason }) {
      orderId
      status
      errors { ...UserErrorFields }
    }
  }
  ${USER_ERROR_FIELDS}
`;

export const DISPATCH_ORDER: TypedDocumentNode<{ dispatchOrder: OrderCommandPayload }, { orderId: string }> = gql`
  mutation DispatchOrder($orderId: ID!) {
    dispatchOrder(input: { orderId: $orderId }) {
      orderId
      status
      errors { ...UserErrorFields }
    }
  }
  ${USER_ERROR_FIELDS}
`;

// ---------------------------------------------------------------- Subscriptions
export const ORDER_UPDATED: TypedDocumentNode<{ orderUpdated: OrderSummary }, { orderId: string }> = gql`
  subscription OrderUpdated($orderId: ID!) {
    orderUpdated(orderId: $orderId) { ...OrderSummaryFields }
  }
  ${ORDER_SUMMARY_FIELDS}
`;

export const MY_ORDERS_UPDATED: TypedDocumentNode<{ myOrdersUpdated: OrderSummary }> = gql`
  subscription MyOrdersUpdated {
    myOrdersUpdated { ...OrderSummaryFields }
  }
  ${ORDER_SUMMARY_FIELDS}
`;

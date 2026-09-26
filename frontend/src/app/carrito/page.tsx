'use client';

import { useMutation, useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ErrorBox, Loading, RxBadge, UserErrors } from '@/components/ui';
import {
  CART_QUERY, PLACE_ORDER, REMOVE_FROM_CART, UPDATE_CART_ITEM,
  type Cart, type PrescriptionInput, type UserError,
} from '@/graphql/operations';
import { money } from '@/lib/format';

const today = () => new Date().toISOString().slice(0, 10);

/** Escenario B — armar el pedido y ejecutar el comando placeOrder. */
export default function CartPage() {
  const router = useRouter();
  const { data, loading, error } = useQuery(CART_QUERY);
  const [errors, setErrors] = useState<UserError[]>([]);
  const [prescription, setPrescription] = useState<PrescriptionInput>({
    doctorName: '', doctorLicense: '', issuedAt: today(), diagnosis: '',
  });

  // Las tres mutaciones del carrito devuelven el Cart normalizado (mismo id):
  // Apollo actualiza la caché automáticamente, sin update ni refetch.
  const [updateItem, updateState] = useMutation(UPDATE_CART_ITEM);
  const [removeItem, removeState] = useMutation(REMOVE_FROM_CART);

  const [placeOrder, placeState] = useMutation(PLACE_ORDER, {
    update(cache, { data }) {
      const payload = data?.placeOrder;
      if (!payload?.orderId || !payload.cart) return;
      // 1) El carrito se vació en el servidor: apuntamos Query.cart al carrito nuevo.
      cache.writeQuery({ query: CART_QUERY, data: { cart: payload.cart } });
      // 2) El stock del catálogo y la lista de órdenes quedaron obsoletos:
      //    se invalidan para que se vuelvan a pedir al visitarlos.
      cache.evict({ fieldName: 'medications' });
      cache.evict({ fieldName: 'myOrders' });
      cache.gc();
    },
  });

  if (loading) return <Loading label="Cargando carrito…" />;
  if (error) return <ErrorBox error={error} />;
  const cart = data!.cart as Cart;
  const busy = updateState.loading || removeState.loading || placeState.loading;

  async function changeQty(medicationId: string, quantity: number) {
    setErrors([]);
    if (quantity < 1) {
      const { data } = await removeItem({ variables: { medicationId } });
      setErrors(data?.removeFromCart.errors ?? []);
    } else {
      const { data } = await updateItem({ variables: { medicationId, quantity } });
      setErrors(data?.updateCartItem.errors ?? []);
    }
  }

  async function onCheckout(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    const { data } = await placeOrder({
      variables: {
        prescription: cart.requiresPrescription
          ? { ...prescription, diagnosis: prescription.diagnosis || undefined }
          : null,
      },
    });
    const payload = data?.placeOrder;
    if (payload?.orderId) router.push(`/ordenes/${payload.orderId}?nueva=1`);
    else setErrors(payload?.errors ?? []);
  }

  if (cart.items.length === 0) {
    return (
      <section className="empty">
        <h1>Tu carrito está vacío</h1>
        <Link href="/" className="btn primary">Ir al catálogo</Link>
      </section>
    );
  }

  return (
    <div className="two-cols">
      <section>
        <h1>Carrito</h1>
        <table className="table">
          <thead>
            <tr><th>Medicamento</th><th>Precio</th><th>Cantidad</th><th>Total</th><th /></tr>
          </thead>
          <tbody>
            {cart.items.map(({ medication: m, quantity, lineTotal }) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/medicamentos/${m.id}`}>{m.name}</Link> {m.requiresPrescription && <RxBadge />}
                  <div className="muted small">{m.presentation} · {m.stock} en bodega</div>
                </td>
                <td>{money(m.price)}</td>
                <td>
                  <div className="qty">
                    <button className="btn ghost sm" disabled={busy} onClick={() => changeQty(m.id, quantity - 1)}>−</button>
                    <span>{quantity}</span>
                    <button className="btn ghost sm" disabled={busy} onClick={() => changeQty(m.id, quantity + 1)}>+</button>
                  </div>
                </td>
                <td>{money(lineTotal)}</td>
                <td><button className="btn ghost sm" disabled={busy} onClick={() => changeQty(m.id, 0)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="panel">
        <h2>Resumen</h2>
        <p className="row"><span>{cart.itemCount} unidad(es)</span><strong>{money(cart.subtotal)}</strong></p>

        <form onSubmit={onCheckout} className="form">
          {cart.requiresPrescription && (
            <fieldset>
              <legend>Fórmula médica (obligatoria)</legend>
              <p className="muted small">Tu carrito contiene medicamentos con fórmula. Un químico farmacéutico la revisará.</p>
              <label>Médico prescriptor
                <input className="input" required value={prescription.doctorName}
                  onChange={(e) => setPrescription({ ...prescription, doctorName: e.target.value })} />
              </label>
              <label>Registro médico (RM-12345)
                <input className="input" required placeholder="RM-12345" value={prescription.doctorLicense}
                  onChange={(e) => setPrescription({ ...prescription, doctorLicense: e.target.value })} />
              </label>
              <label>Fecha de emisión
                <input className="input" type="date" required max={today()} value={prescription.issuedAt}
                  onChange={(e) => setPrescription({ ...prescription, issuedAt: e.target.value })} />
              </label>
              <label>Diagnóstico (opcional)
                <input className="input" value={prescription.diagnosis}
                  onChange={(e) => setPrescription({ ...prescription, diagnosis: e.target.value })} />
              </label>
            </fieldset>
          )}
          <UserErrors errors={errors} />
          <button className="btn primary block" disabled={busy}>
            {placeState.loading ? 'Enviando comando…' : 'Confirmar orden'}
          </button>
        </form>
      </aside>
    </div>
  );
}

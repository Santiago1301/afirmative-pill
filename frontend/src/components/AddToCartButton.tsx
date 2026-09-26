'use client';

import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { ADD_TO_CART, CART_QUERY } from '@/graphql/operations';

export function AddToCartButton({ medicationId, disabled }: { medicationId: string; disabled?: boolean }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [addToCart, { loading }] = useMutation(ADD_TO_CART, {
    // Actualización de caché: el payload trae el Cart completo; lo dejamos como
    // Query.cart para que el Header y la página del carrito se re-rendericen sin refetch.
    update(cache, { data }) {
      const cart = data?.addToCart.cart;
      if (cart && data?.addToCart.errors.length === 0) cache.writeQuery({ query: CART_QUERY, data: { cart } });
    },
  });

  async function onClick() {
    setMessage(null);
    const { data } = await addToCart({ variables: { medicationId, quantity: 1 } });
    const errors = data?.addToCart.errors ?? [];
    setMessage(errors.length ? { ok: false, text: errors[0].message } : { ok: true, text: 'Agregado ✓' });
    setTimeout(() => setMessage(null), 2500);
  }

  return (
    <div className="add-to-cart">
      <button className="btn primary" onClick={onClick} disabled={disabled || loading}>
        {loading ? 'Agregando…' : disabled ? 'Agotado' : 'Agregar al carrito'}
      </button>
      {message && <small className={message.ok ? 'ok' : 'err'}>{message.text}</small>}
    </div>
  );
}

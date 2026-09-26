'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { CART_QUERY } from '@/graphql/operations';

export function Header() {
  // Mismo documento que usa la página del carrito: Apollo lo sirve desde caché
  // y se actualiza solo cuando cualquier mutación devuelve el Cart normalizado.
  const { data } = useQuery(CART_QUERY);
  const count = data?.cart.itemCount ?? 0;

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">✚</span> Afirmative Pill
        </Link>
        <nav className="nav">
          <Link href="/">Catálogo</Link>
          <Link href="/ordenes">Mis órdenes</Link>
          <Link href="/carrito" className="cart-link">
            Carrito <span className="pill">{count}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

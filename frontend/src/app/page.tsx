'use client';

import { useQuery } from '@apollo/client/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AddToCartButton } from '@/components/AddToCartButton';
import { ErrorBox, Loading, RxBadge } from '@/components/ui';
import { CATALOG_QUERY, CATEGORIES_QUERY } from '@/graphql/operations';
import { money, STOCK_LABEL } from '@/lib/format';

const PAGE_SIZE = 12;

/** Escenario A — exploración del catálogo con vista condensada. */
export default function CatalogPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [rx, setRx] = useState<'all' | 'otc' | 'rx'>('all');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [page, setPage] = useState(0);

  // Debounce de la búsqueda para no disparar una query por tecla.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filter = {
    search: search || undefined,
    categoryId: categoryId || undefined,
    requiresPrescription: rx === 'all' ? undefined : rx === 'rx',
    inStockOnly,
  };

  const categories = useQuery(CATEGORIES_QUERY);
  const { data, loading, error, previousData } = useQuery(CATALOG_QUERY, {
    variables: { filter, page: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
  });
  const result = (data ?? previousData)?.medications;

  return (
    <>
      <section className="hero">
        <h1>Catálogo de medicamentos</h1>
        <p className="muted">Busca por nombre comercial, principio activo, categoría o laboratorio.</p>
      </section>

      <section className="filters">
        <input
          className="input grow"
          placeholder="Ej: ibuprofeno, losartán, antibióticos…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select className="input" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0); }}>
          <option value="">Todas las categorías</option>
          {categories.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.medicationCount})</option>
          ))}
        </select>
        <select className="input" value={rx} onChange={(e) => { setRx(e.target.value as typeof rx); setPage(0); }}>
          <option value="all">Venta libre y con fórmula</option>
          <option value="otc">Solo venta libre</option>
          <option value="rx">Solo con fórmula</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => { setInStockOnly(e.target.checked); setPage(0); }} />
          Solo disponibles
        </label>
      </section>

      {error && <ErrorBox error={error} />}
      {loading && !result && <Loading label="Cargando catálogo…" />}

      {result && (
        <>
          <p className="muted small">
            {result.totalCount} resultado(s) {loading && <span className="spinner" />}
          </p>
          <div className="grid">
            {result.items.map((m) => (
              <article key={m.id} className="card">
                <div className="card-top">
                  <Link href={`/medicamentos/${m.id}`} className="card-title">{m.name}</Link>
                  {m.requiresPrescription && <RxBadge />}
                </div>
                <p className="muted small">{m.presentation}</p>
                <div className="card-bottom">
                  <span className="price">{money(m.price)}</span>
                  <span className={`stock stock-${m.stockLevel.toLowerCase()}`}>{STOCK_LABEL[m.stockLevel]}</span>
                </div>
                <div className="card-actions">
                  <Link href={`/medicamentos/${m.id}`} className="btn ghost">Ver ficha</Link>
                  <AddToCartButton medicationId={m.id} disabled={m.stockLevel === 'OUT_OF_STOCK'} />
                </div>
              </article>
            ))}
          </div>
          {result.items.length === 0 && <p className="muted">No hay medicamentos con esos filtros.</p>}
          <div className="pager">
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Anterior</button>
            <span className="muted small">Página {page + 1}</span>
            <button className="btn ghost" disabled={!result.hasMore} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
          </div>
        </>
      )}
    </>
  );
}

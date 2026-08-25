'use client';

import { useState } from 'react';
import { reportSale } from '@/lib/offline/collection';
import { CONDITIONS, type Condition } from '@/lib/types';

const PLATFORMS = ['wallapop', 'ebay', 'mano a mano', 'otro'] as const;

/** La fuente de precio más honesta que puede tener la app: ventas reales. */
export function ReportSaleForm({ cardId, onDone }: { cardId: string; onDone: () => void }) {
  const [price, setPrice] = useState('');
  const [platform, setPlatform] = useState<string>('wallapop');
  const [condition, setCondition] = useState<Condition>('nm');
  const [soldAt, setSoldAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(price.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return;
    setSaving(true);
    await reportSale({ card_id: cardId, price: value, platform, condition, sold_at: soldAt });
    setSaving(false);
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slot-edge bg-sheet p-4">
      <p className="text-sm text-muted">
        ¿Por cuánto se vendió? Solo ventas que hayas hecho o visto cerrarse.
      </p>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted">Precio (€)</span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            className="w-full rounded-lg border border-slot-edge bg-leather px-3 py-2 tnum outline-none focus:border-gold"
          />
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted">Fecha</span>
          <input
            type="date"
            value={soldAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setSoldAt(e.target.value)}
            className="w-full rounded-lg border border-slot-edge bg-leather px-3 py-2 tnum outline-none focus:border-gold"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted">Dónde</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full rounded-lg border border-slot-edge bg-leather px-3 py-2 outline-none focus:border-gold"
          >
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted">Estado</span>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as Condition)}
            className="w-full rounded-lg border border-slot-edge bg-leather px-3 py-2 outline-none focus:border-gold"
          >
            {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Reportar venta'}
        </button>
        <button type="button" onClick={onDone} className="rounded-full border border-slot-edge px-4 py-2 text-sm">
          Cancelar
        </button>
      </div>
    </form>
  );
}

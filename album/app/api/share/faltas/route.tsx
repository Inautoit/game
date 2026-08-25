import { ImageResponse } from 'next/og';
import type { SharePayload } from '@/lib/share/faltas';

export const runtime = 'nodejs';

const MAX_NUMBERS = 240;

/**
 * Imagen para compartir las faltas. Se genera bajo demanda con los datos que
 * manda el cliente: el servidor no necesita saber qué colección tiene nadie.
 */
export async function POST(request: Request) {
  let payload: SharePayload;
  try {
    payload = (await request.json()) as SharePayload;
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }

  if (!payload?.groups?.length) {
    return new Response('Sin faltas que compartir', { status: 400 });
  }

  let budget = MAX_NUMBERS;
  const groups = payload.groups.map((g) => {
    const shown = g.numbers.slice(0, Math.max(0, budget));
    budget -= shown.length;
    return { ...g, shown, hidden: g.numbers.length - shown.length };
  }).filter((g) => g.shown.length);

  const missing = payload.total - payload.owned;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(160deg, #12261f 0%, #0b1a15 60%, #07120e 100%)',
          color: '#ecf1ee', padding: 56, fontSize: 28,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 46, fontWeight: 700 }}>Me faltan {missing}</span>
          <span style={{ fontSize: 26, color: '#8aa79c' }}>
            {payload.owned} / {payload.total}
          </span>
        </div>
        <span style={{ fontSize: 24, color: '#8aa79c', marginTop: 6 }}>
          {payload.title} · {payload.season}
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28, gap: 18 }}>
          {groups.map((group) => (
            <div key={group.series} style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 22, color: group.requestable ? '#c9a227' : '#8aa79c' }}>
                {group.series}{group.requestable ? '' : ' · no pedibles'}
              </span>
              <span style={{ fontSize: 26, lineHeight: 1.45, marginTop: 4 }}>
                {group.shown.join('  ')}
                {group.hidden > 0 ? `  +${group.hidden} más` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );
}

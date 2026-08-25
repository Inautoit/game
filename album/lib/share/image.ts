'use client';

import { collectionLabel, type SharePayload } from './faltas';

const W = 1080;
const H = 1350;
const PAD = 72;

/**
 * La imagen de faltas se dibuja en el navegador con canvas. Antes la generaba
 * una función de servidor; en un sitio estático no hay servidor, y tampoco hace
 * falta: los datos ya están aquí y así funciona hasta sin conexión.
 */
export async function renderFaltasImage(payload: SharePayload): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite dibujar la imagen');

  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#12261f');
  bg.addColorStop(0.6, '#0b1a15');
  bg.addColorStop(1, '#07120e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const sans = (size: number, weight = 400) =>
    `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  const missing = payload.total - payload.owned;

  ctx.fillStyle = '#ecf1ee';
  ctx.font = sans(84, 700);
  ctx.fillText(`Me faltan ${missing}`, PAD, PAD + 84);

  ctx.fillStyle = '#8aa79c';
  ctx.font = sans(34);
  ctx.fillText(
    `${payload.owned} / ${payload.total} · ${collectionLabel(payload.title, payload.season)}`,
    PAD, PAD + 140,
  );

  // Barra de progreso: se entiende de un vistazo en un grupo de WhatsApp.
  const barY = PAD + 176;
  const barW = W - PAD * 2;
  ctx.fillStyle = '#16302a';
  ctx.fillRect(PAD, barY, barW, 12);
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(PAD, barY, barW * (payload.total ? payload.owned / payload.total : 0), 12);

  let y = barY + 84;
  const lineHeight = 44;

  for (const group of payload.groups) {
    if (y > H - PAD - 90) {
      ctx.fillStyle = '#8aa79c';
      ctx.font = sans(30);
      ctx.fillText('…y más. Pide la lista completa.', PAD, y);
      break;
    }

    ctx.fillStyle = group.requestable ? '#c9a227' : '#8aa79c';
    ctx.font = sans(30, 600);
    ctx.fillText(`${group.series}${group.requestable ? '' : ' · no pedibles'}`, PAD, y);
    y += 42;

    ctx.fillStyle = '#ecf1ee';
    ctx.font = sans(34);
    let line = '';
    for (const number of group.numbers) {
      const next = line ? `${line}   ${number}` : number;
      if (ctx.measureText(next).width > W - PAD * 2) {
        ctx.fillText(line, PAD, y);
        y += lineHeight;
        line = number;
        if (y > H - PAD - 60) break;
      } else {
        line = next;
      }
    }
    if (line && y <= H - PAD - 40) {
      ctx.fillText(line, PAD, y);
      y += lineHeight;
    }
    y += 26;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la imagen');
  return blob;
}

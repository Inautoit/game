'use client';

import { useEffect, useState } from 'react';

export interface FlashMessage {
  id: number;
  text: string;
  tone: 'new' | 'dupe' | 'info';
}

const TONE = {
  new: 'border-gold/60 bg-gold text-ink',
  dupe: 'border-slot-edge bg-sheet text-cream',
  info: 'border-slot-edge bg-sheet text-cream',
} as const;

export function Flash({ message }: { message: FlashMessage | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(t);
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center
        transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className={`rounded-full border px-4 py-2 text-sm font-medium shadow-lg ${TONE[message.tone]}`}>
        {message.text}
      </span>
    </div>
  );
}

let counter = 0;
export const nextFlashId = () => ++counter;

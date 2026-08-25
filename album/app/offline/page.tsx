import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sin conexión' };

/** Última red de seguridad: solo se ve si el service worker no tiene la página cacheada. */
export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-24 text-center">
      <p className="font-display text-2xl">Sin conexión</p>
      <p className="mt-2 text-sm text-muted">
        Esta pantalla todavía no estaba guardada en el dispositivo. Tu álbum y todo
        lo que hayas marcado siguen intactos: vuelve a la portada.
      </p>
      <a
        href="/"
        className="mt-5 inline-block rounded-full border border-slot-edge px-4 py-2 text-sm"
      >
        Volver al álbum
      </a>
    </div>
  );
}

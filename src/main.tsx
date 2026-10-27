import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Poppins va incluida en la app (no desde Google Fonts) para que se vea igual sin internet.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import { App } from './App';
import './estilos.css';

// Versión nueva publicada: se busca cada media hora; el service worker nuevo
// toma el control solo y la página se recarga cuando la caja lleva 2 minutos sin
// que nadie la toque (o al pasar a otra ventana), así una PC que queda abierta
// todo el día no se queda con la versión vieja ni se recarga en medio de un cobro.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let ultimoToque = Date.now();
  for (const evento of ['pointerdown', 'keydown'] as const) addEventListener(evento, () => (ultimoToque = Date.now()), { passive: true });
  let hayVersionNueva = false;
  const habiaControl = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaControl) hayVersionNueva = true;
  });
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registro) => setInterval(() => registro.update().catch(() => {}), 30 * 60_000))
    .catch(() => {});
  const recargarSiEstaQuieta = () => {
    if (hayVersionNueva && (document.visibilityState === 'hidden' || Date.now() - ultimoToque > 2 * 60_000)) location.reload();
  };
  setInterval(recargarSiEstaQuieta, 15_000);
  document.addEventListener('visibilitychange', recargarSiEstaQuieta);
}

// Pide al navegador que no borre los datos del kiosco para liberar espacio.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

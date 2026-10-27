import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Poppins va incluida en la app (no desde Google Fonts) para que se vea igual sin internet.
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import { App } from './App';
import './estilos.css';

// Pide al navegador que no borre los datos del kiosco para liberar espacio.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

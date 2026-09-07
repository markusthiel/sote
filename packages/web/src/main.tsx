import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

/**
 * Hell oder dunkel: `data-theme` hat **einen** Schreiber.
 *
 * In SONE lag der Fehler mehrfach darin, dass ein Wert dort gesetzt wurde, wo
 * das System gefragt wird, und dort vergessen, wo die Person steht (ADR-0124,
 * ADR-0135). Also steht das Attribut immer, auch beim Systemwert.
 */
const root = document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');
const apply = () => {
  root.dataset['theme'] = media.matches ? 'dark' : 'light';
};
apply();
media.addEventListener('change', apply);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

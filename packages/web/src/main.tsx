import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { startAppearance } from './appearance.js';
import './styles.css';

/*
 * Das Thema, bevor irgendetwas gezeichnet wird.
 *
 * Aus der gemerkten Antwort und nicht aus der Sitzung: die ist noch nicht da.
 * Wer dunkel liest, darf keine halbe Sekunde lang eine weiße Seite sehen —
 * „an interface that changes colour a second after it appears is worse than one
 * that was the wrong colour to begin with" (SONE, ADR-0124).
 *
 * `data-theme` hat dabei EINEN Schreiber (`appearance.ts`), auch beim
 * Systemwert. In SONE lag der Fehler mehrfach darin, dass ein Wert dort gesetzt
 * wurde, wo das System gefragt wird, und dort vergessen, wo die Person steht.
 */
startAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

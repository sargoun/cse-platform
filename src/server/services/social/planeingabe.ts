/**
 * `planEingabe` steht jetzt in `services/zeit/formulareingabe.ts`.
 *
 * Sie war nie an Social gebunden — sie rechnet einen `datetime-local`-Wert in
 * einen Instant um, und das braucht der Gesprächstermin (REC-06) genauso wie
 * die Beitragsplanung (SOC-03). Hier wird weiter re-exportiert, damit die
 * Route und ihr Test ihren Import behalten.
 */
export { planEingabe, type EingabeFehler } from '../zeit/formulareingabe.js';

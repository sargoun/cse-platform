/**
 * Der Reinigungsbereich — die eine Stelle, an der seine Dienste
 * zusammenlaufen (CLN-01…CLN-05, OPS-11).
 *
 * Sie re-exportiert, sie entscheidet nichts. Jede Regel steht in dem Modul,
 * dem sie gehört: die Sollzeit in `sollzeit.ts`, der Abzug in
 * `schnappschuss.ts`, der Weg durch die Datenbank in `revier.ts`,
 * `leistungsnachweis.ts`, `reklamation.ts` und `qualitaet.ts`. Ein Index, der
 * selbst rechnet, ist die Stelle, an der eine zweite Wahrheit entsteht.
 */
export * from './sollzeit.js';
export * from './schnappschuss.js';
export * from './revier.js';
export * from './leistungsnachweis.js';
export * from './reklamation.js';
export * from './qualitaet.js';

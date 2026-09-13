/**
 * Die Sicherheitskoepfe (SEC-A7) — an EINER Stelle, ohne jede Abhaengigkeit.
 *
 * `next.config.ts` liest sie und haengt sie an jede Antwort; ein Test liest
 * sie ebenfalls, ohne die Konfiguration zu laden. Diese Datei importiert
 * nichts, aus demselben Grund wie `weiterleitungen.ts`: die Konfiguration
 * wird von Next vor dem Bau geladen und darf keinen Datenbanktreiber ziehen.
 *
 * **Was drinsteht — und was bewusst nicht.**
 *
 * - `Strict-Transport-Security`: ein Jahr, mit Unterdomaenen. Wirkt nur ueber
 *   TLS und ist unter `http://localhost` folgenlos — der Browser ignoriert den
 *   Kopf auf unverschluesselten Antworten. `ursprung.ts` verweist auf genau
 *   diesen Kopf als zweite Linie hinter dem Ursprungstor.
 * - `X-Content-Type-Options: nosniff`: eine hochgeladene Datei, die als
 *   `text/plain` ausgeliefert wird, bleibt Text — der Browser raet nicht.
 * - `X-Frame-Options: DENY` und `frame-ancestors 'none'`: keine Seite dieser
 *   Anwendung laesst sich in eine fremde einbetten. Das schliesst Clickjacking
 *   auf dem Freigabeknopf aus — die Stelle, an der es Geld kostet.
 * - `Referrer-Policy: strict-origin-when-cross-origin`: ein Verweis nach
 *   aussen traegt den Host, nie den Pfad. Portalpfade enthalten Kennungen.
 * - `Permissions-Policy`: Kamera nur fuer die eigene Herkunft (Stempelflaeche,
 *   Foto zur Schicht), Standort ebenfalls — er wird heute NICHT erhoben (O-06),
 *   aber eine Richtlinie, die ihn spaeter von Dritten verlangt, gibt es nicht.
 *   Mikrofon, Zahlung und Sensoren: niemand.
 *
 * **Keine vollstaendige `Content-Security-Policy` — und das ist eine
 * Entscheidung, keine Auslassung (O-359).** Der App-Router von Next liefert
 * Hydrationsdaten als Inline-Skript; eine CSP ohne `'unsafe-inline'` braucht
 * je Anfrage eine Nonce aus der Middleware und in jedem Skript. Eine CSP mit
 * `'unsafe-inline'` verhindert dagegen fast nichts, sieht aber fertig aus.
 * Bis die Nonce-Kette gebaut ist, steht hier nur die eine Direktive, die ohne
 * sie vollstaendig wirkt: `frame-ancestors`.
 */
export const SICHERHEITSKOEPFE: readonly { readonly key: string; readonly value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), '
      + 'accelerometer=(), gyroscope=(), magnetometer=()',
  },
];

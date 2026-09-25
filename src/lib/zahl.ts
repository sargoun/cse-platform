/**
 * Zahlen und Grössen für die Anzeige — EINE Stelle (V-227, V-233, D-721, D-727).
 *
 * **Der Befund** (Audit Befund 69): Grössen und Zahlen wurden an einem
 * Dutzend Stellen von Hand gebaut. `toFixed(1)` schrieb „2.5 MB" mit Punkt,
 * einige Seiten ersetzten den Punkt nachträglich, andere nicht, und eine
 * Zahl über tausend stand mal mit, mal ohne Tausenderpunkt. Jede dieser
 * Stellen war richtig, bis jemand sie kopierte.
 *
 * **Deutsch ist die Vorgabe, Englisch die Ausnahme auf Wunsch.** Die
 * internen Bildschirme sprechen Deutsch oder Englisch (`InternSprache`);
 * `en` schreibt britisch („1,234.5"), alles andere deutsch („1.234,5"). Das
 * Arbeiterportal ruft ohne Sprache auf: dort bleibt die Zahl in jeder
 * Sprache in der gesetzlichen Form (SEITENKARTE §12).
 *
 * **Geld steht NICHT hier.** Beträge sind ganzzahlige Cent und gehen durch
 * `formatiereGeld` (`server/services/finanz/geld.ts`, Invariante 1) — eine
 * Zahlenfunktion, die auch Geld formatieren könnte, wäre die Einladung, einen
 * Betrag als Gleitkommazahl hineinzugeben.
 */

const FORMAT: Readonly<Record<'de' | 'en', string>> = { de: 'de-DE', en: 'en-GB' };

function gebiet(sprache: string | null | undefined): string {
  return sprache === 'en' ? FORMAT.en : FORMAT.de;
}

/**
 * Eine Zahl mit Tausendertrennung und höchstens `nachkomma` Stellen —
 * `1234` → „1.234", `2.5` → „2,5".
 */
export function zahlText(
  n: number, sprache: string | null = 'de', nachkomma = 0,
): string {
  return new Intl.NumberFormat(gebiet(sprache), {
    minimumFractionDigits: nachkomma,
    maximumFractionDigits: nachkomma,
  }).format(n);
}

/**
 * Eine Dateigrösse in B, KB oder MB — `2621440` → „2,5 MB".
 *
 * **Binär (1024), wie der Rest der internen Oberfläche** und wie die
 * Obergrenze in 0009 (256 MB = 268 435 456 Byte). Das Kundenportal schreibt
 * dezimal mit „kB" und hat dafür einen eigenen, begründeten Weg
 * (`kundenportal/dokument.ts` `dateigroesse`): der Kunde vergleicht mit dem,
 * was sein Rechner beim Herunterladen sagt.
 *
 * **Eine Nachkommastelle unter zehn, keine darüber** — „1,5 KB", „10 KB",
 * „256 MB". **Nimmt Text** (so liefert die Datenbank `bigint`) und rechnet in
 * `BigInt`, bis die Zahl klein genug ist; eine leere, unlesbare oder nicht
 * positive Angabe ist „—" und nicht „0 B": eine Datei ohne Grösse ist eine
 * Aussage, die niemand geprüft hat.
 */
export function dateigroesse(
  bytes: string | number | bigint | null | undefined, sprache: string | null = 'de',
): string {
  if (bytes === null || bytes === undefined) return '—';
  let wert: bigint;
  try {
    if (typeof bytes === 'string') {
      if (bytes.trim() === '') return '—';
      wert = BigInt(bytes.trim());
    } else if (typeof bytes === 'number') {
      if (!Number.isFinite(bytes) || !Number.isInteger(bytes)) return '—';
      wert = BigInt(bytes);
    } else {
      wert = bytes;
    }
  } catch {
    return '—';
  }
  if (wert <= 0n) return '—';
  /* Unter 1024 gibt es nichts zu trennen und nichts zu runden. */
  if (wert < 1024n) return `${wert.toString()} B`;
  const kb = Number(wert) / 1024;
  if (kb < 1024) return `${zahlText(kb, sprache, kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${zahlText(mb, sprache, mb < 10 ? 1 : 0)} MB`;
}

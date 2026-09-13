/**
 * Eine Telefonnummer auf E.164 bringen.
 *
 * **Warum das hier liegt und nicht bei der Anmeldung.** Die Funktion ist rein
 * — keine Datenbank, kein Geheimnis, keine Umgebung — und sie hat zwei
 * Aufrufer, die nichts miteinander zu tun haben: den Anmeldedienst unter
 * `server/auth/` und den Seed, der die Demozugaenge anlegt. Der Anmeldedienst
 * traegt `import 'server-only'`, und dieses Paket WIRFT ausserhalb einer
 * Server-Umgebung. Der Seed laeuft unter `tsx` als gewoehnliches Node-Skript
 * und waere daran gestorben — die naheliegende Antwort darauf waere gewesen,
 * die Normalisierung im Seed als SQL nachzubauen, und dann gaebe es zwei
 * Fassungen derselben Regel, von denen genau eine gepflegt wird.
 *
 * **Warum das nicht der Eingabe ueberlassen wird.** `0170 1234567`,
 * `+49 170 1234567`, `0049-170-1234567` und `(0170) 1234567` sind dieselbe
 * Nummer. Ohne Normalisierung legt jede Schreibweise einen eigenen Zugang an,
 * und die Spalte `telefon_e164 unique` haelt genau nichts mehr zusammen.
 *
 * **Die Laenderkennung ist ein Parameter, kein Literal.** Die Vorwahl `49`
 * steht hier als Vorgabe, weil die Gruppe in Berlin arbeitet und ihre
 * Beschaeftigten deutsche Nummern haben; wer eine auslaendische Nummer
 * eintraegt, schreibt sie mit `+` und wird durchgereicht. Ein hart
 * verdrahtetes `+49` haette eine polnische oder tuerkische Mobilnummer still
 * zu einer deutschen gemacht — und das faellt erst auf, wenn die SMS nicht
 * ankommt.
 */
export function normalisiereTelefon(eingabe: string, laenderkennung = '49'): string | null {
  const roh = eingabe.replace(/[\s/()\-.]/gu, '');
  if (roh === '') return null;

  let ziffern: string;
  if (roh.startsWith('+')) ziffern = roh.slice(1);
  else if (roh.startsWith('00')) ziffern = roh.slice(2);
  else if (roh.startsWith('0')) ziffern = laenderkennung + roh.slice(1);
  else return null;   // Weder international noch mit nationaler Null: unklar.

  if (!/^[1-9][0-9]{6,14}$/u.test(ziffern)) return null;
  return `+${ziffern}`;
}


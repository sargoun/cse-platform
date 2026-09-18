import 'server-only';

/**
 * Das Gemeinsame der Kundenlesedienste (04-SEITENKARTE §8, CRM-06, K-18, K-20).
 *
 * **Warum es diesen Ordner ueberhaupt gibt, obwohl die Dienste schon
 * existieren.** `listeReklamationen`, `listeNachweise`, `listeAufmasse` und
 * `listeProjekte` laufen technisch im Kunden-Scope — sie nehmen einen
 * `LeseKontext` und stuetzen sich auf RLS. Fuer das Kundenportal fehlt ihnen
 * aber genau eine Spalte, und zwar an JEDER Zeile: die liefernde
 * Gesellschaft. 04-SEITENKARTE §8 verlangt sie ausdruecklich („each row
 * labelled with the supplying entity — which is what CRM-06 asks for"), und
 * der Grund ist nicht Ordnung: ein Kundenzugang kann nach O-52 auf zwei
 * Gesellschaften der Gruppe zeigen, und dann sehen zwei Rechnungen derselben
 * Nummernmaske gleich aus, obwohl sie von zwei GmbHs kommen.
 *
 * **Und ein zweiter Grund, der schwerer wiegt: RLS wirkt zeilenweise, nicht
 * spaltenweise.** `ladeSignaturen` (Leistungsnachweis) fuehrt Breiten- und
 * Laengengrad, die Geraeteuhr-Abweichung und den vollstaendigen Snapshot der
 * Unterschrift mit. Fuer die Rolle `auftragnehmer` sind das die
 * Standortkoordinaten und die Uhr der eingesetzten Kraft — und dem Kunden ist
 * nach 04-SEITENKARTE §8 das ganze `personal`-Modul verschlossen („no names,
 * no schedules"). Die Policy laesst die ZEILE zu Recht durch; welche SPALTEN
 * ein Kunde davon sieht, entscheidet allein die Projektion. Deshalb steht sie
 * hier und nicht in einem Dienst, der zugleich die interne Seite bedient.
 *
 * Jede Abfrage dieses Ordners ist deshalb bewusst eng: sie nennt ihre Spalten
 * einzeln, sie schreibt nichts, und sie fasst keine Tabelle an, die im
 * Kunden-Scope ohnehin null Zeilen liefert (`zahlung`, `op_ausgleich`,
 * `mahnung`, `rechnung_hash`, `rechnungsposition_quelle`,
 * `rechnungsausgangsbuch`, `bautagebuch`, `nachtrag`, `behinderung`). Ein
 * Join darueber gaebe dem Kunden keine Fehlermeldung, sondern eine leere
 * Liste — der Fehlermodus, vor dem K-18 warnt.
 *
 * **Kein `app.aktiver_mandant()` in einem SQL dieses Ordners.** Im
 * Kunden-Scope ist er nach K-20 NULL; eine Bedingung darauf ist keine
 * Verengung, sondern das stille Ende der Ergebnismenge.
 */

/** Was jeder Lesedienst hier bekommt — und mehr braucht er nicht. */
export interface KundenAbfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Die liefernde Gesellschaft einer Zeile.
 *
 * `slug` fuer das Bereichsabzeichen (DESIGN §5), `name` als Rueckfall und
 * fuer den Filter. Beide kommen aus `mandant`, das im Kunden-Scope ueber
 * `t_mandant_lesen`/`app.sichtbare_mandanten()` lesbar ist — nachgemessen
 * gegen eine echte Kundensitzung, nicht angenommen.
 */
export interface Gesellschaft {
  readonly mandantSlug: string;
  readonly mandantName: string;
}

/**
 * Der Join auf `mandant` — wortgleich in jeder Abfrage dieses Ordners.
 *
 * `join` und nicht `left join`: `mandant_id` ist auf jeder Mandantentabelle
 * `not null` mit Fremdschluessel (Invariante 3). Ein `left join` liesse offen,
 * was eine Zeile ohne Gesellschaft bedeuten soll — und die Antwort waere
 * „es gibt keine".
 */
export const GESELLSCHAFT_SPALTEN = 'm.slug as mandant_slug, m.name as mandant_name';

/**
 * Die Zeilenform, die aus der Datenbank kommt: alles Text, alles fertig
 * formatiert.
 *
 * **Geld als Ganzzahltext, nie als Zahl** (Invariante 1, K-16): `bigint`
 * passt nicht verlustfrei in eine JavaScript-Zahl, und ein Cent-Betrag als
 * `number` ist genau der Fehler, der erst nach der Rechnungsstellung
 * auffaellt. Die Seite macht daraus `cent(BigInt(...))` und laesst es durch
 * `formatiereGeld` laufen.
 *
 * **Zeitpunkte fertig in Berliner Ortszeit** (Invariante 2): `to_char(… at
 * time zone 'Europe/Berlin')` rechnet in Postgres. Der Node-Prozess rechnet
 * keine Zone um — seine Zonendatenbank ist nicht die des Servers, und eine
 * Unterschrift um 23:40 soll nicht je nach `TZ` der Laufzeit auf den
 * Folgetag rutschen.
 */
export interface GesellschaftRoh {
  readonly mandant_slug: string;
  readonly mandant_name: string;
}

export function gesellschaftAus(z: GesellschaftRoh): Gesellschaft {
  return { mandantSlug: z.mandant_slug, mandantName: z.mandant_name };
}

/**
 * Die Obergrenze jeder Liste dieses Ordners.
 *
 * Dieselbe Zahl wie in `listeReklamationen` und `listeNachweise`. Sie steht
 * hier einmal, damit nicht drei Listen drei verschiedene Grenzen haben und
 * eine davon still abschneidet.
 */
export const GRENZE = 200;

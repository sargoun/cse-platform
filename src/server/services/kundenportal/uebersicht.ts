import 'server-only';
import type { KundenAbfrage } from './basis.js';

/**
 * Die Zahlen der Kundenuebersicht (DSH-03, 04-SEITENKARTE §8).
 *
 * **Eine Abfrage und nicht sechs.** Die Uebersicht zeigt je Bereich eine
 * Zahl; sechs Zaehlabfragen waeren sechs Rundreisen auf der ersten Seite, die
 * ein Kunde nach der Anmeldung sieht. Gezaehlt wird in der Datenbank —
 * `liste(...).length` haette bei der Obergrenze von 200 still eine falsche
 * Zahl geliefert.
 *
 * **Die Zahlen sind ZUSTAENDE, keine Kennzahlen.** Es steht hier kein
 * Umsatz, keine Entwicklung, kein Vergleich mit dem Vorjahr: was die
 * Gesellschaft mit diesem Kunden verdient, ist keine Auskunft, die der Kunde
 * bekommt, und eine Summe, die wie eine Kennzahl aussieht, wird wie eine
 * gelesen.
 *
 * **`offen_cent` kommt aus `offener_posten`, nicht aus einer Summe ueber
 * `zahlung_zuordnung`** — die ausfuehrliche Begruendung steht in
 * `kundenportal/zahlung.ts`: die Zuordnung zu einer stornierten Zahlung
 * bleibt fuer den Kunden sichtbar, der Storno selbst liegt hinter
 * `p_intern_ceiling`, und eine Summe darueber meldet eine unbezahlte Rechnung
 * als bezahlt.
 */

export interface Kundenuebersicht {
  readonly rechnungen: number;
  /** Ganzzahltext in Cent (Invariante 1). */
  readonly offenCent: string;
  readonly ueberfaelligeposten: number;
  readonly nachweise: number;
  readonly nachweiseOhneGegenzeichnung: number;
  readonly projekte: number;
  readonly reklamationenOffen: number;
  readonly nachrichten: number;
  readonly nachrichtenUngelesen: number;
  /** Laufende Auftraege — `angelegt`, `aktiv` oder `pausiert`. */
  readonly auftraegeAktiv: number;
  readonly auftraege: number;
  /** Angebote, die noch zur Entscheidung stehen (`status = 'versendet'`). */
  readonly angeboteOffen: number;
  readonly angebote: number;
  readonly objekte: number;
  /**
   * Freigegebene Dokumente.
   *
   * **Heute immer 0, und zwar nicht, weil keine freigegeben waeren.**
   * `dokument` traegt im Kunden-Scope keine permissive Policy (O-671, siehe
   * `kundenportal/dokument.ts`). Die Zahl steht trotzdem hier und nicht als
   * Konstante in der Seite: faellt die Entscheidung, zaehlt dieselbe Abfrage
   * richtig, ohne dass jemand daran denkt. Die Karte auf der Uebersicht sagt
   * daneben, warum sie 0 ist — eine nackte Null waere genau die Verwechslung,
   * vor der K-18 warnt.
   */
  readonly dokumente: number;
}

/**
 * `$1` ist der Stichtag als Berliner Kalendertag (K-11) — dieselbe Groesse,
 * gegen die `kundenZahlungsstand` das Alter eines Postens rechnet. Ohne ihn
 * waere „ueberfaellig" von der Uhr des Node-Prozesses abhaengig, und der
 * laeuft in UTC.
 */
export async function kundenUebersicht(
  kontext: KundenAbfrage, stichtag: string,
): Promise<Kundenuebersicht> {
  const [z] = await kontext.abfrage<{
    rechnungen: number; offen: string; ueberfaellig: number;
    nachweise: number; nachweise_offen: number; projekte: number;
    reklamationen_offen: number; nachrichten: number; nachrichten_ungelesen: number;
    auftraege: number; auftraege_aktiv: number;
    angebote: number; angebote_offen: number;
    objekte: number; dokumente: number;
  }>(
    `select
       (select count(*) from rechnung r
         where r.status = 'festgeschrieben')::int as rechnungen,
       /*
        * offen_cent > 0 wie im Ueberfaellig-Zaehler darunter und wie in
        * kundenZahlungsSummen: eine Ueberzahlung traegt einen negativen
        * Restbetrag und ist keine Forderung, die sich mindert.
        */
       (select coalesce(sum(op.offen_cent), 0) from offener_posten op
         where op.art = 'debitor' and op.offen_cent > 0)::text as offen,
       (select count(*) from offener_posten op
         where op.art = 'debitor' and op.ausgeglichen_am is null
           and op.offen_cent > 0 and ($1::date - op.faellig_am) >= 0)::int as ueberfaellig,
       (select count(*) from leistungsnachweis)::int as nachweise,
       (select count(*) from leistungsnachweis l
         where not exists (select 1 from leistungsnachweis_signatur s
                            where s.mandant_id = l.mandant_id
                              and s.leistungsnachweis_id = l.id
                              and s.rolle = 'auftraggeber'))::int as nachweise_offen,
       (select count(*) from projekt p where p.archiviert_am is null)::int as projekte,
       (select count(*) from reklamation rk
         where rk.archiviert_am is null
           and rk.status not in ('geschlossen', 'abgelehnt'))::int as reklamationen_offen,
       (select count(*) from nachricht n where n.kunde_id is not null)::int as nachrichten,
       /*
        * Nur ausgehend: eine Nachricht, die der KUNDE geschrieben hat
        * (eingehend aus Sicht des Hauses), ist fuer ihn nie „ungelesen".
        * Dieselbe Bildung wie in services/kundenportal/nachricht.ts.
        */
       (select count(*) from nachricht n
         where n.kunde_id is not null and n.richtung = 'ausgehend'
           and not exists (select 1 from nachricht_empfaenger e
                            where e.mandant_id = n.mandant_id and e.nachricht_id = n.id
                              and e.gelesen_am is not null))::int as nachrichten_ungelesen,
       (select count(*) from auftrag a where a.archiviert_am is null)::int as auftraege,
       /*
        * angelegt zaehlt als laufend: ein Auftrag, der am Ersten beginnt,
        * ist vereinbart und nicht „nichts". storniert und abgeschlossen
        * zaehlen nicht — die Karte sagt „laufend", und das muss stimmen.
        */
       (select count(*) from auftrag a
         where a.archiviert_am is null
           and a.status in ('angelegt','aktiv','pausiert'))::int as auftraege_aktiv,
       /*
        * Ein Entwurf ist im Kunden-Scope keine Zeile (t_kunde auf angebot
        * verlangt versendet_am is not null, 0024) — hier wird deshalb
        * nichts zusaetzlich ausgeschlossen.
        */
       (select count(*) from angebot g where g.archiviert_am is null)::int as angebote,
       (select count(*) from angebot g
         where g.archiviert_am is null and g.status = 'versendet')::int as angebote_offen,
       (select count(*) from objekt o where o.archiviert_am is null)::int as objekte,
       /*
        * Heute immer 0 (O-671) — die Begruendung steht am Feld dokumente
        * oben. geloescht_am und sichtbar_fuer_kunde stehen bewusst NICHT
        * in dieser Bedingung: beides haelt p_kunde_ceiling (0009) fest, und
        * eine zweite Fassung derselben Bedingung waere eine, die abweicht.
        */
       (select count(*) from dokument d)::int as dokumente`,
    [stichtag],
  );
  return {
    rechnungen: Number(z?.rechnungen ?? 0),
    offenCent: z?.offen ?? '0',
    ueberfaelligeposten: Number(z?.ueberfaellig ?? 0),
    nachweise: Number(z?.nachweise ?? 0),
    nachweiseOhneGegenzeichnung: Number(z?.nachweise_offen ?? 0),
    projekte: Number(z?.projekte ?? 0),
    reklamationenOffen: Number(z?.reklamationen_offen ?? 0),
    nachrichten: Number(z?.nachrichten ?? 0),
    nachrichtenUngelesen: Number(z?.nachrichten_ungelesen ?? 0),
    auftraege: Number(z?.auftraege ?? 0),
    auftraegeAktiv: Number(z?.auftraege_aktiv ?? 0),
    angebote: Number(z?.angebote ?? 0),
    angeboteOffen: Number(z?.angebote_offen ?? 0),
    objekte: Number(z?.objekte ?? 0),
    dokumente: Number(z?.dokumente ?? 0),
  };
}

import 'server-only';
import { klasseFuer, KLASSE_LABEL, type Klasse } from '../buchhaltung/offene-posten.js';
import {
  GESELLSCHAFT_SPALTEN, GRENZE, gesellschaftAus,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Der Zahlungsstand der eigenen Rechnungen (ACC-04, FIN-15,
 * 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Die Falle, die diese Datei vermeidet — und sie kostet echtes Geld
 * ===========================================================================
 *
 * Der naheliegende Weg waere, die Teilzahlungen aus `zahlung_zuordnung` zu
 * summieren. Das ergibt fuer den Kunden eine FALSCHE Zahl, und die Ursache
 * ist eine Policy:
 *
 *  · `zahlung` traegt `p_intern_ceiling` (`app.portal() = 'intern'`) und hat
 *    kein `t_kunde`. Im Kunden-Scope liefert die Tabelle null Zeilen.
 *  · `zahlung_zuordnung` dagegen traegt `t_kunde` und ist sichtbar.
 *  · Eine Zuordnung zu einer STORNIERTEN Zahlung bleibt stehen (im
 *    Finanzbereich wird nicht hart geloescht, Invariante 8) — der Storno
 *    steht in `zahlung.storniert_am`, also hinter der Decke.
 *
 * Eine Summe ueber `zahlung_zuordnung` kann den Storno deshalb NICHT
 * ausfiltern. Im Demobestand gibt es diesen Fall wirklich: Posten
 * `5a841421-…` traegt eine fuer den Kunden sichtbare Zuordnung ueber
 * 119.000 Cent zu einer am 17.09.2026 stornierten Zahlung, waehrend
 * `bezahlt_cent = 0` und `offen_cent = 119000` gilt. Die Summe haette dem
 * Kunden „bezahlt 1.190,00 EUR, offen 0,00 EUR" fuer eine unbezahlte
 * Rechnung gemeldet. Dasselbe gilt fuer `art = 'ueberzahlung'`, die nach dem
 * Kommentar von `abstimmungOffenePosten` gar nicht tilgt.
 *
 * **Gelesen werden deshalb `bezahlt_cent` und `offen_cent` vom Posten
 * selbst.** `offen_cent` ist eine erzeugte Spalte (`betrag - bezahlt`), und
 * `bezahlt_cent` schreiben die Ausloeser aus den Zuordnungen — mit Kenntnis
 * des Stornos, weil sie intern laufen. Beide sind im Kunden-Scope lesbar und
 * stehen in derselben Zeile, die die Abfrage ohnehin liest. Es wird hier
 * nichts addiert (Invariante 1: keine Rechnung ausserhalb einer gepruefeten
 * Funktion — und die gepruefte Funktion ist hier der Datenbankausloeser).
 *
 * ===========================================================================
 * Was NICHT gezeigt wird
 * ===========================================================================
 *
 *  · **Kein „bezahlt am".** `zahlung_zuordnung` fuehrt `betrag_cent` und
 *    `art`, aber kein Valutadatum; das liegt in `zahlung` und bleibt
 *    verschlossen. `erstellt_am` der Zuordnung waere der BUCHUNGSzeitpunkt
 *    und nicht der Zahlungseingang — eine Zahl, die aussieht wie eine
 *    Antwort und eine andere Frage beantwortet.
 *    // TODO(client, O-672): Soll dem Kunden das Valutadatum seiner eigenen
 *    Zahlung angezeigt werden (dann braucht `zahlung` einen eng gefassten
 *    Kundenlesepfad auf die eigenen Eingaenge), oder genuegt „ausgeglichen
 *    am"?
 *  · **Keine Mahnstufe.** `op.letzte_mahnstufe` ist im Kunden-Scope lesbar,
 *    `mahnung` selbst nicht. Eine Stufe ohne das Schreiben dahinter ist eine
 *    Drohung ohne Text.
 *    // TODO(client, O-673): Sieht ein Kunde seinen eigenen Mahnstand im
 *    Portal — Stufe, Datum, Gebuehr —, oder bleibt das Mahnwesen ein
 *    Vorgang, der ausschliesslich per Post und Mail stattfindet?
 *  · **Keine Guthaben-Posten.** `art = 'debitor_guthaben'` faellt heraus:
 *    `p_op_decke` laesst im Kundenportal ohnehin nur `debitor` zu, und eine
 *    Guthabenzeile zwischen Forderungen ist keine Forderung (so trennt es
 *    `altersstruktur` auch intern).
 */

export type { Klasse };
export { KLASSE_LABEL };

/** Der Zustand eines Postens — auf das feste Pillenvokabular abbildbar. */
export type Postenzustand = 'offen' | 'teilweise' | 'ausgeglichen';

export interface Kundenposten extends Gesellschaft {
  readonly id: string;
  readonly rechnungId: string | null;
  readonly belegnummer: string | null;
  readonly faelligAmLokal: string;
  /** Kalendertage seit Faelligkeit, negativ vor der Faelligkeit (K-11). */
  readonly tage: number;
  readonly klasse: Klasse;
  readonly betragCent: string;
  readonly bezahltCent: string;
  readonly offenCent: string;
  readonly ausgeglichenAmLokal: string | null;
  readonly zustand: Postenzustand;
}

interface PostenZeile extends GesellschaftRoh {
  readonly id: string;
  readonly rechnung_id: string | null;
  readonly belegnummer: string | null;
  readonly faellig_lokal: string;
  readonly tage: number;
  readonly betrag_cent: string;
  readonly bezahlt_cent: string;
  readonly offen_cent: string;
  readonly ausgeglichen_lokal: string | null;
}

/**
 * Der Zahlungsstand zu einem Stichtag.
 *
 * **Das Alter ist eine Differenz von KALENDERTAGEN**, `$1::date -
 * op.faellig_am`, beides `date` im Berliner Kalender (K-11) — kein Zeitpunkt,
 * keine Zone, keine Stunde, die an einem Umstellungswochenende fehlt. Genau
 * dieselbe Rechnung wie in `postenListe`, und `klasseFuer` ist ihre lesbare
 * Fassung; die Einteilung wird hier nicht ein zweites Mal erfunden.
 *
 * Ausgeglichene Posten bleiben in der Liste. Die interne Seite filtert sie
 * heraus, weil sie fragt „was ist noch offen"; der Kunde fragt „was habe ich
 * bezahlt" — eine Liste, aus der eine bezahlte Rechnung verschwindet, liest
 * sich wie eine verlorene Zahlung.
 */
export async function kundenZahlungsstand(
  kontext: KundenAbfrage, stichtag: string,
): Promise<readonly Kundenposten[]> {
  const zeilen = await kontext.abfrage<PostenZeile>(
    `select op.id, op.rechnung_id, r.nummer as belegnummer,
            to_char(op.faellig_am, 'DD.MM.YYYY') as faellig_lokal,
            ($1::date - op.faellig_am)::int as tage,
            op.betrag_cent::text as betrag_cent,
            op.bezahlt_cent::text as bezahlt_cent,
            op.offen_cent::text as offen_cent,
            /*
             * OHNE "at time zone": ausgeglichen_am ist eine date-Spalte, also
             * ein Kalendertag und kein Zeitpunkt. Postgres castet einen date
             * dafuer ueber die SITZUNGSZONE nach timestamptz und rechnet dann
             * nach Berlin — das Ergebnis haengt damit an TimeZone der
             * Verbindung: mit einer Zone oestlich von Berlin kippt der Tag
             * (set timezone='Asia/Tokyo' macht aus dem 17.09. den 16.09.).
             * faellig_am zwei Zeilen hoeher macht es richtig; ein Kalendertag
             * braucht keine Zonenumrechnung.
             *
             * (Keine Schraegstriche-Anfuehrungszeichen in diesem Kommentar: er
             * steht in einem Template-Literal, und ein Backtick darin beendet
             * die Zeichenkette.)
             */
            to_char(op.ausgeglichen_am, 'DD.MM.YYYY') as ausgeglichen_lokal,
            ${GESELLSCHAFT_SPALTEN}
       from offener_posten op
       join mandant m on m.id = op.mandant_id
       left join rechnung r on r.mandant_id = op.mandant_id and r.id = op.rechnung_id
      where op.art = 'debitor'
      order by op.faellig_am, op.id
      limit ${GRENZE}`,
    [stichtag],
  );
  return zeilen.map((z) => ({
    id: z.id,
    rechnungId: z.rechnung_id,
    belegnummer: z.belegnummer,
    faelligAmLokal: z.faellig_lokal,
    tage: Number(z.tage),
    klasse: klasseFuer(Number(z.tage)),
    betragCent: z.betrag_cent,
    bezahltCent: z.bezahlt_cent,
    offenCent: z.offen_cent,
    ausgeglichenAmLokal: z.ausgeglichen_lokal,
    zustand: zustandVon(z),
    ...gesellschaftAus(z),
  }));
}

/**
 * Der Zustand aus den drei Betraegen — eine reine Funktion, damit sie geprueft
 * werden kann.
 *
 * `ausgeglichen_am` entscheidet NICHT allein: ein Posten kann durch eine
 * Gutschrift oder eine Umbuchung ausgeglichen sein, ohne dass `bezahlt_cent`
 * den vollen Betrag traegt. `offen_cent <= 0` ist die Frage, auf die es
 * ankommt — und `<= 0` und nicht `= 0`, weil eine Ueberzahlung einen
 * negativen Restbetrag ergibt und dann erst recht nichts mehr offen ist.
 */
export function zustandVon(z: {
  readonly bezahlt_cent: string; readonly offen_cent: string;
  readonly ausgeglichen_lokal: string | null;
}): Postenzustand {
  if (BigInt(z.offen_cent) <= 0n || z.ausgeglichen_lokal !== null) return 'ausgeglichen';
  return BigInt(z.bezahlt_cent) > 0n ? 'teilweise' : 'offen';
}

/**
 * Die Summen der Liste — in der DATENBANK gebildet, nicht in der Seite.
 *
 * Die Alternative waere, die Zeilen in TypeScript zu addieren. Das ginge mit
 * `BigInt` sogar richtig; es waere aber eine Rechnung in einer Komponente
 * (CLAUDE.md: „No calculation in a component, ever"), und die zweite, die
 * jemand daneben schreibt, waere die falsche.
 */
export async function kundenZahlungsSummen(
  kontext: KundenAbfrage, stichtag: string,
): Promise<{
  readonly offenCent: string; readonly ueberfaelligCent: string;
  readonly bezahltCent: string; readonly anzahl: number;
}> {
  const [z] = await kontext.abfrage<{
    offen: string; ueberfaellig: string; bezahlt: string; anzahl: number;
  }>(
    /**
     * **`filter (where op.offen_cent > 0)` an beiden Geldkacheln.**
     * Eine Ueberzahlung ergibt einen NEGATIVEN Restbetrag — das ist kein
     * Randfall, sondern von der Tabelle vorgesehen: `zustandVon` prueft
     * darum `<= 0`, und der CHECK `op_ausgleich_stimmig` erzwingt bei einer
     * Ueberzahlung sogar `ausgeglichen_am IS NULL`. Ohne den Filter senkt
     * eine Ueberzahlung die gemeldete Forderung unter die Summe der offenen
     * Zeilen, die daneben stehen — und der Kunde sieht zwei Zahlen, die sich
     * widersprechen.
     *
     * **Derselbe Ueberfaellig-Filter wie in `kundenUebersicht`.** Dort steht
     * `offen_cent > 0` zusaetzlich zu `ausgeglichen_am is null`; stuende er
     * hier nicht, naennten zwei Bildschirme zwei Zahlen fuer „ueberfaellig".
     *
     * `anzahl` ist die Zahl ALLER Posten — ohne die Grenze, die
     * `kundenZahlungsstand` auf die Liste legt. Die Seite vergleicht die
     * beiden und sagt es, wenn die Liste kuerzer ist als die Summe.
     */
    `select coalesce(sum(op.offen_cent) filter (where op.offen_cent > 0), 0)::text as offen,
            coalesce(sum(op.offen_cent) filter (
              where op.ausgeglichen_am is null and op.offen_cent > 0
                and ($1::date - op.faellig_am) >= 0
            ), 0)::text as ueberfaellig,
            coalesce(sum(op.bezahlt_cent), 0)::text as bezahlt,
            count(*)::int as anzahl
       from offener_posten op
      where op.art = 'debitor'`,
    [stichtag],
  );
  return {
    offenCent: z?.offen ?? '0',
    ueberfaelligCent: z?.ueberfaellig ?? '0',
    bezahltCent: z?.bezahlt ?? '0',
    anzahl: Number(z?.anzahl ?? 0),
  };
}

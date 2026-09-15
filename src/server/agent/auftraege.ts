import 'server-only';
import type { VorgangTyp } from '../services/freigabe/posteingang.js';

/**
 * **Was ein Agent formulieren darf — die Liste, nicht der Rumpf der Anfrage.**
 *
 * Jeder der vier Agenten hat genau einen Auftrag, den ein Mensch von Hand
 * auslösen kann, und er steht hier: Vorlage, Vorgangsart, Titel. Der Rumpf der
 * Route bringt nur mit, WER es auslöst — nie WAS formuliert wird.
 *
 * **Warum das keine Umständlichkeit ist.** Wäre die Vorlage ein Feld im
 * Formular, liesse sich dem Modell jeder beliebige Text als „Tatsache"
 * unterschieben, und der Umweg über die Dienste wäre freiwillig. So ist er es
 * nicht: die Tatsachen kommen aus `tatsachen()`, also aus einer Funktion, die
 * SQL gegen die eigene Gesellschaft stellt.
 *
 * **Und deshalb ist die Liste kurz.** Vier Aufträge, einer je Agent — das ist
 * das, was heute an echten Daten hängt. Jeder weitere ist eine Zeile hier plus
 * die Abfrage, die ihn füttert, plus der Test, der beweist, dass keine Zahl
 * erfunden wird.
 */

export interface EntwurfAuftrag {
  readonly vorgangTyp: VorgangTyp;
  /**
   * Was geschähe, wenn jemand genehmigt — je Auftrag, nicht für alle gleich.
   * `interner_hinweis` ist eine Handlung im Haus; `entwurf_vorlegen` heisst,
   * dass ein Mensch den Text danach selbst verschickt. Beides ist etwas
   * anderes, und der Posteingang liest den Unterschied.
   */
  readonly aktion: string;
  readonly titel: string;
  readonly vorlage: string;
  readonly tatsachen: Readonly<Record<string, string>>;
}

/**
 * Die Vorgaben. `tatsachen` steht hier als GERÜST mit den Schlüsseln, die die
 * Vorlage erwartet — die Werte füllt `fuelleTatsachen()` aus der Datenbank
 * des aktiven Mandanten. Ein Schlüssel ohne Wert bleibt als `{platzhalter}`
 * im Entwurf stehen und fällt auf; er wird nicht stillschweigend leer.
 */
export const ENTWURF_AUFTRAEGE: Readonly<Record<string, EntwurfAuftrag>> = {
  ceo_assistent: {
    vorgangTyp: 'interner_hinweis',
    aktion: 'interner_hinweis',
    titel: 'Lagebericht: was heute Aufmerksamkeit braucht',
    vorlage: 'interner_hinweis',
    tatsachen: {},
  },
  akquise: {
    vorgangTyp: 'anfrage_antwort_entwurf',
    // NICHT `email_senden`: der Lauf legt einen Text vor, er verschickt nichts.
    // Die Aktion benennt, was die Genehmigung auslöst — und das ist hier, dass
    // ein Mensch den Entwurf übernimmt (Invariante 7).
    aktion: 'anfrage_antwort_entwurf',
    titel: 'Antwortentwurf auf die jüngste Anfrage',
    vorlage: 'anfrage_antwort_entwurf',
    tatsachen: {},
  },
  backoffice: {
    vorgangTyp: 'interner_hinweis',
    aktion: 'interner_hinweis',
    titel: 'Hinweis: offene Leistungsnachweise',
    vorlage: 'interner_hinweis',
    tatsachen: {},
  },
  finanzen: {
    vorgangTyp: 'interner_hinweis',
    aktion: 'interner_hinweis',
    titel: 'Hinweis: offene Posten und Fälligkeiten',
    vorlage: 'interner_hinweis',
    tatsachen: {},
  },
};

export interface Leser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * **Die Tatsachen kommen aus der Gesellschaft, nicht aus dieser Datei.**
 *
 * Vorher stand hier feste Prosa: jede der vier Gesellschaften bekam denselben
 * Lagebericht, und `stand: 'heute'` war ein Wort und kein Datum. Ein Vorschlag,
 * der für die Reinigung und für den Bau gleich lautet, sagt über beide nichts —
 * und schlimmer: er sieht aus, als hätte jemand nachgesehen.
 *
 * Jede Zahl hier ist ein `count(*)` gegen die Tabellen des aktiven Mandanten,
 * durch RLS begrenzt (Invariante 3). Das Modell bekommt sie als fertige
 * Zeichenkette und rechnet nichts (Invariante 6) — und
 * `pruefeZahlenherkunft` prüft nach dem Lauf, dass keine dazugekommen ist.
 *
 * **Das Datum kommt von der Serveruhr** (Invariante 2, Invariante 5):
 * `app.berlin_heute()`, nie `new Date()`.
 */
export async function fuelleTatsachen(
  db: Leser, agent: string,
): Promise<Readonly<Record<string, string>>> {
  const [heute] = await db.abfrage<{ tag: string }>(
    `select to_char(app.berlin_heute(), 'DD.MM.YYYY') as tag`);
  const stand = heute?.tag ?? '';

  if (agent === 'ceo_assistent') {
    const [z] = await db.abfrage<{ freigaben: string; schichten: string }>(
      `select (select count(*) from freigabe where status = 'offen')::text as freigaben,
              (select count(*) from einsatz e
                where e.plan_datum = app.berlin_heute() + 1
                  and e.status <> 'storniert'
                  and (select count(*) from einsatz_zuordnung z
                        where z.einsatz_id = e.id and z.status in ('geplant','zugesagt'))
                      < e.min_besetzung)::text as schichten`);
    return {
      stand,
      offene_freigaben: z?.freigaben ?? '0',
      unbesetzte_schichten_morgen: z?.schichten ?? '0',
      empfehlung: 'Zuerst die offenen Freigaben ansehen, dann den Dienstplan für morgen.',
    };
  }

  if (agent === 'akquise') {
    const [z] = await db.abfrage<{
      firma: string | null; eingang: string | null; betreff: string | null; offen: string;
    }>(
      `select l.firma_name as firma,
              to_char(l.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as eingang,
              l.betreff,
              (select count(*) from lead
                where status in ('neu','in_bearbeitung','angebot'))::text as offen
         from lead l
        order by l.erstellt_am desc
        limit 1`);
    return {
      stand,
      empfaenger: z?.firma ?? 'die anfragende Stelle',
      datum: z?.eingang ?? stand,
      betreff: z?.betreff ?? 'die eingegangene Anfrage',
      offene_anfragen: z?.offen ?? '0',
      offen: 'die Angabe zur Personenzahl',
    };
  }

  if (agent === 'backoffice') {
    /*
     * `signiert` ist der Zustand, den ein unterschriebener Nachweis traegt;
     * `vorgelegt` heisst „beim Kunden, noch nicht unterschrieben" (LN-Status,
     * 0043). Gezaehlt wird also der Zustand, nicht eine Unterschriftsspalte --
     * die gibt es nicht, und eine zu erfinden hiesse, die Fachsprache zu
     * verlassen.
     */
    const [z] = await db.abfrage<{ offen: string; gesamt: string }>(
      `select (select count(*) from leistungsnachweis
                where status in ('entwurf','vorgelegt') and storniert_am is null)::text as offen,
              (select count(*) from leistungsnachweis
                where storniert_am is null)::text as gesamt`);
    return {
      stand,
      ohne_unterschrift: z?.offen ?? '0',
      nachweise_gesamt: z?.gesamt ?? '0',
      empfehlung: 'Objektleitung erinnert den Kunden schriftlich.',
    };
  }

  /*
   * „Ueberfaellig" und nicht „offen": ob eine festgeschriebene Rechnung bezahlt
   * ist, steht im Zahlungsabgleich und nicht als Spalte an der Rechnung.
   * Gezaehlt wird deshalb, was nach seinem Faelligkeitsdatum noch in der
   * Ausgangsseite steht -- eine Aussage, die diese Abfrage wirklich belegen
   * kann.
   */
  const [z] = await db.abfrage<{ offen: string; faellig: string }>(
    `select (select count(*) from rechnung
              where status = 'festgeschrieben'
                and faellig_am is not null
                and faellig_am < app.berlin_heute())::text as offen,
            (select count(*) from eingangsrechnung
              where status in ('freigegeben','gebucht')
                and faellig_am is not null
                and faellig_am <= app.berlin_heute())::text as faellig`);
  return {
    stand,
    ueberfaellige_forderungen: z?.offen ?? '0',
    faellige_eingangsrechnungen: z?.faellig ?? '0',
    empfehlung: 'Fällige Posten vor dem Monatsende ansehen.',
  };
}

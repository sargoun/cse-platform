import 'server-only';
import type { VorgangTyp } from '../services/freigabe/posteingang.js';
import { anfrageLuecken, lueckenText } from '../services/lead/einsendung.js';
import { Felder } from '../../lib/formular/schema.js';
import type { SchreibKontext } from '../kontext/index.js';
import { fuehreLaufAus, type AgentKennung, type LaufErgebnis } from './orchestrator.js';

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

/**
 * Der Akquise-Agent findet keine offene Anfrage — es gibt nichts zu
 * beantworten, und ein Entwurf „an die anfragende Stelle" wäre einer an
 * niemanden (V-230). Die Laufroute und das Vorschaltblatt sagen das, statt
 * einen Lauf zu starten.
 */
export class KeineOffeneAnfrage extends Error {
  readonly code = 'KEINE_ANFRAGE' as const;
  constructor() {
    super('Es gibt keine offene Anfrage über das Anfrageformular (neu oder in '
      + 'Bearbeitung), auf die ein Entwurf antworten könnte.');
    this.name = 'KeineOffeneAnfrage';
  }
}

export interface Leser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * **Ein Lauf auf Knopfdruck** — was `POST /api/agenten/lauf` tut, ohne HTTP
 * (V-230, V-271, D-724 Nr. 1).
 *
 * **Erst die Tatsachen, dann die Aufgabe.** Findet `fuelleTatsachen` keine
 * offene Anfrage, entsteht KEINE Zeile: die Antwort ist `{ lauf: null, code:
 * 'KEINE_ANFRAGE' }`, und die Route leitet mit diesem Code zurück. Ein Entwurf
 * „an die anfragende Stelle" wäre einer an niemanden. Die Reihenfolge stand
 * bis V-271 in der Route und war nur dort — geprüft wurde sie nie; jetzt
 * prüft sie `tests/isolation/akquise-tatsachen.test.ts` (6) an echten Zeilen.
 */
export async function starteLaufAufKnopfdruck(
  kontext: SchreibKontext,
  eingabe: {
    readonly agent: AgentKennung;
    /** Der Schlüssel des Formulars — derselbe bei jeder Wiederholung (Idempotenz). */
    readonly schluessel: string;
    readonly angefordertVon: string;
    readonly codeVersion: string;
  },
): Promise<{ readonly lauf: LaufErgebnis | null; readonly code: string | null }> {
  const auftrag = ENTWURF_AUFTRAEGE[eingabe.agent];
  if (auftrag === undefined) {
    throw new Error(`Für den Agenten „${eingabe.agent}" gibt es keinen Auftrag.`);
  }
  let tatsachen: Readonly<Record<string, string>>;
  try {
    // Die Tatsachen kommen aus DIESER Gesellschaft, durch RLS begrenzt.
    tatsachen = await fuelleTatsachen({ abfrage: kontext.abfrage.bind(kontext) }, eingabe.agent);
  } catch (fehler) {
    if (fehler instanceof KeineOffeneAnfrage) return { lauf: null, code: fehler.code };
    throw fehler;
  }
  const lauf = await fuehreLaufAus(kontext, {
    ...auftrag,
    agent: eingabe.agent,
    tatsachen,
    idempotenzSchluessel: `${eingabe.agent}:${eingabe.schluessel}`,
    angefordertVon: eingabe.angefordertVon,
    codeVersion: eingabe.codeVersion,
  });
  return { lauf, code: null };
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
    const freigaben = z?.freigaben ?? '0';
    const schichten = z?.schichten ?? '0';
    return {
      stand,
      offene_freigaben: freigaben,
      unbesetzte_schichten_morgen: schichten,
      /*
       * **`zusammenfassung` ist PFLICHT** -- jede Vorlage in
       * `modell/demo.ts` traegt den Platzhalter, und `fuelle()` laesst einen
       * Platzhalter ohne Tatsache absichtlich STEHEN (besser eine sichtbare
       * Luecke als eine stille Null). Ohne diesen Schluessel stand in jedem
       * Demoentwurf woertlich „{zusammenfassung}" -- der Knopf lief, der
       * Vorschlag lag vor, und er war unfertig. Der Satz ist aus denselben
       * Zahlen gebaut, die darunter einzeln stehen: die Zahlenherkunft
       * (Invariante 6) bleibt damit geschlossen.
       */
      zusammenfassung: `Es warten ${freigaben} Freigaben auf eine Entscheidung, `
        + `und für morgen sind ${schichten} Schichten unterbesetzt.`,
      empfehlung: 'Zuerst die offenen Freigaben ansehen, dann den Dienstplan für morgen.',
    };
  }

  if (agent === 'akquise') {
    /*
     * **Nur eine OFFENE Anfrage, nur ihre eigenen Lücken, keine interne Zahl**
     * (V-230, D-724).
     *
     * Vorher: die jüngste Anfrage ohne Statusfilter (auch eine längst
     * gewonnene oder verlorene), die Zahl der laufenden Anfragen im Text an
     * den Interessenten — das interne Auftragsvolumen — und als Lücke fest
     * eine Personenzahl, egal was die Anfrage enthielt.
     *
     * **Und nur, wo jemand GEFRAGT hat** (V-271, D-764). Der Entwurf beginnt
     * mit „Vielen Dank für Ihre Anfrage vom …" — das ist eine Tatsache, und
     * belegt ist sie nur durch einen `formular_eingang`: die Einsendung des
     * Anfrageformulars, mit Zeitpunkt und Datenschutzbestätigung. Ein
     * recherchierter Lead (`akquise`) hat niemanden gefragt (D-631), ein Lead
     * aus dem Vergaberadar ist eine öffentliche Bekanntmachung, und ob eine
     * von Hand erfasste Anfrage oder eine Empfehlung eine Anfrage des
     * Kontakts ist, ist offen (O-907). Keiner davon bekommt einen Dank für
     * eine Anfrage, die es so nicht gab.
     *
     * **Kein interner Betreff im Text.** `lead.betreff` ist ein Arbeitstitel —
     * beim Webformular „Anfrage {Formularschlüssel}", bei der Akquise
     * „Akquise: {Firma}". Der Entwurf nennt stattdessen den öffentlichen
     * Titel des Formulars, das der Anfragende selbst ausgefüllt hat; liest
     * die Sitzung es nicht, nennt er keinen.
     *
     * Als Lücke nur, was das Formular leer lässt (`anfrageLuecken`); liest
     * diese Sitzung das Formular nicht (RLS), wird keine Lücke genannt —
     * lieber keine als eine erfundene.
     */
    const [z] = await db.abfrage<{
      firma: string | null; eingang: string | null; formular: string | null;
      daten: Record<string, unknown> | null; felder: unknown;
    }>(
      `select l.firma_name as firma,
              to_char(l.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as eingang,
              fd.titel as formular,
              fe.daten, fd.felder
         from lead l
         left join formular_eingang fe
                on fe.mandant_id = l.mandant_id and fe.id = l.formular_eingang_id
         left join formular_definition fd
                on fd.mandant_id = fe.mandant_id and fd.id = fe.formular_definition_id
        where l.status in ('neu', 'in_bearbeitung')
          and l.archiviert_am is null
          and l.formular_eingang_id is not null
          and l.quelle not in ('akquise', 'vergabe_radar')
        order by l.erstellt_am desc
        limit 1`);
    if (z === undefined) throw new KeineOffeneAnfrage();

    const felder = Felder.safeParse(z.felder);
    const luecken = felder.success && z.daten !== null ? anfrageLuecken(felder.data, z.daten) : [];
    const offen = lueckenText(luecken);
    const formular = z.formular === null || z.formular.trim() === '' ? null : z.formular.trim();
    return {
      stand,
      empfaenger: z.firma ?? 'die anfragende Stelle',
      datum: z.eingang ?? stand,
      ...(formular === null ? {} : { formular }),
      zusammenfassung: formular === null
        ? 'Ihr Anliegen ist bei uns aufgenommen.'
        : `Ihre Anfrage über unser Formular „${formular}" ist bei uns aufgenommen.`,
      ...(offen === null ? {} : { offen }),
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
    const ohne = z?.offen ?? '0';
    const gesamt = z?.gesamt ?? '0';
    return {
      stand,
      ohne_unterschrift: ohne,
      nachweise_gesamt: gesamt,
      zusammenfassung: `${ohne} von ${gesamt} Leistungsnachweisen sind noch nicht `
        + 'unterschrieben.',
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
  const forderungen = z?.offen ?? '0';
  const eingang = z?.faellig ?? '0';
  return {
    stand,
    ueberfaellige_forderungen: forderungen,
    faellige_eingangsrechnungen: eingang,
    zusammenfassung: `${forderungen} Forderungen sind überfällig, und `
      + `${eingang} Eingangsrechnungen sind fällig.`,
    empfehlung: 'Fällige Posten vor dem Monatsende ansehen.',
  };
}

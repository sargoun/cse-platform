/**
 * Die eigenen Zeiteintraege — LESEND, und nur lesend (EMP-03, EMP-07, TIM-08,
 * TIM-11, TIM-13, LEG-02).
 *
 * **Dieser Dienst hat keine Schreibfunktion, und das ist die Zusage.** EMP-07:
 * „the employee never edits a time entry". Der Grund ist nicht Misstrauen,
 * sondern Beweiswert: eine Aufzeichnung, die die betroffene Person selbst
 * geschrieben hat, ist keine Aufzeichnung mehr, sondern ihre Behauptung — im
 * Lohnstreit und in einer Pruefung nach § 17 MiLoG genau das, was sie nicht
 * sein darf. Der einzige Weg des Menschen ist der Einwand
 * (`zeit/einwand.ts`), und die Datenbank haelt die Gegenprobe:
 * `p_ma_kein_update` auf `zeiteintrag` ist `restrictive` und laesst im
 * Mitarbeiterportal kein UPDATE zu, auch nicht mit `zeit.schreiben`.
 *
 * **Serverzeit und Geraetezeit stehen NEBENEINANDER** (Invariante 5, TIM-08).
 * Massgeblich ist die Serveruhr; die Geraetezeit und die Abweichung in
 * Sekunden werden getrennt gefuehrt und hier auch getrennt gezeigt. Eine
 * Oberflaeche, die nur eine der beiden zeigt, macht aus einer dokumentierten
 * Abweichung eine unsichtbare.
 *
 * **Kein Auftrag, kein Kunde, kein Preis** (EMP-13, K-05). Diese Seite
 * beantwortet „wann", nicht „wofuer wird es berechnet".
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface EigenerZeiteintrag {
  readonly id: string;
  readonly anstellungId: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly objekt: string | null;
  /** Der Berliner Kalendertag des Beginns (K-11). */
  readonly tag: string;
  readonly beginnLokal: string;
  readonly endeLokal: string | null;
  readonly endetAmFolgetag: boolean;
  readonly pauseMinuten: number;
  readonly bruttoMinuten: number | null;
  readonly nettoMinuten: number | null;
  readonly status: string;
  readonly erfassungsartBeginn: string;
  readonly erfassungsartEnde: string | null;
  readonly quelleBeginn: string;
  readonly quelleEnde: string | null;
  /** Die Uhr des Geraets — dokumentiert, nie massgeblich (Invariante 5). */
  readonly geraeteZeitBeginnLokal: string | null;
  readonly geraeteZeitEndeLokal: string | null;
  readonly zeitabweichungBeginnSek: number | null;
  readonly zeitabweichungEndeSek: number | null;
  readonly nacherfasst: boolean;
  readonly storniert: boolean;
  readonly freigegeben: boolean;
  readonly gesperrt: boolean;
  /**
   * Die Fassung der Kette. `> 1` heisst: dieser Eintrag ist eine KORREKTUR
   * einer frueheren Fassung.
   *
   * **Warum die Zahl und nicht die Korrekturzeile.** `zeiteintrag_korrektur`
   * traegt Art, Grund und Begruendung — und `p_ma_decke` (0036:403) sperrt
   * die Tabelle fuer das Arbeiterportal ausdruecklich: „Der Arbeitnehmer sieht
   * seine STUNDEN; die Spur darueber bekommt er auf Auskunft, nicht als
   * Bildschirm." Das bleibt so.
   *
   * Die Fassungsnummer steht dagegen auf dem Eintrag SELBST, den die
   * Mitarbeiterin ohnehin sieht. Sie verraet keine Begruendung und keinen
   * Namen — nur, DASS korrigiert wurde. Zusammen mit der Nachricht, die den
   * Grund traegt (`services/zeit/korrektur.ts`), ist die Schleife geschlossen,
   * ohne die Decke anzuheben.
   */
  readonly fassung: number;
}

/**
 * Die festgeschriebene Feldliste — Gegenstand der K-05-Abnahme.
 *
 * Sie enthaelt kein `stundensatz`, kein `betrag`, kein `kunde` und kein
 * `auftrag`. Der Test vergleicht die Schluessel der Antwort Feld fuer Feld
 * gegen diese Liste; ein spaeter angehaengtes `satz` faellt dabei auf, eine
 * Stichprobe nach dem Wort „preis" faende es nicht.
 */
export const ZEITEINTRAG_FELDER = [
  'id', 'anstellungId', 'mandantSlug', 'mandantName', 'objekt', 'tag',
  'beginnLokal', 'endeLokal', 'endetAmFolgetag', 'pauseMinuten', 'bruttoMinuten',
  'nettoMinuten', 'status', 'erfassungsartBeginn', 'erfassungsartEnde',
  'quelleBeginn', 'quelleEnde', 'geraeteZeitBeginnLokal', 'geraeteZeitEndeLokal',
  'zeitabweichungBeginnSek', 'zeitabweichungEndeSek', 'nacherfasst', 'storniert',
  'freigegeben', 'gesperrt',
  /* Die Fassungsnummer der Kette — `> 1` heisst korrigiert. Kein Lohnfeld:
     eine Zahl ueber die Zeile selbst, ohne Grund, ohne Namen, ohne Betrag. */
  'fassung',
] as const;

interface ZeitRoh {
  readonly id: string;
  readonly anstellung_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly objekt: string | null;
  readonly tag: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string | null;
  readonly endet_am_folgetag: boolean;
  readonly pause_minuten: number;
  readonly brutto_minuten: number | null;
  readonly netto_minuten: number | null;
  readonly status: string;
  readonly erfassungsart_beginn: string;
  readonly erfassungsart_ende: string | null;
  readonly quelle_beginn: string;
  readonly quelle_ende: string | null;
  readonly geraete_zeit_beginn_lokal: string | null;
  readonly geraete_zeit_ende_lokal: string | null;
  readonly zeitabweichung_beginn_sek: number | null;
  readonly zeitabweichung_ende_sek: number | null;
  readonly nacherfasst: boolean;
  readonly storniert: boolean;
  readonly freigegeben: boolean;
  readonly gesperrt: boolean;
  readonly fassung: number;
}

const SPALTEN = `
  z.id, z.anstellung_id,
  m.slug                                   as mandant_slug,
  m.name                                   as mandant_name,
  o.bezeichnung                            as objekt,
  to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'YYYY-MM-DD')     as tag,
  to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                           as beginn_lokal,
  to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                           as ende_lokal,
  coalesce((z.ende_zeitpunkt at time zone 'Europe/Berlin')::date
           > (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date, false)
                                           as endet_am_folgetag,
  z.pause_minuten,
  z.dauer_brutto_minuten                   as brutto_minuten,
  z.dauer_netto_minuten                    as netto_minuten,
  z.status::text                           as status,
  z.erfassungsart_beginn::text             as erfassungsart_beginn,
  z.erfassungsart_ende::text               as erfassungsart_ende,
  z.quelle_beginn::text                    as quelle_beginn,
  z.quelle_ende::text                      as quelle_ende,
  to_char(z.geraete_zeit_beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                           as geraete_zeit_beginn_lokal,
  to_char(z.geraete_zeit_ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                           as geraete_zeit_ende_lokal,
  z.zeitabweichung_beginn_sek,
  z.zeitabweichung_ende_sek,
  z.nacherfasst,
  (z.storniert_am   is not null)           as storniert,
  (z.freigegeben_am is not null)           as freigegeben,
  (z.gesperrt_am    is not null)           as gesperrt,
  z.version                                as fassung`;

const QUELLE = `
  from zeiteintrag z
  join mandant m on m.id = z.mandant_id
  left join objekt o on o.mandant_id = z.mandant_id and o.id = z.objekt_id`;

function abbilden(z: ZeitRoh): EigenerZeiteintrag {
  return {
    id: z.id,
    anstellungId: z.anstellung_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
    objekt: z.objekt,
    tag: z.tag,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    endetAmFolgetag: z.endet_am_folgetag,
    pauseMinuten: Number(z.pause_minuten),
    bruttoMinuten: z.brutto_minuten === null ? null : Number(z.brutto_minuten),
    nettoMinuten: z.netto_minuten === null ? null : Number(z.netto_minuten),
    status: z.status,
    erfassungsartBeginn: z.erfassungsart_beginn,
    erfassungsartEnde: z.erfassungsart_ende,
    quelleBeginn: z.quelle_beginn,
    quelleEnde: z.quelle_ende,
    geraeteZeitBeginnLokal: z.geraete_zeit_beginn_lokal,
    geraeteZeitEndeLokal: z.geraete_zeit_ende_lokal,
    zeitabweichungBeginnSek:
      z.zeitabweichung_beginn_sek === null ? null : Number(z.zeitabweichung_beginn_sek),
    zeitabweichungEndeSek:
      z.zeitabweichung_ende_sek === null ? null : Number(z.zeitabweichung_ende_sek),
    nacherfasst: z.nacherfasst,
    fassung: Number(z.fassung),
    storniert: z.storniert,
    freigegeben: z.freigegeben,
    gesperrt: z.gesperrt,
  };
}

/**
 * Die eigenen Eintraege eines Fensters.
 *
 * Nur die aktuelle Fassung jeder Kette (`ersetzt_am is null`): eine Korrektur
 * praegt eine neue Fassung, und beide nebeneinander in einer Liste saehen aus
 * wie zwei Schichten. Die alte Fassung ist damit nicht weg — sie steht in der
 * Korrekturspur des Eintrags (Invariante 8).
 *
 * Ein STORNIERTER Eintrag bleibt in der Liste und wird als solcher gezeigt.
 * Eine Zeile, die verschwindet, ist eine Zeile, ueber die niemand mehr
 * streiten kann.
 */
export async function listeEigeneZeiten(
  kontext: LeseKontext, fenster: { readonly von: string; readonly bis: string },
): Promise<readonly EigenerZeiteintrag[]> {
  const roh = await kontext.abfrage<ZeitRoh>(
    `select ${SPALTEN} ${QUELLE}
      where z.ersetzt_am is null
        and z.beginn_zeitpunkt < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'
        and (z.ende_zeitpunkt is null
             or z.ende_zeitpunkt > ($1::date::timestamp) at time zone 'Europe/Berlin')
      order by z.beginn_zeitpunkt desc, z.id asc`,
    [fenster.von, fenster.bis],
  );
  return roh.map(abbilden);
}

/** Ein einzelner Eintrag — `null`, wenn er dieser Anmeldung nicht gehoert. */
export async function findeEigenenZeiteintrag(
  kontext: LeseKontext, id: string,
): Promise<EigenerZeiteintrag | null> {
  const [z] = await kontext.abfrage<ZeitRoh>(
    `select ${SPALTEN} ${QUELLE} where z.id = $1::uuid`, [id],
  );
  return z === undefined ? null : abbilden(z);
}

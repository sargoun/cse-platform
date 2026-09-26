/**
 * Antraege und Abwesenheiten aus der Sicht des Menschen (EMP-10, EMP-15,
 * NOT-03).
 *
 * **Dieser Dienst liest und baut das Formular — geschrieben wird woanders.**
 * `reicheAntragEin`, `zieheAntragZurueck` und `meldeAbwesenheit` stehen in
 * `abwesenheit/antrag.ts` und `abwesenheit/index.ts` und bleiben dort: sie
 * laufen im Mandanten-Scope, weil im Personen-Scope `app.aktiver_mandant()`
 * NULL ist und keine Schreibpolicy zutrifft (K-18). Der Mandant wird
 * serverseitig aus der gewaehlten Beschaeftigung aufgeloest, nie aus einem
 * Feld der Anfrage (K-02, Invariante 3) — genau wie beim Zeit-Einwand.
 *
 * **Eine Person, zwei Gesellschaften, zwei Vorgesetzte.** Ein Antrag gehoert
 * immer zu EINER Beschaeftigung: Urlaub bei der Reinigung ist kein Urlaub bei
 * der Security, und die Genehmigung kommt von der Gesellschaft, gegen die der
 * Anspruch besteht (D-09). Die Liste zeigt deshalb beide Seiten
 * nebeneinander, jede mit ihrer Gesellschaft beschriftet — und das Formular
 * verlangt die Wahl, statt eine zu raten.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { findeAntrag, listeAntraege, type AntragZeile } from '../abwesenheit/antrag.js';
import { listeAbwesenheiten, type AbwesenheitZeile } from '../abwesenheit/index.js';
import type { PortalSprache } from '../../../lib/i18n/texte.js';
import type { EigeneAnstellung } from './person.js';

/** Ein Antrag, um seine Gesellschaft ergaenzt. */
export interface EigenerAntrag {
  readonly antrag: AntragZeile;
  readonly mandantSlug: string;
  readonly mandantName: string;
  /** Laesst er sich noch zurueckziehen? Danach ist es keine Ruecknahme mehr. */
  readonly zurueckziehbar: boolean;
}

export const EIGENER_ANTRAG_FELDER = [
  'antrag', 'mandantSlug', 'mandantName', 'zurueckziehbar',
] as const;

/** Die Zustaende, in denen noch niemand entschieden hat (`antrag.ts`). */
const OFFEN: readonly string[] = ['eingereicht', 'in_pruefung'];

/**
 * Die eigenen Antraege ueber alle Beschaeftigungen.
 *
 * Gefragt wird je Beschaeftigung, weil `listeAntraege` genau diese Frage
 * beantwortet und getestet ist. Eine eigene, breitere Abfrage waere eine
 * zweite Fassung derselben Zeilenform — und die erste, die auseinanderlaeuft,
 * sobald `antrag.ts` eine Spalte dazubekommt.
 */
export async function listeEigeneAntraege(
  kontext: LeseKontext, anstellungen: readonly EigeneAnstellung[],
): Promise<readonly EigenerAntrag[]> {
  const alle: EigenerAntrag[] = [];
  for (const a of anstellungen) {
    const zeilen = await listeAntraege(kontext, a.anstellungId);
    for (const antrag of zeilen) {
      alle.push({
        antrag,
        mandantSlug: a.mandantSlug,
        mandantName: a.mandantName,
        zurueckziehbar: OFFEN.includes(antrag.status),
      });
    }
  }
  // Das Neueste oben — ein Antrag von gestern interessiert mehr als einer vom
  // vorletzten Jahr.
  return alle.sort((x, y) =>
    y.antrag.eingereichtAm.getTime() - x.antrag.eingereichtAm.getTime());
}

/**
 * EIN eigener Antrag — in genau der Gestalt, die auch die Liste liefert.
 *
 * **Keine zweite Abfrage.** `findeAntrag` fragt `where a.id = $1::uuid` ohne
 * Anstellungsfilter; die Abgrenzung macht die RLS, und im Personen-Scope
 * liefert `antrag.t_person` genau die eigenen Zeilen. Eine fremde Kennung gibt
 * null Zeilen, und die Seite antwortet darauf 404 statt 403 (AUT-06) — der
 * Unterschied waere die Auskunft, dass es den Antrag gibt.
 *
 * Die Gesellschaft kommt aus den Beschaeftigungen, die `meinPortal` ohnehin
 * gelesen hat: sie zweimal zu lesen hiesse, zwei Namen fuer denselben Bereich
 * haben zu koennen. Gehoert der Antrag zu keiner davon — was die RLS
 * eigentlich ausschliesst —, ist er fuer diese Anmeldung nicht vorhanden.
 */
export async function findeEigenenAntrag(
  kontext: LeseKontext, anstellungen: readonly EigeneAnstellung[], id: string,
): Promise<EigenerAntrag | null> {
  const antrag = await findeAntrag(kontext, id);
  if (antrag === null) return null;
  const a = anstellungen.find((x) => x.anstellungId === antrag.anstellungId);
  if (a === undefined) return null;
  return {
    antrag,
    mandantSlug: a.mandantSlug,
    mandantName: a.mandantName,
    zurueckziehbar: OFFEN.includes(antrag.status),
  };
}

export interface EigeneAbwesenheit {
  readonly abwesenheit: AbwesenheitZeile;
  readonly mandantSlug: string;
  readonly mandantName: string;
  /**
   * Lässt sie sich noch zurücknehmen? (V-056)
   *
   * Dieselbe Frage wie beim Antrag daneben und dieselbe Antwort: solange
   * niemand entschieden hat. `abwesenheit.t_selbst_zurueckziehen` (0386) hält
   * genau diese Menge — die Oberfläche fragt sie hier, damit der Knopf nicht
   * an einer Policy scheitert, die der Mensch nicht sieht.
   */
  readonly zurueckziehbar: boolean;
}

export const EIGENE_ABWESENHEIT_FELDER = [
  'abwesenheit', 'mandantSlug', 'mandantName', 'zurueckziehbar',
] as const;

/**
 * Die Zustände, in denen bei einer Abwesenheit noch niemand entschieden hat.
 *
 * `erfasst` ist der Endzustand der Krankmeldung (sie wird zur Kenntnis
 * genommen), `beantragt` der einer Abwesenheit, über die noch entschieden
 * wird. Aus `genehmigt` führt die Rücknahme nur noch über die Personalstelle:
 * dort hat jemand über Lohnfortzahlung und Urlaubskonto entschieden, und das
 * still zu entwerten ist keine Rücknahme.
 */
const ABWESENHEIT_OFFEN: readonly string[] = ['erfasst', 'beantragt'];

/**
 * Die eigenen Abwesenheiten — ohne Grund und ohne Diagnose.
 *
 * `listeAbwesenheiten` liefert den GRUND gar nicht: `abwesenheitsart_id`,
 * `au_*`, `dokument_id` und `bemerkung` gibt `abwesenheit` dem Anwendungsrollen
 * `cse_app` nicht zu lesen (0073, Art. 9 DSGVO). Dass hier die eigene Zeile
 * steht, aendert daran nichts — der Weg zum Grund ist `leseGrund`, und der
 * schreibt eine Auditzeile.
 */
export async function listeEigeneAbwesenheiten(
  kontext: LeseKontext, anstellungen: readonly EigeneAnstellung[],
): Promise<readonly EigeneAbwesenheit[]> {
  const nachId = new Map(anstellungen.map((a) => [a.anstellungId, a]));
  const zeilen = await listeAbwesenheiten(kontext);
  return zeilen.map((abwesenheit) => {
    const a = nachId.get(abwesenheit.anstellungId);
    return {
      abwesenheit,
      mandantSlug: a?.mandantSlug ?? '',
      mandantName: a?.mandantName ?? '',
      zurueckziehbar: ABWESENHEIT_OFFEN.includes(abwesenheit.status)
        && abwesenheit.storniertAm === null,
    };
  });
}

/**
 * EINE eigene Abwesenheit — in genau der Gestalt, die auch die Liste liefert.
 *
 * Über dieselbe Liste und nicht über eine zweite, engere Abfrage: eine
 * eigene wäre eine zweite Fassung derselben Zeilenform, und die erste, die
 * auseinanderläuft, sobald `abwesenheit/index.ts` eine Spalte dazubekommt.
 * Die Liste ist im Personen-Scope ohnehin auf die eigenen Zeilen verengt
 * (`t_person`), also ist die Suche darin kein Leseweg an der RLS vorbei.
 */
export async function findeEigeneAbwesenheit(
  kontext: LeseKontext, anstellungen: readonly EigeneAnstellung[], id: string,
): Promise<EigeneAbwesenheit | null> {
  const alle = await listeEigeneAbwesenheiten(kontext, anstellungen);
  return alle.find((a) => a.abwesenheit.id === id) ?? null;
}

/** Eine Antragsart, wie das Formular sie anbietet. */
export interface AntragsartWahl {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly erfordertZeitraum: boolean;
  readonly erfordertAbwesenheitsart: boolean;
  readonly erfordertEinsatz: boolean;
  readonly erfordertTauschpartner: boolean;
}

/** Eine Abwesenheitsart. `bezahlt === null` heisst: ungeklaert (O-139). */
export interface AbwesenheitsartWahl {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly zaehltAufUrlaubskonto: boolean;
  readonly bezahlt: boolean | null;
  readonly nachweisPflichtAbTagen: number | null;
}

/**
 * Die Auswahl der Antragsarten — uebersetzt, wo eine Fassung hinterlegt ist.
 *
 * Uebersetzt wird das LABEL, nie der `schluessel`: der reist in die Datenbank
 * (D-83). Ohne hinterlegte Fassung steht die deutsche Bezeichnung da — ein
 * leerer Eintrag waere eine Auswahl, die niemand treffen kann.
 */
export async function leseAntragsarten(
  kontext: LeseKontext, sprache: PortalSprache,
): Promise<readonly AntragsartWahl[]> {
  const roh = await kontext.abfrage<{
    id: string; schluessel: string; bezeichnung: string;
    erfordert_zeitraum: boolean; erfordert_abwesenheitsart: boolean;
    erfordert_einsatz: boolean; erfordert_tauschpartner: boolean;
  }>(
    `select id, schluessel,
            coalesce(nullif(bezeichnung_i18n ->> $1, ''), bezeichnung) as bezeichnung,
            erfordert_zeitraum, erfordert_abwesenheitsart,
            erfordert_einsatz, erfordert_tauschpartner
       from antragsart
      where archiviert_am is null
      order by bezeichnung`,
    [sprache],
  );
  return roh.map((z) => ({
    id: z.id,
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    erfordertZeitraum: z.erfordert_zeitraum,
    erfordertAbwesenheitsart: z.erfordert_abwesenheitsart,
    erfordertEinsatz: z.erfordert_einsatz,
    erfordertTauschpartner: z.erfordert_tauschpartner,
  }));
}

/**
 * Die Auswahl der Abwesenheitsarten.
 *
 * **Eine Art mit ungeklaertem `bezahlt` bleibt in der Liste und wird als
 * ungeklaert gezeigt** (O-139). Sie herauszufiltern waere bequem und falsch:
 * dann fehlte „Krankheit" im Formular, ohne dass jemand erfuehre, warum. Der
 * Dienst weist sie beim Melden ab (`ArtUngeklaertFehler`) — mit einer
 * Meldung, die den Grund nennt.
 */
export async function leseAbwesenheitsarten(
  kontext: LeseKontext, sprache: PortalSprache,
): Promise<readonly AbwesenheitsartWahl[]> {
  const roh = await kontext.abfrage<{
    id: string; schluessel: string; bezeichnung: string;
    zaehlt_auf_urlaubskonto: boolean; bezahlt: boolean | null;
    nachweis_pflicht_ab_tagen: number | null;
  }>(
    `select id, schluessel,
            coalesce(nullif(bezeichnung_i18n ->> $1, ''), bezeichnung) as bezeichnung,
            zaehlt_auf_urlaubskonto, bezahlt, nachweis_pflicht_ab_tagen
       from abwesenheitsart
      where archiviert_am is null
      order by bezeichnung`,
    [sprache],
  );
  return roh.map((z) => ({
    id: z.id,
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    zaehltAufUrlaubskonto: z.zaehlt_auf_urlaubskonto,
    bezahlt: z.bezahlt,
    nachweisPflichtAbTagen:
      z.nachweis_pflicht_ab_tagen === null ? null : Number(z.nachweis_pflicht_ab_tagen),
  }));
}

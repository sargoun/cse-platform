/**
 * Die Aufnahme von der eigenen Schicht — aus einer ANGEMELDETEN Sitzung
 * (TIM-10, DOC-03, DOC-06, LEG-10, AUT-05).
 *
 * **Was `zeit/medien.ts` tut und was hier fehlte.** Der Dienst dort prueft,
 * bereinigt und legt ab: Groesse, Typ aus den Magic Bytes, Metadaten entfernt,
 * privater Bucket, sha256. Die `einsatz_medien`-ZEILE schreibt er nicht — das
 * tat bisher ausschliesslich `app.offline_ereignis_annehmen`, die
 * Definer-Funktion des Check-in-Wegs mit der Marke (K-08). Fuer die
 * angemeldete Kraft gab es keinen Schreibweg (0303 nennt die Messung).
 *
 * **Der Bezug ist der EINSATZ, nicht der Zeiteintrag.** `einsatz` steht im
 * Register `einsatz_medien_bezug` (0041/0082), und eine Schicht hat ihren
 * Einsatz immer — ein Zeiteintrag entsteht erst mit dem Einstempeln. Wer das
 * Foto an den Zeiteintrag haengt, sperrt genau die Aufnahme, die vor einer
 * verschlossenen Tuer gemacht wird.
 *
 * **Diese Datei LIEST nur.** Der Schreibweg — `legeSchichtMediumAb` samt
 * `verzoegerterSpeicher` — steht in `zeit/medien.ts`, beim Fachdienst der
 * Medienerfassung. Das ist keine Formalie: `tests/kern/mitarbeiter.test.ts`
 * haelt fest, dass KEIN Dienst unter `mitarbeiter/` schreibt, und der Grund
 * ist EMP-07/K-18 — die Schreibwege des Menschen liegen in den Fachdiensten,
 * damit keiner an ihnen vorbeifuehrt.
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface SchichtMedium {
  readonly id: string;
  readonly art: string;
  readonly mimeTyp: string;
  readonly beschreibung: string | null;
  /** Serverzeit in Berliner Ortszeit — fertig aus der Datenbank (Invariante 2). */
  readonly erfasstLokal: string;
  /** Die Behauptung des Geraets ueber den Aufnahmezeitpunkt, oder `null`. */
  readonly geraeteZeitLokal: string | null;
  /** Die Binaerdatei wurde nach LEG-09 entfernt; die Zeile blieb als Grabstein. */
  readonly entfernt: boolean;
}

export const SCHICHT_MEDIUM_FELDER = [
  'id', 'art', 'mimeTyp', 'beschreibung', 'erfasstLokal', 'geraeteZeitLokal', 'entfernt',
] as const;

interface RohMedium {
  readonly id: string;
  readonly art: string;
  readonly mime_typ: string;
  readonly beschreibung: string | null;
  readonly erfasst_lokal: string;
  readonly geraete_lokal: string | null;
  readonly entfernt: boolean;
}

/**
 * Die Aufnahmen DIESER Schicht.
 *
 * Gelesen wird im Personen-Scope: `einsatz_medien.t_person` gibt die Zeilen
 * heraus, die dieser Mensch selbst angelegt hat (oder die an seinem eigenen
 * Zeiteintrag haengen). Die Aufnahme einer Kollegin an derselben Schicht steht
 * deshalb NICHT hier — sie gehoert ihrer Dokumentation, nicht dieser.
 *
 * Keine Adresse: eine anzeigbare Adresse ist eine befristet signierte, und die
 * entsteht am Speicher (`signierteMedienAdresse`). Ist er nicht verbunden, gibt
 * es keine — und dann steht auf der Seite, dass es keine gibt, statt eines
 * toten Bildrahmens.
 */
export async function listeSchichtMedien(
  kontext: LeseKontext, einsatzId: string,
): Promise<readonly SchichtMedium[]> {
  return (await listeMedienZu(kontext, 'einsatz', [einsatzId])).get(einsatzId) ?? [];
}

/**
 * Die Fotos an Wachbuchseiten (SEC-05, V-181) — je Seite, fuer eine ganze
 * Liste in EINER Abfrage.
 *
 * Wer was sieht, sagt die Sitzung: die Leitstelle mit `wachbuch.lesen` alle
 * Fotos der Seiten dieser Gesellschaft (`t_wachbuch_medien_lesen`, 0467), die
 * Wache im eigenen Portal ihre eigenen Aufnahmen (`t_person`, 0041). Eine
 * Seite ohne sichtbares Foto fehlt in der Karte — und die Seite sagt dann
 * nichts ueber Fotos, statt „keine" zu behaupten.
 */
export async function listeWachbuchMedien(
  kontext: LeseKontext, eintragIds: readonly string[],
): Promise<ReadonlyMap<string, readonly SchichtMedium[]>> {
  return listeMedienZu(kontext, 'wachbuch_eintrag', eintragIds);
}

/** Beide Lesewege, eine Abfrage — der Bezug ist eine Registerzeile (0041). */
async function listeMedienZu(
  kontext: LeseKontext,
  bezugTabelle: 'einsatz' | 'wachbuch_eintrag',
  bezugIds: readonly string[],
): Promise<ReadonlyMap<string, readonly SchichtMedium[]>> {
  const karte = new Map<string, SchichtMedium[]>();
  if (bezugIds.length === 0) return karte;
  const zeilen = await kontext.abfrage<RohMedium & { readonly bezug_id: string }>(
    `select e.id, e.bezug_id, e.art::text as art, e.mime_typ, e.beschreibung,
            to_char(e.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as erfasst_lokal,
            to_char(e.aufgenommen_am_geraet at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as geraete_lokal,
            (e.storage_geloescht_am is not null) as entfernt
       from einsatz_medien e
      where e.bezug_tabelle = $1 and e.bezug_id = any($2::uuid[])
        and e.archiviert_am is null
      order by e.erstellt_am desc, e.id`,
    [bezugTabelle, bezugIds],
  );
  for (const z of zeilen) {
    const liste = karte.get(z.bezug_id) ?? [];
    liste.push({
      id: z.id,
      art: z.art,
      mimeTyp: z.mime_typ,
      beschreibung: z.beschreibung,
      erfasstLokal: z.erfasst_lokal,
      geraeteZeitLokal: z.geraete_lokal,
      entfernt: z.entfernt,
    });
    karte.set(z.bezug_id, liste);
  }
  return karte;
}

import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die Reklamationen eines Kunden (OPS-11, SPEC §22 `reklamation`,
 * 04-SEITENKARTE §8).
 *
 * **`ursache` und `verantwortlich_benutzer_id` stehen hier nicht.** Das ist
 * dieselbe Auslassung, die `listeReklamationen` intern schon macht, und sie
 * hat einen harten Grund: eine Ursachenanalyse zeigt regelmaessig auf einen
 * Menschen („Kraft war neu, Einweisung fehlte"), und 04-SEITENKARTE §8
 * verschliesst dem Kunden das ganze `personal`-Modul. `massnahme` steht
 * dagegen drin und ist genau das, was der Kunde wissen will: was getan wurde.
 *
 * **`beschreibung` steht drin, weil sie in der Regel vom Kunden selbst
 * stammt** — eine Reklamation, die dem Melder ihren eigenen Text
 * vorenthaelt, waere eine Quittung ohne Inhalt.
 *
 * **Der Verlauf (`reklamation_abstellung`) wird nicht gezeigt.** Er ist der
 * interne Vorgang: wer wann welchen Zustand gesetzt hat, mit den Vermerken
 * dazwischen. Was davon zum Kunden gehoert, ist nicht entschieden, und die
 * konservative Antwort ist der aktuelle Zustand plus die Massnahme.
 *
 * **Kein Melden, kein Nachfassen, kein „erledigt".** `qualitaet.schreiben`
 * ist der Rolle `kunde` im Seed bewusst nicht erteilt, und `withKundeScope`
 * gibt einen `LeseKontext` ohne `schreibe`.
 * // TODO(client, O-74): Darf ein Kunde im Portal eine Reklamation MELDEN und
 * die Erledigung BESTAETIGEN? Beides erzeugt Zeilen in einer
 * Qualitaetsakte, an der Fristen haengen (O-14) — und eine Bestaetigung durch
 * den Kunden ist rechtlich eine Abnahme der Nacharbeit.
 */

export interface Kundenreklamation extends Gesellschaft {
  readonly id: string;
  readonly nummer: string;
  readonly objekt: string | null;
  readonly prioritaet: string;
  readonly status: string;
  readonly eingangAmLokal: string;
  readonly faelligAmLokal: string | null;
  readonly beschreibung: string;
  readonly massnahme: string | null;
  readonly leistungsnachweisId: string | null;
  readonly leistungsnachweisNummer: string | null;
  readonly nacharbeitDatumLokal: string | null;
}

interface ReklamationZeile extends GesellschaftRoh {
  readonly id: string;
  readonly nummer: string;
  readonly objekt: string | null;
  readonly prioritaet: string;
  readonly status: string;
  readonly eingang_lokal: string;
  readonly faellig_lokal: string | null;
  readonly beschreibung: string;
  readonly massnahme: string | null;
  readonly leistungsnachweis_id: string | null;
  readonly ln_nummer: string | null;
  readonly nacharbeit_datum: string | null;
}

/**
 * **`quelle` bleibt weg.** Die Spalte sagt, ob die Beanstandung aus einer
 * Eigenkontrolle, einer Begehung oder vom Kunden kam. Fuer den Kunden ist
 * das entweder trivial (er hat sie gemeldet) oder verwirrend („Eigenkontrolle"
 * an einer Zeile, die er nie gesehen hat) — und die Frage, ob ihm
 * Eigenkontrollen ueberhaupt gezeigt werden sollen, ist keine, die eine
 * Projektion beantwortet. Die Zeilen SIND sichtbar, weil `p_portal_decke`
 * sie durchlaesst; die Herkunftsangabe bleibt weg.
 *
 * **`einsatz` wird fuer das Nacharbeitsdatum gejoint, nicht fuer die
 * Schicht.** `einsatz` traegt `t_kunde`; gelesen wird ausschliesslich
 * `plan_datum` — nicht die Einteilung, nicht die Kraft, nicht die Uhrzeit
 * (04-SEITENKARTE §8: „no schedules").
 */
const SPALTEN = `
  r.id, r.nummer, o.bezeichnung as objekt,
  r.prioritaet::text as prioritaet, r.status::text as status,
  to_char(r.eingang_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as eingang_lokal,
  to_char(r.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as faellig_lokal,
  r.beschreibung, r.massnahme,
  r.leistungsnachweis_id, l.nummer as ln_nummer,
  to_char(e.plan_datum, 'DD.MM.YYYY') as nacharbeit_datum,
  ${GESELLSCHAFT_SPALTEN}`;

const QUELLE = `
  from reklamation r
  join mandant m on m.id = r.mandant_id
  left join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
  left join leistungsnachweis l on l.mandant_id = r.mandant_id
                               and l.id = r.leistungsnachweis_id
  left join einsatz e on e.mandant_id = r.mandant_id and e.id = r.nacharbeit_einsatz_id`;

export async function listeKundenreklamationen(
  kontext: KundenAbfrage, filter: { readonly status?: string | null } = {},
): Promise<readonly Kundenreklamation[]> {
  const zeilen = await kontext.abfrage<ReklamationZeile>(
    `select ${SPALTEN} ${QUELLE}
      where r.archiviert_am is null
        and ($1::text is null or r.status::text = $1)
      order by r.eingang_am desc
      limit ${GRENZE}`,
    [filter.status ?? null],
  );
  return zeilen.map(alsZeile);
}

/**
 * Eine Reklamation im Einzelnen.
 *
 * Eine nicht zum Kunden gehoerende Zeile faellt ueber `t_kunde` /
 * `p_portal_decke` auf null Zeilen und damit auf `notFound()` — byte-gleich
 * mit „gibt es nicht" (AUT-06, SEC-A3).
 */
export async function findeKundenreklamation(
  kontext: KundenAbfrage, id: string,
): Promise<Kundenreklamation | null> {
  const [z] = await kontext.abfrage<ReklamationZeile>(
    `select ${SPALTEN} ${QUELLE}
      where r.id = $1::uuid and r.archiviert_am is null`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

function alsZeile(z: ReklamationZeile): Kundenreklamation {
  return {
    id: z.id,
    nummer: z.nummer,
    objekt: z.objekt,
    prioritaet: z.prioritaet,
    status: z.status,
    eingangAmLokal: z.eingang_lokal,
    faelligAmLokal: z.faellig_lokal,
    beschreibung: z.beschreibung,
    massnahme: z.massnahme,
    leistungsnachweisId: z.leistungsnachweis_id,
    leistungsnachweisNummer: z.ln_nummer,
    nacharbeitDatumLokal: z.nacharbeit_datum,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}

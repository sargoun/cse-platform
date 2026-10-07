import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../../kontext/index.js';
import { tagePlus } from '../../../../lib/datum/kalendertag.js';
import type { Folgeaktion } from './stufen.js';

/**
 * Die Folgeaktion einer Mahnstufe — fällig gesagt, von einem Menschen
 * vermerkt (V-313, O-181, D-787, D-840).
 *
 * `mahn_folgeaktion` (`lieferstopp`, `inkasso`, `mahnbescheid`) steht an der
 * Stufe und wird in den Mahneinstellungen gesetzt. Bis hierher wertete sie
 * niemand aus: kein Blatt sagte am offenen Vorgang, dass nach der Frist der
 * nächste Schritt dran ist, und es gab keinen Ort, an dem jemand festhielt,
 * dass er ihn getan hat.
 *
 * // TODO(client, O-181): Voreinstellung — Inkasso-Übergabe und Mahnbescheid
 * folgen der letzten Stufe ohne Betragsgrenze; frei gibt, wer
 * `mahnung.schreiben` hält; ausgelöst wird beides von einem Menschen, die
 * Plattform übergibt nichts. Fällig ist die Folgeaktion, wenn die Mahnung
 * versendet und ihre Zahlungsfrist (`zahlbar_bis`) verstrichen ist, ohne dass
 * die Sache erledigt wurde. D-787, D-840.
 *
 * **Der Vermerk ist eine Zeile in `mahnung_eskalation`** (0125, archiv: kein
 * Löschen): Aktion, Begründung, wer und wann (Serverzeit). `freigabe_id` und
 * `ausgefuehrt_am` bleiben leer — beide gehören zu einem Schritt, den die
 * PLATTFORM ausführt (Invariante 7, `me_ausfuehrung_freigegeben`), und die
 * Übergabe an ein Inkassobüro oder das Mahngericht tut ein Mensch draussen.
 */

export type { Folgeaktion } from './stufen.js';

export class FolgeaktionFehler extends Error {
  readonly status: number;
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'keine_folgeaktion' | 'nicht_versendet' | 'noch_nicht_faellig'
      | 'ohne_begruendung' | 'schon_vermerkt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'FolgeaktionFehler';
    this.status = grund === 'nicht_gefunden' ? 404 : grund === 'ohne_begruendung' ? 422 : 409;
  }
}

/** Ein Übergabevermerk, wie er gelesen wird. */
export interface Uebergabevermerk {
  readonly aktion: Exclude<Folgeaktion, 'keine'>;
  readonly begruendung: string;
  readonly vermerktVon: string | null;
  /** UTC-Instant (ISO 8601) — angezeigt in Berliner Zeit. */
  readonly vermerktAm: string;
}

/**
 * Wo eine Mahnung gegenüber der Folgeaktion ihrer Stufe steht.
 *
 * - `keine` — die Stufe nennt keine, oder die Mahnung ist (noch) nicht
 *   hinausgegangen bzw. verworfen;
 * - `wartet` — versendet, die Zahlungsfrist läuft noch: fällig ab `abTag`;
 * - `faellig` — die Frist ist verstrichen, nichts vermerkt;
 * - `vermerkt` — ein Mensch hat die Übergabe festgehalten;
 * - `erledigt` — die Sache ist beigelegt; es folgt nichts mehr.
 */
export type FolgeaktionStand =
  | { readonly art: 'keine' }
  | { readonly art: 'wartet'; readonly aktion: Exclude<Folgeaktion, 'keine'>; readonly abTag: string }
  | { readonly art: 'faellig'; readonly aktion: Exclude<Folgeaktion, 'keine'>; readonly seitTag: string }
  | { readonly art: 'vermerkt'; readonly aktion: Exclude<Folgeaktion, 'keine'>;
      readonly vermerk: Uebergabevermerk }
  | { readonly art: 'erledigt' };

/**
 * Die reine Rechnung. `zahlbarBis` und `heute` sind Berliner Kalendertage
 * (`JJJJ-MM-TT`); fällig ist die Folgeaktion am Tag NACH der Zahlungsfrist —
 * der letzte Tag der Frist gehört dem Schuldner.
 */
export function folgeaktionStand(
  mahnung: { readonly status: string; readonly folgeaktion: Folgeaktion; readonly zahlbarBis: string },
  vermerke: readonly Uebergabevermerk[],
  heute: string,
): FolgeaktionStand {
  if (mahnung.folgeaktion === 'keine') return { art: 'keine' };
  const aktion = mahnung.folgeaktion;
  const vermerk = vermerke.find((v) => v.aktion === aktion);
  if (vermerk !== undefined) return { art: 'vermerkt', aktion, vermerk };
  if (mahnung.status === 'erledigt') return { art: 'erledigt' };
  if (mahnung.status !== 'versendet') return { art: 'keine' };
  const ab = tagePlus(mahnung.zahlbarBis, 1);
  return heute >= ab ? { art: 'faellig', aktion, seitTag: ab } : { art: 'wartet', aktion, abTag: ab };
}

interface KopfZeile {
  status: string; folgeaktion: Folgeaktion; zahlbar_bis: string; heute: string;
}

async function ladeKopf(kontext: LeseKontext, mahnungId: string, sperren: boolean)
  : Promise<KopfZeile | null> {
  const [z] = await kontext.abfrage<KopfZeile>(
    `select m.status::text as status, ms.folgeaktion::text as folgeaktion,
            m.zahlbar_bis::text as zahlbar_bis, app.berlin_heute()::text as heute
       from mahnung m
       join mahnstufe ms on ms.mandant_id = m.mandant_id and ms.id = m.mahnstufe_id
      where m.id = $1::uuid and m.mandant_id = app.aktiver_mandant()
      ${sperren ? 'for update of m' : ''}`, [mahnungId]);
  return z ?? null;
}

async function ladeVermerke(kontext: LeseKontext, mahnungId: string)
  : Promise<readonly Uebergabevermerk[]> {
  return kontext.abfrage<Uebergabevermerk>(
    `select e.aktion::text as aktion, e.begruendung, b.name as "vermerktVon",
            to_char(e.freigegeben_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
              as "vermerktAm"
       from mahnung_eskalation e
       left join benutzer b on b.id = e.freigegeben_von
      where e.mahnung_id = $1::uuid and e.mandant_id = app.aktiver_mandant()
        and e.widerrufen_am is null and e.freigegeben_am is not null
      order by e.freigegeben_am`, [mahnungId]);
}

/** Der Stand für das Blatt der Mahnung. `null`: diese Mahnung gibt es hier nicht. */
export async function ladeFolgeaktion(
  kontext: LeseKontext, mahnungId: string,
): Promise<FolgeaktionStand | null> {
  const kopf = await ladeKopf(kontext, mahnungId, false);
  if (kopf === null) return null;
  return folgeaktionStand(
    { status: kopf.status, folgeaktion: kopf.folgeaktion, zahlbarBis: kopf.zahlbar_bis },
    await ladeVermerke(kontext, mahnungId), kopf.heute);
}

/**
 * Hält fest, dass ein Mensch die Folgeaktion der Stufe ausgelöst hat — die
 * Übergabe an das Inkassobüro, den Antrag beim Mahngericht, den Lieferstopp.
 *
 * Nur, wenn sie fällig ist: die Mahnung versendet, die Frist verstrichen,
 * nicht erledigt. Ein zweiter Vermerk derselben Aktion wird abgewiesen
 * (`me_aktion_uk`). Das Recht (`mahnung.schreiben`) prüfen die Route und die
 * Policy auf `mahnung_eskalation` (0125). Eine Protokollzeile nennt Aktion
 * und Begründung.
 */
export async function vermerkeUebergabe(
  kontext: SchreibKontext, mahnungId: string, eingabe: { readonly begruendung: string },
): Promise<{ readonly aktion: Exclude<Folgeaktion, 'keine'> }> {
  const begruendung = eingabe.begruendung.trim();
  if (begruendung.length < 5) {
    throw new FolgeaktionFehler('ohne_begruendung',
      'Der Vermerk nennt, was geschehen ist — etwa „Übergeben an Inkassobüro Muster".');
  }
  const kopf = await ladeKopf(kontext, mahnungId, true);
  if (kopf === null) throw new FolgeaktionFehler('nicht_gefunden', 'Diese Mahnung gibt es nicht.');
  const stand = folgeaktionStand(
    { status: kopf.status, folgeaktion: kopf.folgeaktion, zahlbarBis: kopf.zahlbar_bis },
    await ladeVermerke(kontext, mahnungId), kopf.heute);
  switch (stand.art) {
    case 'keine':
      throw kopf.folgeaktion === 'keine'
        ? new FolgeaktionFehler('keine_folgeaktion', 'Diese Mahnstufe nennt keine Folgeaktion.')
        : new FolgeaktionFehler('nicht_versendet', 'Die Mahnung ist nicht versendet.');
    case 'erledigt':
      throw new FolgeaktionFehler('nicht_versendet', 'Die Sache ist erledigt.');
    case 'wartet':
      throw new FolgeaktionFehler('noch_nicht_faellig',
        `Die Zahlungsfrist läuft noch — fällig ab dem ${stand.abTag}.`);
    case 'vermerkt':
      throw new FolgeaktionFehler('schon_vermerkt', 'Die Folgeaktion ist schon vermerkt.');
    case 'faellig':
      break;
  }
  const aktion = stand.aktion;
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into mahnung_eskalation
       (mandant_id, mahnung_id, aktion, begruendung, freigegeben_von, freigegeben_am,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::mahn_folgeaktion, $3,
             app.aktueller_benutzer(), now(), 'mensch', app.aktueller_benutzer())
     on conflict (mahnung_id, aktion) do nothing
     returning id::text as id`, [mahnungId, aktion, begruendung]);
  if (zeile === undefined) {
    throw new FolgeaktionFehler('schon_vermerkt', 'Die Folgeaktion ist schon vermerkt.');
  }
  await kontext.schreibe(
    `select app.protokolliere('mahnung.folgeaktion_vermerkt', 'mahnung', $1, null, $2::jsonb,
                              app.aktiver_mandant())`,
    [mahnungId, { aktion, begruendung, eskalation: zeile.id }]);
  return { aktion };
}

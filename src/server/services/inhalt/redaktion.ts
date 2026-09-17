import type { LeseKontext, SchreibKontext } from '@/server/kontext';

/**
 * Die Website-Redaktion (§5.21, PUB-07, PRO-02, PRO-05).
 *
 * **Warum ein Dienst und keine Abfragen in den Seiten.** Die Redaktion
 * schreibt in `seite`, `abschnitt`, `medien`, `referenz` und `beitrag` — fünf
 * Tabellen, deren Policies alle dasselbe Recht verlangen (`referenz.lesen`
 * zum Ansehen, `referenz.schreiben` zum Ändern). Verstreut über dreizehn
 * Seiten wäre die vierzehnte die, die eine Bedingung vergisst.
 *
 * **Und was diese Datei NICHT tut: veröffentlichen.** Der Weg vom Entwurf auf
 * die Website führt über den Freigabe-Posteingang (Invariante 7); hier steht
 * der Antrag, nicht die Entscheidung. Ausgenommen sind die redaktionellen
 * Texte einer Seite: sie sind der Auftritt der Gesellschaft über sich selbst
 * und gehen an niemanden hinaus — dort ist `veroeffentlichen` ein eigenes
 * Recht (`referenz.veroeffentlichen`) und keine Freigabe.
 */

export interface SeiteZeile {
  readonly id: string;
  readonly pfad: string;
  readonly sprache: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly status: string;
  readonly veroeffentlichtAm: string | null;
  /** `null` heisst Gruppenseite (Startseite, Impressum) — sonst der Bereich. */
  readonly bereichSlug: string | null;
  readonly abschnitte: number;
}

/**
 * Die Seiten, die diese Sitzung pflegen darf.
 *
 * **Gruppenseiten stehen mit in der Liste** (`mandant_id is null`): Startseite,
 * Impressum und Datenschutz gehören keiner Gesellschaft, werden aber von
 * jemandem gepflegt. Die Policy `t_seite_pflege` lässt sie ausdrücklich zu
 * (`mandant_id is not distinct from app.aktiver_mandant()` trifft `null` nur,
 * wenn auch der aktive Mandant `null` wäre — also nie); deshalb kommen sie
 * hier über die öffentliche Lesepolicy und tragen ein Schild „Gruppe", das
 * sagt, dass sie allen gehören.
 */
export async function listeSeiten(kontext: LeseKontext): Promise<readonly SeiteZeile[]> {
  return kontext.abfrage<SeiteZeile>(
    `select s.id, s.pfad, s.sprache, s.titel, s.beschreibung,
            s.status::text as status,
            s.veroeffentlicht_am as "veroeffentlichtAm",
            m.slug as "bereichSlug",
            (select count(*)::int from abschnitt a
              where a.seite_id = s.id and a.geloescht_am is null) as abschnitte
       from seite s
       left join mandant m on m.id = s.mandant_id
      where s.geloescht_am is null
      order by (m.slug is not null), m.slug nulls first, s.pfad, s.sprache`);
}

export interface AbschnittZeile {
  readonly id: string;
  readonly art: string;
  readonly reihenfolge: number;
  readonly ueberschrift: string | null;
  readonly akzentWort: string | null;
  readonly text: string | null;
}

export interface SeiteMitAbschnitten {
  readonly seite: SeiteZeile;
  readonly abschnitte: readonly AbschnittZeile[];
}

export async function ladeSeiteZurPflege(
  kontext: LeseKontext, id: string,
): Promise<SeiteMitAbschnitten | null> {
  const [s] = await kontext.abfrage<SeiteZeile>(
    `select s.id, s.pfad, s.sprache, s.titel, s.beschreibung,
            s.status::text as status,
            s.veroeffentlicht_am as "veroeffentlichtAm",
            m.slug as "bereichSlug",
            0 as abschnitte
       from seite s
       left join mandant m on m.id = s.mandant_id
      where s.id = $1::uuid and s.geloescht_am is null`,
    [id]);
  if (s === undefined) return null;

  const abschnitte = await kontext.abfrage<AbschnittZeile>(
    `select a.id, a.art::text as art, a.reihenfolge, a.ueberschrift,
            a.akzent_wort as "akzentWort", a.text
       from abschnitt a
      where a.seite_id = $1::uuid and a.geloescht_am is null
      order by a.reihenfolge`,
    [id]);
  return { seite: s, abschnitte };
}

export class RedaktionFehler extends Error {
  constructor(message: string, readonly grund: string) {
    super(message);
    this.name = 'RedaktionFehler';
  }
}

/**
 * Ändert die Texte EINES Abschnitts.
 *
 * **Die Art ändert sich nicht.** Ein `hero` wird nicht zu einer `faq`, weil
 * die Art bestimmt, welche Felder in `daten` gelesen werden und wie die Seite
 * sie rendert — ein Wechsel würde eine Kachel mit Leistungsdaten als Heldenbild
 * ausgeben. Wer eine andere Art braucht, legt einen neuen Abschnitt an.
 *
 * **Null Zeilen sind ein Fehlschlag.** Die Policy weist eine fremde Zeile und
 * eine lesende Sitzung still ab; ein Bildschirm, der danach „gespeichert" sagt,
 * ist die teuerste Art von Rückmeldung — beim nächsten Laden steht der alte
 * Text da, und niemand weiss warum.
 */
export async function aendereAbschnitt(
  kontext: SchreibKontext, id: string,
  felder: { readonly ueberschrift: string | null; readonly akzentWort: string | null;
            readonly text: string | null },
): Promise<void> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update abschnitt
        set ueberschrift = $2, akzent_wort = $3, text = $4
      where id = $1::uuid and geloescht_am is null
      returning id`,
    [id, felder.ueberschrift, felder.akzentWort, felder.text]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Der Abschnitt wurde nicht geändert — er gehört nicht zu dieser Gesellschaft, '
      + 'oder dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

/**
 * Setzt eine Seite auf `veroeffentlicht` oder zurück auf `entwurf`.
 *
 * **`veroeffentlicht_am` reist mit** — `seite_status_stimmig` verlangt, dass
 * die beiden zusammenpassen: veröffentlicht genau dann, wenn ein Zeitpunkt
 * dasteht. Es getrennt zu setzen ginge zweimal schief, einmal je Richtung.
 *
 * **`app.berlin_heute()` ist hier nicht gemeint** — der Zeitpunkt ist ein
 * `timestamptz` und kein Kalendertag (Invariante 2).
 */
export async function setzeSeitenStatus(
  kontext: SchreibKontext, id: string, veroeffentlicht: boolean,
): Promise<void> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update seite
        set status = case when $2 then 'veroeffentlicht'::seite_status
                          else 'entwurf'::seite_status end,
            veroeffentlicht_am = case when $2 then now() else null end
      where id = $1::uuid and geloescht_am is null
      returning id`,
    [id, veroeffentlicht]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Der Status wurde nicht gesetzt — die Seite gehört nicht zu dieser Gesellschaft, '
      + 'oder dieser Sitzung fehlt das Recht.', 'nicht_geaendert');
  }
}

/* ------------------------------------------------------------------- Galerie */

export interface GaleriePflegeZeile {
  readonly id: string;
  readonly pfad: string;
  readonly alt: string;
  readonly platzhalter: boolean;
  /** `null` heisst „nicht in der Galerie". */
  readonly rang: number | null;
}

/**
 * Alle Bilder DIESER Gesellschaft — mit und ohne Rang.
 *
 * Die öffentliche Seite liest nur die mit Rang; die Redaktion muss beide
 * sehen, sonst kann sie kein Bild aufnehmen. `mandant_id` ist hier Pflicht:
 * die Gruppenbilder (`mandant_id is null`) gehören in keine
 * Gesellschaftsgalerie, und `medien_galerie_braucht_mandant` verbietet ihnen
 * ohnehin einen Rang.
 */
export async function listeGalerie(
  kontext: LeseKontext, mandantId: string,
): Promise<readonly GaleriePflegeZeile[]> {
  return kontext.abfrage<GaleriePflegeZeile>(
    `select m.id, m.pfad, m.alt_text as alt,
            m.ist_platzhalter as platzhalter, m.galerie_rang as rang
       from medien m
      where m.mandant_id = $1::uuid
      order by (m.galerie_rang is null), m.galerie_rang, m.erstellt_am`,
    [mandantId]);
}

/**
 * Nimmt ein Bild in die Galerie auf oder heraus.
 *
 * Eine Zahl heisst drin und bestimmt die Reihenfolge, `null` heisst draussen
 * (0170). Das ist bewusst EINE Spalte: Flagge plus Sortierung könnten sich
 * widersprechen, und dann stünde ein Bild „in der Galerie" ohne Platz darin.
 */
export async function setzeGalerieRang(
  kontext: SchreibKontext, medienId: string, rang: number | null,
): Promise<void> {
  if (rang !== null && (!Number.isInteger(rang) || rang < 0)) {
    throw new RedaktionFehler(
      'Der Rang ist eine ganze Zahl ab 0 — oder nichts.', 'rang_ungueltig');
  }
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update medien set galerie_rang = $2::int
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      returning id`,
    [medienId, rang]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Das Bild wurde nicht geändert — es gehört nicht zu dieser Gesellschaft, '
      + 'oder dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

/* ---------------------------------------------------------------- Referenzen */

export interface ReferenzPflegeZeile {
  readonly id: string;
  readonly slug: string;
  readonly titel: string;
  readonly kundeName: string | null;
  readonly jahr: number | null;
  readonly status: string;
  readonly freigegeben: boolean;
  readonly freigabeAm: string | null;
  readonly freigabeBeleg: string | null;
}

export async function listeReferenzen(
  kontext: LeseKontext,
): Promise<readonly ReferenzPflegeZeile[]> {
  return kontext.abfrage<ReferenzPflegeZeile>(
    `select r.id, r.slug, r.titel, r.kunde_name as "kundeName", r.jahr,
            r.status::text as status,
            r.freigegeben_vom_kunden as freigegeben,
            r.freigabe_am as "freigabeAm",
            r.freigabe_beleg as "freigabeBeleg"
       from referenz r
      where r.mandant_id = app.aktiver_mandant() and r.geloescht_am is null
      order by r.sortierung, r.jahr desc nulls last, r.titel`);
}

/**
 * Veröffentlicht eine Referenz — oder nimmt sie zurück.
 *
 * **Ohne Kundenfreigabe geht sie nicht hinaus, und das steht hier UND in der
 * Policy.** Ein Kundenname auf einer Website ohne dessen Zustimmung ist kein
 * Anzeigefehler, sondern ein Problem, das man durch Löschen nicht ungeschehen
 * macht. Die Policy `t_referenz_pflege` verlangt dafür
 * `referenz.kundenfreigabe_erfassen`; diese Prüfung hier sagt dem Menschen
 * ausserdem, WARUM der Knopf nichts tut, statt ihn ins Leere greifen zu lassen.
 */
export async function setzeReferenzStatus(
  kontext: SchreibKontext, id: string, veroeffentlicht: boolean,
): Promise<void> {
  if (veroeffentlicht) {
    const [r] = await kontext.abfrage<{ freigegeben: boolean }>(
      `select freigegeben_vom_kunden as freigegeben from referenz
        where id = $1::uuid and mandant_id = app.aktiver_mandant()
          and geloescht_am is null`,
      [id]);
    if (r === undefined) {
      throw new RedaktionFehler('Diese Referenz gibt es hier nicht.', 'nicht_gefunden');
    }
    if (!r.freigegeben) {
      throw new RedaktionFehler(
        'Diese Referenz trägt keine Kundenfreigabe. Ohne sie darf der Kundenname '
        + 'nicht auf die Website — tragen Sie zuerst die Freigabe mit Datum und '
        + 'Beleg ein.', 'ohne_kundenfreigabe');
    }
  }
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update referenz
        set status = case when $2 then 'veroeffentlicht'::seite_status
                          else 'entwurf'::seite_status end
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [id, veroeffentlicht]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Der Status wurde nicht gesetzt — dieser Sitzung fehlt das Schreibrecht.',
      'nicht_geaendert');
  }
}

import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '@/server/kontext';
import { type LeistungEintrag, leistungenAus } from './jsonld';

/**
 * Die Website-Redaktion (§5.21, PUB-07, PRO-02, PRO-05).
 *
 * **Warum ein Dienst und keine Abfragen in den Seiten.** Die Redaktion
 * schreibt in `seite`, `abschnitt`, `medien`, `referenz` und `beitrag` — fünf
 * Tabellen, deren Policies alle dasselbe Recht verlangen (`referenz.lesen`
 * zum Ansehen, `referenz.schreiben` zum Ändern). Verstreut über dreizehn
 * Seiten wäre die vierzehnte die, die eine Bedingung vergisst.
 *
 * **`geaendert_am` schreibt hier der AUFRUFER — weil es sonst niemand tut.**
 * `seite`, `abschnitt`, `referenz` und `unternehmensprofil` tragen die Spalte,
 * aber — anders als `formular_definition` — KEINEN
 * `kern.setze_geaendert_am`-Auslöser und keinen Audit-Auslöser: nach einer
 * Änderung blieb bisher keinerlei Spur, am wenigsten dort, wo sie zählt (die
 * Kundenfreigabe einer Referenz ist beim Anruf des Kunden genau die Frage).
 * Die Zeile in jedem `update` ist die Notlösung, nicht das Ziel; das Ziel ist
 * ein Eintrag im Register `src/server/db/schema/rls.ts` (`GEAENDERT_AM`,
 * `AUDITIERT`) und der daraus erzeugte Auslöser — dann hängt es nicht mehr am
 * Aufrufer, und der nächste Schreibweg vergisst es nicht.
 *
 * Auf dem `insert` steht sie bewusst nicht: `kern.setze_geaendert_am` ist
 * `BEFORE UPDATE`, und eine frisch angelegte Zeile wurde nicht geändert —
 * dafür ist `erstellt_am` da.
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
  /**
   * Das gepflegte `jsonb` des Abschnitts — Leistungen, FAQ, Zahlen.
   *
   * **Es fehlte hier, und deshalb war die Hälfte der Redaktion unerreichbar.**
   * `aendereAbschnitt` schreibt `ueberschrift`, `akzent_wort` und `text`; die
   * Leistungen einer Gesellschaft stehen dagegen in `daten->'leistungen'` und
   * speisen von dort den `Service`-Block der strukturierten Daten (PUB-11).
   * Ohne dieses Feld kannte keine Pflegeseite die Einträge — sie konnte sie
   * also auch nicht anzeigen, geschweige denn ändern.
   */
  readonly daten: unknown;
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
            a.akzent_wort as "akzentWort", a.text, a.daten
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
        set ueberschrift = $2, akzent_wort = $3, text = $4, geaendert_am = now()
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
            veroeffentlicht_am = case when $2 then now() else null end,
            geaendert_am = now()
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
                          else 'entwurf'::seite_status end,
            geaendert_am = now()
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

/* ------------------------------------------------- Leistungen einer Gesellschaft */

/**
 * **Die Bindung eines Abschnitts an die Gesellschaft, die ihn pflegen darf.**
 *
 * `abschnitt` hat keine `mandant_id` — es hängt nur an `seite_id`. Und heute
 * tragen ALLE 26 `seite`-Zeilen `mandant_id is null`, auch die Bereichsprofile
 * `/unternehmen/<slug>`, obwohl `04-SEITENKARTE.md` §5.21 sagt, dass diese im
 * eigenen Bereich gepflegt werden (O-49). `t_abschnitt_pflege` prüft deshalb
 * nur, DASS die Sitzung `referenz.schreiben` in ihrem aktiven Bereich hält,
 * nicht, WESSEN Seite sie anfasst: ohne diese Bedingung könnte Reinigung die
 * Leistungen von Bau ändern.
 *
 * **Der Slug kommt aus der SITZUNG, nicht aus dem Pfad der Adresse**
 * (`app.aktiver_mandant()` → `mandant.slug`, Invariante 3). Gruppenseiten
 * (`/`, `/impressum`, `/leistungen`) treffen die Bedingung nicht — sie gehören
 * allen und werden über `website/seiten` gepflegt, wo das Schild „Gruppe"
 * daran hängt.
 *
 * **Der PFAD steht in beiden Zweigen, und das ist der Unterschied zu vorher.**
 * Hier hiess der erste Zweig nur `s.mandant_id = app.aktiver_mandant()`: heute
 * folgenlos, weil alle 26 `seite`-Zeilen `mandant_id is null` tragen — aber
 * genau an dem Tag, an dem O-49 beantwortet und `seite.mandant_id` gefüllt
 * wird, hätte `listeProfilseiten` JEDE Seite der Gesellschaft als
 * „Bereichsprofilseite" geführt und auf einem Impressum „Leistungsabschnitt
 * anlegen" angeboten. Der Zweig, der „greift dann von selbst" sollte, hätte
 * beim Greifen etwas anderes getroffen als sein Name sagt. Die Zeile hält
 * jetzt beides auseinander: welche SEITE (der Pfad) und WESSEN (der Mandant,
 * gefüllt oder noch null).
 *
 * // TODO(client, O-49): Gehören die Bereichsprofilseiten
 * // `/unternehmen/<slug>` der jeweiligen Gesellschaft (dann bekommt
 * // `seite.mandant_id` diesen Wert) oder der Gruppe?
 */
const EIGENE_PROFILSEITE = `(
  s.pfad = '/unternehmen/'
           || (select m.slug from mandant m where m.id = app.aktiver_mandant())
  and (s.mandant_id = app.aktiver_mandant() or s.mandant_id is null)
)`;

export interface LeistungsAbschnittZeile {
  readonly id: string;
  readonly seiteId: string;
  readonly pfad: string;
  readonly sprache: string;
  readonly reihenfolge: number;
  readonly ueberschrift: string | null;
  readonly seiteStatus: string;
  readonly daten: unknown;
}

export interface ProfilseiteZeile {
  readonly id: string;
  readonly pfad: string;
  readonly sprache: string;
  readonly titel: string;
  readonly status: string;
  /** Der `leistungen`-Abschnitt dieser Sprachfassung — `null`, wo keiner ist. */
  readonly leistungsAbschnittId: string | null;
  readonly ueberschrift: string | null;
  /**
   * Die Zahl der EINTRÄGE, die die öffentliche Seite wirklich zeigen würde.
   *
   * Gezählt wird über `leistungenAus` und nicht über `jsonb_array_length`: ein
   * Eintrag ohne Namen steht im Feld, fällt aber beim Lesen heraus. Eine „10"
   * über neun sichtbaren Leistungen ist eine Zahl, die niemand nachrechnet.
   */
  readonly eintraege: number;
}

/**
 * Die Bereichsprofilseiten dieser Gesellschaft — je Sprache eine Zeile,
 * **auch die ohne `leistungen`-Abschnitt.**
 *
 * **Warum die Liste an den SEITEN hängt und nicht an den Abschnitten.** CSE
 * Operations hat auf `/unternehmen/operations` gar keinen
 * `leistungen`-Abschnitt (nur `hero` und `text`) — und ist damit der einzige
 * Bereich, dessen öffentliche Leistungsseite heute wirklich leer ist. Über
 * eine Liste von Abschnitten wäre genau dieser Bereich unerreichbar: es gibt
 * keinen, auf den ein Verweis zeigen könnte. Die drei anderen tragen 4 bis 10
 * gepflegte Einträge, in beiden Sprachen.
 *
 * **Eine Zeile je Sprache, kein Spaltenpaar** (D-82): die englische
 * Profilseite ist eine eigene `seite`-Zeile mit `sprache = 'en'`, und ihr
 * `leistungen`-Abschnitt ist ein eigener Abschnitt mit eigenen Einträgen. Wer
 * nur die deutsche pflegt, lässt `/en/unternehmen/<slug>/leistungen`
 * hinterherlaufen — deshalb stehen hier beide untereinander.
 *
 * **Die Leistungen speisen zugleich die strukturierten Daten.** `jsonld.ts`
 * baut den `Service`-Block aus derselben Zeile (PUB-11); es gibt bewusst keine
 * zweite Pflegestelle, weil die den Daten davonliefe.
 */
export async function listeProfilseiten(
  kontext: LeseKontext,
): Promise<readonly ProfilseiteZeile[]> {
  const zeilen = await kontext.abfrage<Omit<ProfilseiteZeile, 'eintraege'> & {
    daten: unknown;
  }>(
    `select s.id, s.pfad, s.sprache, s.titel, s.status::text as status,
            a.id as "leistungsAbschnittId", a.ueberschrift, a.daten
       from seite s
       left join abschnitt a
              on a.seite_id = s.id and a.art = 'leistungen' and a.geloescht_am is null
      where s.geloescht_am is null and ${EIGENE_PROFILSEITE}
      order by (s.sprache <> 'de'), s.sprache`);
  return zeilen.map(({ daten, ...z }) => ({
    ...z, eintraege: leistungenAus(daten).length,
  }));
}

export interface LeistungsAbschnitt extends LeistungsAbschnittZeile {
  readonly eintraege: readonly LeistungEintrag[];
  /**
   * `true`, wenn `daten->'leistungen'` nicht gegen das Schema aufgeht, das
   * `jsonld.ts` liest — dann zeigt die Seite eine Warnung statt „keine
   * Einträge". Ein Eintrag mit leerem Namen fällt dort ohnehin heraus und
   * stünde sonst als unsichtbarer Geist in der Liste.
   */
  readonly datenUnlesbar: boolean;
}

export async function ladeLeistungsAbschnitt(
  kontext: LeseKontext, id: string,
): Promise<LeistungsAbschnitt | null> {
  const [a] = await kontext.abfrage<LeistungsAbschnittZeile>(
    `select a.id, a.seite_id as "seiteId", s.pfad, s.sprache, a.reihenfolge,
            a.ueberschrift, s.status::text as "seiteStatus", a.daten
       from abschnitt a
       join seite s on s.id = a.seite_id
      where a.id = $1::uuid and a.art = 'leistungen' and a.geloescht_am is null
        and s.geloescht_am is null and ${EIGENE_PROFILSEITE}`,
    [id]);
  if (a === undefined) return null;
  const eintraege = leistungenAus(a.daten);
  const roh = (a.daten as { leistungen?: unknown } | null)?.leistungen;
  const rohZahl = Array.isArray(roh) ? roh.length : 0;
  return { ...a, eintraege, datenUnlesbar: rohZahl !== eintraege.length };
}

/**
 * Schreibt die Leistungseinträge EINES Abschnitts.
 *
 * **Geprüft wird gegen den LESER, nicht gegen eine zweite Abschrift.**
 * `jsonld.ts` verwirft einen Eintrag ohne Namen; was diese Funktion schreibt,
 * wird deshalb nach dem Bauen noch einmal durch `leistungenAus` geschickt, und
 * eine Abweichung ist ein Fehler. Sonst landete ein leerer Name als
 * `"name": ""` in den strukturierten Daten — nach Schema gültig, in der Suche
 * wertlos, und niemandem fällt es auf.
 *
 * **`jsonb_set` und kein Überschreiben von `daten`.** Derselbe Abschnitt trägt
 * auf den Bereichsseiten auch `daten->'faq'`; ein `set daten = $2` löschte die
 * FAQ mit — zwei Einträge weniger auf einer Seite, die niemand angefasst hat.
 */
export async function setzeLeistungen(
  kontext: SchreibKontext, id: string, eintraege: readonly LeistungEintrag[],
): Promise<void> {
  const bereinigt: LeistungEintrag[] = eintraege.map((e) => ({
    name: e.name.trim(),
    ...(e.beschreibung === undefined || e.beschreibung.trim() === ''
      ? {} : { beschreibung: e.beschreibung.trim() }),
  }));
  /*
   * **Ein leerer Name wird ABGEWIESEN und nicht weggelassen.** Ein
   * weggelassener Eintrag wäre der teuerste Fall: der Bildschirm sagt
   * „gespeichert", beim nächsten Laden fehlt eine Zeile, und niemand weiss
   * warum. Wer eine Leistung loswerden will, drückt „Entfernen".
   */
  if (bereinigt.some((e) => e.name === '')) {
    throw new RedaktionFehler(
      'Ein Eintrag ohne Namen ist keine Leistung. Zum Entfernen gibt es den Knopf '
      + 'daneben — ein leeres Feld löscht nichts.', 'name_fehlt');
  }
  const namen = new Set(bereinigt.map((e) => e.name));
  if (namen.size !== bereinigt.length) {
    /*
     * Die öffentliche Liste nimmt den Namen als React-Schlüssel
     * (`Abschnitte.tsx`, `_profil/seiten.tsx`). Zwei gleiche Namen sind dort
     * kein Schönheitsfehler, sondern zwei Elemente mit einem Schlüssel — und
     * ein `Service`-Block, der dieselbe Leistung zweimal anbietet.
     */
    throw new RedaktionFehler(
      'Zwei Einträge tragen denselben Namen. Die öffentliche Liste und die '
      + 'strukturierten Daten führen jede Leistung einmal.', 'name_doppelt');
  }
  const geprueft = leistungenAus({ leistungen: bereinigt });
  if (geprueft.length !== bereinigt.length) {
    throw new RedaktionFehler(
      'Ein Eintrag geht nicht durch die Prüfung, mit der die öffentliche Seite ihn '
      + 'liest. Ein Name ist Pflicht.', 'eintraege_ungueltig');
  }

  /*
   * **Das OBJEKT, nicht sein JSON-Text — und deshalb die Hülle `{ liste: … }`.**
   *
   * `JSON.stringify(...)` in einem `::jsonb`-Parameter schreibt eine
   * JSON-ZEICHENKETTE in die Spalte: `jsonb_typeof(daten->'leistungen')` ist
   * dann `string`, `leistungenAus` liest eine leere Liste, und die öffentliche
   * Seite sagt „noch keine Leistungen hinterlegt". Kein Fehler, keine
   * Meldung — die Zeile steht da und sieht vollständig aus (dieselbe Falle wie
   * in `services/arbzg/detektor.ts`). Der Treiber serialisiert selbst.
   *
   * Eine LISTE bekommt die Hülle, weil `postgres.js` ein JS-Array auch als
   * POSTGRES-Array senden kann; ein Objekt ist eindeutig JSON. Ausgepackt wird
   * es im SQL.
   */
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update abschnitt a
        set daten = jsonb_set(coalesce(a.daten, '{}'::jsonb), '{leistungen}',
                              ($2::jsonb)->'liste', true),
            geaendert_am = now()
      where a.id = $1::uuid and a.art = 'leistungen' and a.geloescht_am is null
        and exists (select 1 from seite s
                     where s.id = a.seite_id and s.geloescht_am is null
                       and ${EIGENE_PROFILSEITE})
      returning a.id`,
    [id, { liste: bereinigt }]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Leistungen wurden nicht geändert — der Abschnitt gehört nicht zur Profilseite '
      + 'dieser Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

/**
 * Legt den fehlenden `leistungen`-Abschnitt einer Profilseite an — mit dem
 * ersten Eintrag.
 *
 * **Mit Eintrag und nicht leer.** Ein `leistungen`-Abschnitt ohne Einträge
 * rendert auf `/unternehmen/<slug>` einen leeren Block: eine Überschrift über
 * nichts. Wer die Pflege beginnt, hat einen ersten Eintrag — sonst braucht er
 * den Abschnitt noch nicht.
 *
 * **`reihenfolge` zählt ALLE Abschnitte mit**, auch die gelöschten:
 * `abschnitt_reihenfolge_uk` ist `unique (seite_id, reihenfolge)` ohne
 * Teilbedingung, und ein wiederverwendeter Platz fiele als
 * Eindeutigkeitsverletzung auf — mit einer Meldung aus der Datenbank, die
 * niemandem sagt, was gemeint war.
 */
export async function legeLeistungsAbschnittAn(
  kontext: SchreibKontext, seiteId: string, ersterEintrag: LeistungEintrag,
): Promise<string> {
  const name = ersterEintrag.name.trim();
  if (name === '') {
    throw new RedaktionFehler(
      'Der erste Eintrag braucht einen Namen. Ein Abschnitt ohne Eintrag erscheint auf '
      + 'der öffentlichen Seite als leerer Block.', 'name_fehlt');
  }
  const beschreibung = ersterEintrag.beschreibung?.trim() ?? '';
  const eintrag = { name, ...(beschreibung === '' ? {} : { beschreibung }) };

  // Die Hülle `{ liste: … }` aus demselben Grund wie in `setzeLeistungen`.
  const [a] = await kontext.abfrage<{ id: string }>(
    `insert into abschnitt (seite_id, art, reihenfolge, daten)
     select s.id, 'leistungen',
            coalesce((select max(a2.reihenfolge) from abschnitt a2 where a2.seite_id = s.id), 0) + 1,
            jsonb_build_object('leistungen', ($2::jsonb)->'liste')
       from seite s
      where s.id = $1::uuid and s.geloescht_am is null and ${EIGENE_PROFILSEITE}
        and not exists (select 1 from abschnitt a3
                         where a3.seite_id = s.id and a3.art = 'leistungen'
                           and a3.geloescht_am is null)
     returning id`,
    [seiteId, { liste: [eintrag] }]);
  if (a === undefined) {
    throw new RedaktionFehler(
      'Der Abschnitt wurde nicht angelegt — die Seite gehört nicht zu dieser Gesellschaft, '
      + 'sie hat schon einen Leistungsabschnitt, oder dieser Sitzung fehlt das '
      + 'Schreibrecht.', 'nicht_angelegt');
  }
  return a.id;
}

/* --------------------------------------------------------- Unternehmensprofil */

export interface ProfilZeile {
  readonly id: string;
  readonly sprache: string;
  readonly kurzbeschreibung: string;
  readonly beschreibung: string | null;
  readonly gruendung: number | null;
  readonly mitarbeiterZahl: number | null;
  readonly status: string;
  readonly logoMedienId: string | null;
  readonly coverMedienId: string | null;
}

/**
 * Das Unternehmensprofil dieser Gesellschaft — **eine Zeile je Sprache**.
 *
 * `unternehmensprofil_uk` ist `unique (mandant_id, sprache) where geloescht_am
 * is null`: de und en sind zwei Zeilen, kein Spaltenpaar (D-82). Eine
 * Pflegeseite, die stillschweigend nur die deutsche zeigte, liesse
 * `/en/unternehmen/<slug>` der deutschen Fassung hinterherlaufen — und der
 * öffentliche Leser (`server/inhalt/lesen.ts`) fällt dann auf Deutsch zurück,
 * ohne dass es jemandem auffällt.
 */
export async function listeProfile(kontext: LeseKontext): Promise<readonly ProfilZeile[]> {
  return kontext.abfrage<ProfilZeile>(
    `select p.id, p.sprache, p.kurzbeschreibung, p.beschreibung, p.gruendung,
            p.mitarbeiter_zahl as "mitarbeiterZahl", p.status::text as status,
            p.logo_medien_id as "logoMedienId", p.cover_medien_id as "coverMedienId"
       from unternehmensprofil p
      where p.mandant_id = app.aktiver_mandant() and p.geloescht_am is null
      order by (p.sprache <> 'de'), p.sprache`);
}

export interface ProfilEingabe {
  readonly kurzbeschreibung: string;
  readonly beschreibung: string | null;
  readonly gruendung: number | null;
  readonly mitarbeiterZahl: number | null;
}

/**
 * Ändert die Texte EINER Sprachfassung des Profils.
 *
 * Die Zahlengrenzen stehen als `check` in der Tabelle (`gruendung` zwischen
 * 1900 und 2100, `mitarbeiter_zahl >= 0`). Sie werden hier NOCH EINMAL
 * geprüft, damit der Mensch einen Satz liest und nicht
 * „violates check constraint" — die Datenbank bleibt die Instanz, die es
 * durchsetzt.
 */
export async function aendereProfil(
  kontext: SchreibKontext, id: string, felder: ProfilEingabe,
): Promise<void> {
  const kurz = felder.kurzbeschreibung.trim();
  if (kurz === '') {
    throw new RedaktionFehler(
      'Ohne Kurzbeschreibung steht die Markenkarte dieser Gesellschaft leer da — sie '
      + 'liest sich dann wie „über diese Gesellschaft gibt es nichts zu sagen".',
      'kurzbeschreibung_fehlt');
  }
  if (felder.gruendung !== null
      && (!Number.isInteger(felder.gruendung)
          || felder.gruendung < 1900 || felder.gruendung > 2100)) {
    throw new RedaktionFehler(
      'Das Gründungsjahr liegt zwischen 1900 und 2100 — oder es bleibt leer.',
      'gruendung_ungueltig');
  }
  if (felder.mitarbeiterZahl !== null
      && (!Number.isInteger(felder.mitarbeiterZahl) || felder.mitarbeiterZahl < 0)) {
    throw new RedaktionFehler(
      'Die Mitarbeiterzahl ist eine ganze Zahl ab null — oder sie bleibt leer.',
      'mitarbeiter_ungueltig');
  }

  const zeilen = await kontext.abfrage<{ id: string }>(
    `update unternehmensprofil
        set kurzbeschreibung = $2, beschreibung = $3,
            gruendung = $4::int, mitarbeiter_zahl = $5::int, geaendert_am = now()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [id, kurz, felder.beschreibung, felder.gruendung, felder.mitarbeiterZahl]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Das Profil wurde nicht geändert — es gehört nicht zu dieser Gesellschaft, oder '
      + 'dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

/**
 * Stellt EINE Sprachfassung des Profils öffentlich — oder nimmt sie zurück.
 *
 * **Je Sprache getrennt, und das ist Absicht.** `t_profil_oeffentlich` liest
 * nur `status = 'veroeffentlicht'`; eine neu geschriebene englische Fassung
 * soll erst hinausgehen, wenn jemand sie gelesen hat, ohne die deutsche
 * mitzureissen.
 *
 * `unternehmensprofil` hat kein `veroeffentlicht_am` — anders als `seite`
 * gibt es hier also keinen zweiten Wert, der mitreisen müsste.
 */
export async function setzeProfilStatus(
  kontext: SchreibKontext, id: string, veroeffentlicht: boolean,
): Promise<void> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update unternehmensprofil
        set status = case when $2 then 'veroeffentlicht'::seite_status
                          else 'entwurf'::seite_status end,
            geaendert_am = now()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [id, veroeffentlicht]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Der Status wurde nicht gesetzt — das Profil gehört nicht zu dieser Gesellschaft, '
      + 'oder dieser Sitzung fehlt das Recht.', 'nicht_geaendert');
  }
}

/* ------------------------------------------------------- Referenz bearbeiten */

export interface ReferenzDetail {
  readonly id: string;
  readonly slug: string;
  readonly titel: string;
  readonly kundeName: string | null;
  readonly beschreibung: string | null;
  readonly jahr: number | null;
  readonly medienId: string | null;
  readonly medienPfad: string | null;
  readonly medienAlt: string | null;
  readonly medienPlatzhalter: boolean | null;
  readonly sortierung: number;
  readonly status: string;
  readonly freigegeben: boolean;
  readonly freigabeAm: string | null;
  readonly freigabeBeleg: string | null;
}

export async function ladeReferenzZurPflege(
  kontext: LeseKontext, id: string,
): Promise<ReferenzDetail | null> {
  const [r] = await kontext.abfrage<ReferenzDetail>(
    `select r.id, r.slug, r.titel, r.kunde_name as "kundeName", r.beschreibung, r.jahr,
            r.medien_id as "medienId", m.pfad as "medienPfad", m.alt_text as "medienAlt",
            m.ist_platzhalter as "medienPlatzhalter",
            r.sortierung, r.status::text as status,
            r.freigegeben_vom_kunden as freigegeben,
            r.freigabe_am as "freigabeAm", r.freigabe_beleg as "freigabeBeleg"
       from referenz r
       left join medien m on m.id = r.medien_id
      where r.id = $1::uuid and r.mandant_id = app.aktiver_mandant()
        and r.geloescht_am is null`,
    [id]);
  return r ?? null;
}

/** Die Bilder, aus denen eine Referenz wählen kann — NUR die dieser Gesellschaft. */
export async function bilderZurWahl(
  kontext: LeseKontext,
): Promise<readonly GaleriePflegeZeile[]> {
  /*
   * `t_medien_oeffentlich` liest `medien` mit `using (true)`: RLS grenzt hier
   * GAR NICHTS ein. Ohne `mandant_id = app.aktiver_mandant()` bekäme die
   * Auswahlliste die Bilder der anderen drei Gesellschaften — und ein Bild von
   * einer Security-Baustelle stünde unter einem Reinigungsprojekt. Derselbe
   * Befund steht als Kommentar in `website/galerie/page.tsx`.
   */
  return kontext.abfrage<GaleriePflegeZeile>(
    `select m.id, m.pfad, m.alt_text as alt,
            m.ist_platzhalter as platzhalter, m.galerie_rang as rang
       from medien m
      where m.mandant_id = app.aktiver_mandant()
      order by (m.galerie_rang is null), m.galerie_rang, m.erstellt_am`);
}

export interface ReferenzEingabe {
  readonly titel: string;
  readonly slug: string;
  readonly kundeName: string | null;
  readonly beschreibung: string | null;
  readonly jahr: number | null;
  readonly medienId: string | null;
  readonly sortierung: number;
}

const SLUG_FORM = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

/** `YYYY-MM-DD` — und ein Tag, den es im Kalender wirklich gibt. */
const DATUM_FORM = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Ist `tag` ein echter Kalendertag in `YYYY-MM-DD`?
 *
 * **Warum die Form allein nicht reicht.** `2026-02-30` und `2026-13-01` haben
 * die Form; `Date.UTC` rollt sie stillschweigend auf den 2. März bzw. den
 * Januar 2027 weiter. Ein Datum, das der Kunde nie gegeben hat, wäre beim
 * Anruf genau die falsche Auskunft — deshalb wird zurückgerechnet und
 * verglichen.
 *
 * Gerechnet wird in UTC und nicht in Berlin: hier steht die Frage „gibt es
 * diesen Tag", nicht „wann beginnt er". Die Zeitzone kommt erst im `update`
 * dazu (Invariante 2).
 */
function istKalendertag(tag: string): boolean {
  if (!DATUM_FORM.test(tag)) return false;
  const [j, m, t] = tag.split('-').map((x) => Number.parseInt(x, 10)) as [number, number, number];
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

/**
 * **Der Slug ist je Gesellschaft eindeutig — und das steht hier, nicht nur in
 * der Tabelle.**
 *
 * `referenz_slug_uk` ist `unique (mandant_id, slug)` OHNE Teilbedingung auf
 * `geloescht_am`: eine weich gelöschte Referenz hält ihre Adresse weiter.
 * Ohne diese Prüfung endete eine Kollision als roher `PostgresError` (23505)
 * — und `fuehreWebsiteAus` fängt nur `RedaktionFehler` und
 * Autorisierungsfehler ab, also sah der Mensch einen 500 statt eines Satzes.
 *
 * **Der Weg dahin ist nicht konstruiert.** Lässt der Bediener das Slug-Feld
 * leer, bildet die Route ihn über `app.slug_aus_titel(titel)` — und bei zwei
 * ähnlichen Projekttiteln („Büroreinigung Mitte") ist das genau der Slug, den
 * die erste Referenz schon trägt.
 *
 * Durchnummeriert wird NICHT: `app.slug_fuellen` tut es beim Anlegen auch
 * nicht, und eine Adresse, die sich selbst zu `…-2` macht, ist eine Adresse,
 * die niemand gewählt hat. Stattdessen sagt der Grund, was los ist.
 *
 * `id = null` heisst: die Referenz entsteht gerade (`legeReferenzAn`, V-154)
 * — dann zählt JEDE Zeile mit diesem Slug, denn es gibt noch keine eigene,
 * die sich selbst im Weg stehen könnte.
 */
async function pruefeSlugFrei(
  kontext: LeseKontext, id: string | null, slug: string,
): Promise<void> {
  const [z] = await kontext.abfrage<{ vergeben: boolean; geloescht: boolean }>(
    `select true as vergeben, (r.geloescht_am is not null) as geloescht
       from referenz r
      where r.mandant_id = app.aktiver_mandant() and r.slug = $2
        and ($1::uuid is null or r.id <> $1::uuid)
      limit 1`,
    [id, slug]);
  if (z === undefined) return;
  throw new RedaktionFehler(
    z.geloescht
      ? 'Diese Adresse hält bereits eine gelöschte Referenz dieser Gesellschaft. '
        + 'Gelöscht heisst hier nicht verschwunden (Invariante 8) — der Slug bleibt '
        + 'belegt. Wähle einen anderen.'
      : 'Diese Adresse trägt schon eine andere Referenz dieser Gesellschaft. '
        + 'Zwei Projekte unter einer Adresse gibt es nicht — wähle einen anderen Slug.',
    'slug_vergeben');
}

/**
 * **Das Recht, das `t_referenz_pflege` für JEDEN Schreibvorgang verlangt** —
 * geprüft, BEVOR das `update` läuft.
 *
 * Und das ist kein Übereifer, sondern der Unterschied zwischen einem Satz und
 * einem 500. Eine `with check`-Bedingung WIRFT, sie filtert nicht: die Zeile
 * ist über `using` (dort genügt `referenz.lesen`) sichtbar, das `update` setzt
 * an, und Postgres antwortet
 * „new row violates row-level security policy for table referenz". Die übliche
 * Regel dieses Moduls — null geänderte Zeilen sind ein Fehler mit Grund —
 * greift dort gar nicht, weil es nie zu null Zeilen kommt. Ohne diese Prüfung
 * landete eine `leitung` mit entzogenem Recht auf dem Bildschirm „Da ist etwas
 * schiefgegangen", für eine Handlung, die sie einfach nicht darf.
 *
 * Die Mengen sind heute verschieden: `referenz.schreiben` halten `admin` und
 * `super_admin`, `referenz.kundenfreigabe_erfassen` zusätzlich `leitung` — und
 * ein Mandanten-Override kann beides einzeln entziehen.
 */
async function pruefeFreigaberecht(kontext: LeseKontext): Promise<void> {
  const [r] = await kontext.abfrage<{ ja: boolean }>(
    `select app.hat_recht('referenz.kundenfreigabe_erfassen',
                          app.aktiver_mandant()) as ja`);
  if (r?.ja !== true) {
    throw new RedaktionFehler(
      'Jede Änderung an einer Referenz verlangt das Recht, Kundenfreigaben zu erfassen '
      + '(referenz.kundenfreigabe_erfassen) — so steht es in der Policy '
      + 't_referenz_pflege, und zwar für jeden Schreibvorgang auf dieser Tabelle. '
      + 'An der Referenz hat sich nichts geändert.', 'kein_freigaberecht');
  }
}

/**
 * Titel, Slug und Jahr — die drei Felder, die Anlegen UND Ändern prüfen.
 *
 * Sie standen nur in `aendereReferenz`. Mit `legeReferenzAn` (V-154) gibt es
 * einen zweiten Schreibweg, und zwei abgeschriebene Prüfungen laufen beim
 * ersten neuen Grund auseinander: dann nimmt das Anlegen einen Slug an, den
 * das Ändern danach abweist, und die Referenz lässt sich nicht mehr speichern.
 * Die Tabelle hält dieselben Grenzen (`referenz_slug_form`, `jahr between
 * 1990 and 2100`); hier stehen sie, damit ein Mensch einen Satz liest und
 * keinen 500.
 */
function pruefeKopffelder(titel: string, slug: string, jahr: number | null): void {
  if (titel === '') {
    throw new RedaktionFehler('Eine Referenz ohne Titel hat keine Überschrift.', 'titel_fehlt');
  }
  if (!SLUG_FORM.test(slug)) {
    throw new RedaktionFehler(
      'Der Slug besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — '
      + 'er ist Teil der öffentlichen Adresse.', 'slug_form');
  }
  if (jahr !== null && (!Number.isInteger(jahr) || jahr < 1990 || jahr > 2100)) {
    throw new RedaktionFehler(
      'Das Jahr liegt zwischen 1990 und 2100 — oder es bleibt leer.', 'jahr_ungueltig');
  }
}

/**
 * Ändert die Felder einer Referenz — **ohne** die Kundenfreigabe.
 *
 * Die Freigabe hat ihre eigene Funktion (`erfasseKundenfreigabe`) und ihren
 * eigenen Block auf dem Bildschirm. Zusammen in einem Formular wäre sie ein
 * Häkchen zwischen Titel und Jahr — und die Zustimmung des Kunden ist keine
 * Formatierungsfrage, sondern die Bedingung, unter der sein Name überhaupt
 * öffentlich werden darf.
 *
 * **Der Slug ist eine Adresse.** `/unternehmen/<bereich>/projekte/<slug>` ist
 * die kanonische Adresse dieses Projekts; wer den Slug ändert, bricht jeden
 * eingehenden Verweis und jeden Eintrag im Index einer Suchmaschine. Die
 * Prüfung steht hier UND als `referenz_slug_form` in der Tabelle — der
 * Unterschied ist der Satz, den ein Mensch dann liest. Dasselbe gilt für die
 * EINDEUTIGKEIT (`pruefeSlugFrei`): `referenz_slug_uk` weist eine Kollision
 * ohnehin ab, aber als 23505 und damit als 500.
 */
export async function aendereReferenz(
  kontext: SchreibKontext, id: string, felder: ReferenzEingabe,
): Promise<void> {
  await pruefeFreigaberecht(kontext);
  const titel = felder.titel.trim();
  const slug = felder.slug.trim().toLowerCase();
  pruefeKopffelder(titel, slug, felder.jahr);
  if (!Number.isInteger(felder.sortierung) || felder.sortierung < 0) {
    throw new RedaktionFehler(
      'Die Sortierung ist eine ganze Zahl ab null.', 'sortierung_ungueltig');
  }
  if (felder.medienId !== null) {
    /*
     * `referenz_medien_id_fkey` zeigt auf `medien(id)` ohne Mandanten, und
     * `t_medien_oeffentlich` liest jede Zeile. Ein präparierter POST könnte
     * sonst das Bild einer anderen Gesellschaft unter dieses Projekt setzen.
     */
    const [m] = await kontext.abfrage<{ ja: boolean }>(
      `select exists (select 1 from medien m
                       where m.id = $1::uuid and m.mandant_id = app.aktiver_mandant()) as ja`,
      [felder.medienId]);
    if (m?.ja !== true) {
      throw new RedaktionFehler(
        'Dieses Bild gehört nicht zu dieser Gesellschaft.', 'bild_fremd');
    }
  }

  await pruefeSlugFrei(kontext, id, slug);

  const zeilen = await kontext.abfrage<{ id: string }>(
    `update referenz
        set titel = $2, slug = $3, kunde_name = $4, beschreibung = $5,
            jahr = $6::int, medien_id = $7::uuid, sortierung = $8::int,
            geaendert_am = now()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [id, titel, slug, felder.kundeName, felder.beschreibung, felder.jahr,
     felder.medienId, felder.sortierung]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Referenz wurde nicht geändert — sie gehört nicht zu dieser Gesellschaft, oder '
      + 'dieser Sitzung fehlt das Recht, Kundenfreigaben zu erfassen '
      + '(referenz.kundenfreigabe_erfassen — das verlangt t_referenz_pflege für JEDEN '
      + 'Schreibvorgang auf dieser Tabelle).', 'nicht_geaendert');
  }
}

/** Was ein Mensch beim Anlegen einer Referenz angibt — mehr nicht. */
export interface NeueReferenz {
  readonly titel: string;
  /** `null` oder leer: aus dem Titel, mit derselben Funktion wie `trg_referenz_slug`. */
  readonly slug: string | null;
  readonly kundeName: string | null;
  readonly beschreibung: string | null;
  readonly jahr: number | null;
}

export interface AngelegteReferenz {
  readonly id: string;
  readonly slug: string;
  /**
   * Der Slug der Gesellschaft, in der sie entstand — aus der SITZUNG
   * (`app.aktiver_mandant()`), nicht aus einer Adresse (Invariante 3). Die
   * Route braucht ihn für den Weg auf das Blatt der neuen Zeile.
   */
  readonly bereich: string;
}

/**
 * Legt eine Referenz an — als ENTWURF und OHNE Kundenfreigabe (PRO-05, V-154).
 *
 * **Der Befund.** Die Kundenfreigabe am Auftrag sagte „die öffentliche
 * Referenz legt danach ein Mensch unter `/website/referenzen` an", und dort
 * gab es nur Bearbeiten, Freigabe erfassen und Veröffentlichen einer
 * BESTEHENDEN Zeile. Kein Dienst und keine Route schrieb ein `insert into
 * referenz`; eine echte Gesellschaft brachte kein einziges Projekt auf ihr
 * Profil, auf `/projekte` oder in die Sitemap — nur der Seed hatte welche.
 *
 * **Was sie NICHT tut, ist der Punkt.** Sie setzt weder
 * `freigegeben_vom_kunden` noch `status = 'veroeffentlicht'`: beides bleibt auf
 * dem Wert, den 0015 bewusst ohne `default true` gewählt hat. Eine frisch
 * angelegte Referenz ist damit unsichtbar (`t_referenz_oeffentlich`), bis ein
 * Mensch die Zustimmung des Kunden mit Datum und Beleg einträgt
 * (`erfasseKundenfreigabe`) und ein anderer Mensch mit eigenem Recht
 * veröffentlicht (`setzeReferenzStatus`). Drei Handlungen, drei Stellen — eine
 * Anlage, die die Freigabe gleich mitbrächte, wäre ein Kundenname auf der
 * Website, über den niemand einzeln entschieden hat.
 *
 * **Das Recht ist dasselbe wie beim Ändern.** `t_referenz_pflege` verlangt in
 * ihrer `with check` für JEDEN Schreibvorgang
 * `referenz.kundenfreigabe_erfassen` — auch für das `insert`. Ohne die
 * Vorprüfung käme 42501 als 500 zurück.
 *
 * **Die Kennung entsteht hier und nicht über `returning`.** `insert …
 * returning` verlangt, dass die neue Zeile auch die LESE-Policy besteht
 * (`referenz.lesen`); eine Rolle, der ein Override das Lesen entzieht und das
 * Freigaberecht lässt, legte sonst an und bekäme trotzdem einen Fehler — die
 * Zeile stünde da, der Mensch hielte sie für nicht angelegt und legte sie ein
 * zweites Mal an. Dieselbe Bauart wie `lead/annahme.ts`.
 *
 * **Der Slug wird geprüft, BEVOR geschrieben wird** (`pruefeSlugFrei`):
 * `referenz_slug_uk` weist eine Kollision ohnehin ab, aber als 23505 — und
 * zwei Referenzen „Büroreinigung Mitte" sind kein konstruierter Fall.
 */
export async function legeReferenzAn(
  kontext: SchreibKontext, felder: NeueReferenz,
): Promise<AngelegteReferenz> {
  await pruefeFreigaberecht(kontext);
  const titel = felder.titel.trim();
  const roh = (felder.slug ?? '').trim().toLowerCase();
  const slug = roh === '' ? await slugVorschlag(kontext, titel) : roh;
  pruefeKopffelder(titel, slug, felder.jahr);
  await pruefeSlugFrei(kontext, null, slug);

  const id = randomUUID();
  await kontext.schreibe(
    `insert into referenz (id, mandant_id, titel, slug, kunde_name, beschreibung, jahr,
                           freigegeben_vom_kunden, status)
     values ($1::uuid, app.aktiver_mandant(), $2, $3, $4, $5, $6::int,
             false, 'entwurf'::seite_status)`,
    [id, titel, slug, leerZuNull(felder.kundeName), leerZuNull(felder.beschreibung),
     felder.jahr]);

  const [m] = await kontext.abfrage<{ slug: string }>(
    `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
  if (m === undefined) {
    // Ohne aktiven Mandanten gäbe es keinen SchreibKontext; das hier ist die
    // zweite Linie, nicht ein erwarteter Fall.
    throw new RedaktionFehler(
      'Die Gesellschaft dieser Sitzung ist nicht lesbar.', 'nicht_angelegt');
  }
  return { id, slug, bereich: m.slug };
}

/** Leer bleibt leer — ein leeres `<p>` auf der öffentlichen Seite ist eine Lücke. */
function leerZuNull(wert: string | null): string | null {
  const t = (wert ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Trägt die Kundenfreigabe ein — oder nimmt sie zurück.
 *
 * **Ohne Datum geht sie nicht in die Tabelle.** `referenz_freigabe_belegt` ist
 * `check (not freigegeben_vom_kunden or freigabe_am is not null)`: eine
 * Freigabe ohne Zeitpunkt wäre eine Behauptung ohne Beleg, und beim Anruf des
 * Kunden ist genau das Datum die Frage. Die Prüfung steht deshalb auch hier —
 * damit der Mensch den Satz liest, bevor der Speicherversuch scheitert.
 *
 * **Zurücknehmen räumt Datum und Beleg mit ab.** Ein stehengebliebenes Datum
 * neben „keine Freigabe" liest sich beim nächsten Öffnen wie eine Freigabe,
 * die jemand versehentlich abgehakt hat.
 */
export async function erfasseKundenfreigabe(
  kontext: SchreibKontext, id: string,
  felder: { readonly freigegeben: boolean; readonly am: string | null;
            readonly beleg: string | null },
): Promise<void> {
  await pruefeFreigaberecht(kontext);
  const beleg = felder.beleg?.trim() ?? '';
  if (felder.freigegeben && (felder.am === null || felder.am === '')) {
    throw new RedaktionFehler(
      'Eine Kundenfreigabe braucht ein Datum. Ohne Datum lässt die Datenbank sie nicht '
      + 'zu — und beim Anruf des Kunden ist das Datum die Frage.', 'freigabe_ohne_datum');
  }
  /*
   * **Dass ein Datum da ist, heisst nicht, dass es eines IST.**
   *
   * Der Parameter steht im SQL als `$3::date`; der Treiber serialisiert ihn
   * dann als Datum (`new Date(wert).toISOString()`). Ein nicht parsbarer Wert
   * wirft schon dort — als `RangeError: Invalid time value`, also weder
   * `RedaktionFehler` noch `PostgresError`. `fuehreWebsiteAus` reicht ihn
   * durch, und der Bediener bekommt einen 500 statt eines Satzes.
   *
   * Der Weg ist realistisch: das Feld ist ein `<input type="date">`, und ein
   * Browser, der den Typ nicht umsetzt, schickt freien Text („29.03.2026");
   * ein handgebauter POST erst recht.
   */
  if (felder.freigegeben && !istKalendertag(felder.am as string)) {
    throw new RedaktionFehler(
      'Das Freigabedatum steht als Jahr-Monat-Tag, etwa 2026-03-29 — und muss ein Tag '
      + 'sein, den es gibt.', 'freigabe_datum_form');
  }
  if (felder.freigegeben && beleg === '') {
    throw new RedaktionFehler(
      'Woraus geht die Zustimmung hervor? E-Mail, Vertragsklausel, unterschriebenes '
      + 'Blatt — ein Satz genügt, aber er muss dastehen.', 'freigabe_ohne_beleg');
  }

  const zeilen = await kontext.abfrage<{ id: string }>(
    `update referenz
        set freigegeben_vom_kunden = $2,
            freigabe_am = case when $2 then ($3::date)::timestamp
                                             at time zone 'Europe/Berlin'
                               else null end,
            freigabe_beleg = case when $2 then $4 else null end,
            geaendert_am = now()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null
      returning id`,
    [id, felder.freigegeben, felder.am, beleg === '' ? null : beleg]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Freigabe wurde nicht gespeichert — dieser Sitzung fehlt das Recht '
      + 'referenz.kundenfreigabe_erfassen.', 'nicht_geaendert');
  }
}

/** Ein Slug-Vorschlag aus dem Titel — dieselbe Funktion, die der Auslöser nimmt. */
export async function slugVorschlag(kontext: LeseKontext, titel: string): Promise<string> {
  const [z] = await kontext.abfrage<{ slug: string }>(
    `select app.slug_aus_titel($1) as slug`, [titel]);
  return z?.slug ?? '';
}

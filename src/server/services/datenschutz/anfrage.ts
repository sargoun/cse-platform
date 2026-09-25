/**
 * Die Betroffenenanfrage (LEG-09, Art. 12 ff. DSGVO).
 *
 * **Die Kette:** ein Mensch füllt ein öffentliches Formular aus → eine Zeile
 * entsteht über den Eingangsprinzipal → sie landet im internen Posteingang mit
 * einer laufenden Monatsfrist → ein Mensch entscheidet und antwortet.
 *
 * **Warum das Formular so wenig fragt.** Der naheliegende Weg wäre, nach
 * Geburtsdatum, Anschrift und Kundennummer zu fragen — „zur Identitätsprüfung".
 * Das kehrt den Zweck um: ein Auskunftsersuchen ist der Moment, in dem jemand
 * WENIGER von sich preisgeben will, und Art. 12 Abs. 6 erlaubt die Nachfrage
 * nur bei *begründeten Zweifeln*. Also hinterher, im Einzelfall, von einem
 * Menschen — nicht im Formular, von allen.
 *
 * **Und warum sie an EINE Gesellschaft geht.** Die vier sind verschiedene
 * juristische Personen, und jede ist für ihre Verarbeitung selbst
 * verantwortlich. Eine Anfrage „an die Gruppe" gäbe es rechtlich nicht — die
 * Auswahl steht deshalb im Formular, und wer sich irrt, wird von einem
 * Menschen weitergeleitet.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { editorPfad } from './berichtigung.js';

export type AnfrageArt =
  'auskunft' | 'berichtigung' | 'loeschung' | 'einschraenkung'
  | 'uebertragbarkeit' | 'widerspruch';

export type AnfrageStatus =
  'neu' | 'identitaet_offen' | 'in_bearbeitung' | 'beantwortet' | 'abgelehnt';

export const ANFRAGE_ARTEN: readonly AnfrageArt[] = [
  'auskunft', 'berichtigung', 'loeschung', 'einschraenkung',
  'uebertragbarkeit', 'widerspruch',
];

/** Was die Art bedeutet — in der Sprache eines Menschen, mit dem Artikel. */
export const ART_TEXT: Readonly<Record<AnfrageArt, { kurz: string; lang: string }>> = {
  auskunft: {
    kurz: 'Auskunft (Art. 15)',
    lang: 'Ich möchte wissen, welche Daten Sie über mich gespeichert haben.',
  },
  berichtigung: {
    kurz: 'Berichtigung (Art. 16)',
    lang: 'Etwas, das Sie über mich gespeichert haben, ist falsch.',
  },
  loeschung: {
    kurz: 'Löschung (Art. 17)',
    lang: 'Ich möchte, dass Sie meine Daten löschen.',
  },
  einschraenkung: {
    kurz: 'Einschränkung (Art. 18)',
    lang: 'Ich möchte, dass Sie meine Daten vorerst nicht weiter verwenden.',
  },
  uebertragbarkeit: {
    kurz: 'Datenübertragbarkeit (Art. 20)',
    lang: 'Ich möchte meine Daten in einem gängigen Format bekommen.',
  },
  widerspruch: {
    kurz: 'Widerspruch (Art. 21)',
    lang: 'Ich widerspreche der Verarbeitung meiner Daten.',
  },
};

export const ART_TEXT_EN: Readonly<Record<AnfrageArt, { kurz: string; lang: string }>> = {
  auskunft: { kurz: 'Access (Art. 15)', lang: 'I want to know what data you hold about me.' },
  berichtigung: {
    kurz: 'Rectification (Art. 16)', lang: 'Something you hold about me is wrong.',
  },
  loeschung: { kurz: 'Erasure (Art. 17)', lang: 'I want you to delete my data.' },
  einschraenkung: {
    kurz: 'Restriction (Art. 18)', lang: 'I want you to stop using my data for now.',
  },
  uebertragbarkeit: {
    kurz: 'Portability (Art. 20)', lang: 'I want my data in a common format.',
  },
  widerspruch: {
    kurz: 'Objection (Art. 21)', lang: 'I object to the processing of my data.',
  },
};

export class AnfrageFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'AnfrageFehler';
  }
}

export interface NeueAnfrage {
  readonly art: AnfrageArt;
  readonly name: string;
  readonly email: string;
  readonly nachricht?: string | undefined;
  readonly rolleAngabe?: string | undefined;
}

/**
 * Eine Anfrage annehmen — über den Eingangsprinzipal, der nicht lesen kann.
 *
 * **Er bekommt die Kennung zurück und die Oberfläche zeigt sie NICHT.** Eine
 * Vorgangsnummer auf der Dankseite wäre praktisch; sie wäre auch ein Schlüssel,
 * mit dem sich der Stand einer fremden Anfrage abfragen liesse, sobald jemand
 * dafür eine Adresse baut. Die Bestätigung nennt deshalb die Frist und die
 * E-Mail-Adresse, an die geantwortet wird — beides weiss der Anfragende
 * ohnehin.
 */
export async function nimmAn(
  kontext: SchreibKontext, eingabe: NeueAnfrage,
): Promise<{ readonly id: string; readonly fristAm: Date }> {
  const name = eingabe.name.trim();
  const email = eingabe.email.trim().toLowerCase();

  if (name === '') {
    throw new AnfrageFehler('Bitte nennen Sie Ihren Namen.', 'name_fehlt');
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/iu.test(email)) {
    throw new AnfrageFehler(
      'Bitte prüfen Sie die E-Mail-Adresse — an sie geht die Antwort.', 'email_ungueltig');
  }
  if (!ANFRAGE_ARTEN.includes(eingabe.art)) {
    throw new AnfrageFehler('Bitte wählen Sie ein Anliegen.', 'art_fehlt');
  }

  const zeilen = await kontext.schreibe<{ id: string; frist_am: Date }>(
    `insert into betroffenenanfrage
       (mandant_id, art, name, email, nachricht, rolle_angabe)
     values (app.aktiver_mandant(), $1::betroffenenanfrage_art, $2, $3, $4, $5)
     returning id, frist_am`,
    [eingabe.art, name, email,
      eingabe.nachricht?.trim() === undefined || eingabe.nachricht.trim() === ''
        ? null : eingabe.nachricht.trim(),
      eingabe.rolleAngabe?.trim() === undefined || eingabe.rolleAngabe.trim() === ''
        ? null : eingabe.rolleAngabe.trim()],
  );

  const z = zeilen[0];
  if (z === undefined) {
    throw new AnfrageFehler(
      'Die Anfrage konnte nicht gespeichert werden.', 'nicht_gespeichert', 500);
  }
  return { id: z.id, fristAm: z.frist_am };
}

export interface AnfrageZeile {
  readonly id: string;
  readonly art: AnfrageArt;
  readonly status: AnfrageStatus;
  readonly name: string;
  readonly email: string;
  readonly nachricht: string | null;
  readonly rolleAngabe: string | null;
  readonly eingegangenAm: Date;
  readonly fristAm: Date;
  readonly verlaengertBis: Date | null;
  readonly verlaengertGrund: string | null;
  /**
   * Die Rückfrage nach der Identität (V-088, Art. 12 Abs. 6).
   *
   * Sie bleibt stehen, auch wenn die Identität später geklärt ist: sie ist
   * der Beleg dafür, dass nachgefragt wurde, und verschwindet nicht mit der
   * Antwort.
   */
  readonly identitaetAngefordertAm: Date | null;
  readonly identitaetGrund: string | null;
  readonly beantwortetAm: Date | null;
  readonly entscheidung: string | null;
  /** Tage bis zur wirksamen Frist — negativ heisst überfällig. */
  readonly tageBisFrist: number;
  /**
   * Auf welchem Weg der Antrag einkam (Art. 12 Abs. 1) und wer ihn aufnahm.
   *
   * Beim Formular ist `erfasstVon` leer, denn dort war es niemand. Steht dort
   * ein Name, hat ein Mensch eine mündliche oder schriftliche Anfrage
   * protokolliert — und das ist im Streitfall der Beleg dafür, dass die Frist
   * an dem Tag zu laufen begann, der oben steht.
   */
  readonly eingangsweg: Eingangsweg;
  readonly erfasstVon: string | null;
}

const FELDER = `id, art::text as art, status::text as status, name, email, nachricht,
                rolle_angabe as "rolleAngabe", eingegangen_am as "eingegangenAm",
                frist_am as "fristAm", verlaengert_bis as "verlaengertBis",
                verlaengert_grund as "verlaengertGrund",
                identitaet_angefordert_am as "identitaetAngefordertAm",
                identitaet_grund as "identitaetGrund",
                beantwortet_am as "beantwortetAm", entscheidung,
                eingangsweg::text as eingangsweg,
                (select b.name from benutzer b
                  where b.id = betroffenenanfrage.erfasst_von) as "erfasstVon",
                /*
                 * Die Tage rechnet die DATENBANK, gegen ihre eigene Uhr
                 * (Invariante 5) — und gegen die WIRKSAME Frist, also die
                 * verlaengerte, wo es eine gibt.
                 */
                (extract(day from
                   (coalesce(verlaengert_bis, frist_am) - now()))::int) as "tageBisFrist"`;

/** Der Posteingang: was offen ist, nach Frist. Beantwortetes unten. */
export async function liste(kontext: LeseKontext): Promise<readonly AnfrageZeile[]> {
  return kontext.abfrage<AnfrageZeile>(
    `select ${FELDER}
       from betroffenenanfrage
      where mandant_id = app.aktiver_mandant()
      order by (status in ('beantwortet', 'abgelehnt')),
               coalesce(verlaengert_bis, frist_am)`);
}

export async function lade(
  kontext: LeseKontext, id: string,
): Promise<AnfrageZeile | null> {
  const [z] = await kontext.abfrage<AnfrageZeile>(
    `select ${FELDER}
       from betroffenenanfrage
      where mandant_id = app.aktiver_mandant() and id = $1::uuid`, [id]);
  return z ?? null;
}

/**
 * Entscheiden — mit benanntem Menschen und mit Begründung.
 *
 * Beides verlangt schon der CHECK in der Tabelle; hier steht es noch einmal,
 * damit die Oberfläche einen Satz in Worten bekommt statt einer
 * Constraint-Verletzung. Eine Auskunft, von der niemand sagen kann, wer sie
 * erteilt hat, ist im Streitfall keine.
 */
export async function entscheide(
  kontext: SchreibKontext, id: string,
  ergebnis: 'beantwortet' | 'abgelehnt', entscheidung: string,
): Promise<void> {
  if (entscheidung.trim() === '') {
    throw new AnfrageFehler(
      'Zu einer Entscheidung gehört, was entschieden wurde — und warum. Sie ist '
      + 'das, was eine Aufsichtsbehörde liest.', 'ohne_begruendung');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update betroffenenanfrage
        set status = $2::betroffenenanfrage_status, entscheidung = $3,
            beantwortet_am = now(), beantwortet_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and status not in ('beantwortet', 'abgelehnt')
      returning id`,
    [id, ergebnis, entscheidung.trim()]);
  if (zeilen[0] === undefined) {
    throw new AnfrageFehler(
      'Diese Anfrage gibt es nicht — oder sie ist bereits entschieden.',
      'nicht_gefunden', 404);
  }
}

/**
 * **Zusätzliche Angaben zur Identität anfordern** (V-088, Art. 12 Abs. 6).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `identitaet_offen` steht seit `0176` im Aufzählungstyp, der Fristindex
 * zählt ihn zu den offenen Zuständen, zwei Oberflächen beschriften ihn — und
 * **kein Weg setzte ihn**. Wer an der Identität zweifelte, hatte die Wahl
 * zwischen „in Bearbeitung" (was nicht stimmt) und „abgelehnt" (was zu früh
 * wäre).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ohne Grund geschieht nichts — und das ist nicht Förmlichkeit.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Art. 12 Abs. 6 erlaubt die Nachfrage NUR „bei begründeten Zweifeln an der
 * Identität". Wer nachfragt, verarbeitet dafür weitere Daten — eine
 * Ausweiskopie ist mehr, als das Auskunftsersuchen selbst enthält — und muss
 * belegen können, worauf sich die Zweifel stützten. `0388` hält beides
 * zusammen, in derselben Form wie bei der Fristverlängerung.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die FRIST läuft weiter** (O-903).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Art. 12 Abs. 3 lässt den Monat mit dem EINGANG laufen; ob eine Rückfrage
 * nach Absatz 6 ihn hemmt, sagt die Verordnung nicht, und die Ansichten gehen
 * auseinander. Sie hier still anzuhalten wäre eine Rechtsauffassung, die sich
 * als Spaltenwert tarnt. Die Anfrage bleibt also in der Fälligkeitsliste —
 * sichtbar, und damit im Blick.
 */
export async function fordereIdentitaetsnachweis(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim() === '') {
    throw new AnfrageFehler(
      'Art. 12 Abs. 6 erlaubt die Nachfrage nur bei BEGRÜNDETEN Zweifeln. Worauf '
      + 'stützen sie sich? Der Satz steht später allein da, wenn eine Aufsicht '
      + 'fragt, warum eine Ausweiskopie verlangt wurde.', 'ohne_begruendung');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update betroffenenanfrage
        set status = 'identitaet_offen',
            identitaet_angefordert_am = now(),
            identitaet_grund = $2
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and status in ('neu', 'in_bearbeitung')
      returning id`,
    [id, grund.trim()]);
  if (zeilen[0] === undefined) {
    throw new AnfrageFehler(
      'Diese Anfrage gibt es nicht — oder sie ist bereits entschieden, und dann '
      + 'wird nicht mehr nach der Identität gefragt.',
      'nicht_gefunden', 404);
  }
}

/**
 * **Die Identität ist geklärt** (V-088).
 *
 * Der Vermerk BLEIBT stehen: er ist der Beleg dafür, dass nachgefragt wurde,
 * und verschwindet nicht mit der Antwort. Nur der Zustand geht zurück auf
 * „in Bearbeitung" — die Anfrage ist wieder eine gewöhnliche.
 */
export async function identitaetGeklaert(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update betroffenenanfrage
        set status = 'in_bearbeitung'
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and status = 'identitaet_offen'
      returning id`, [id]);
  if (zeilen[0] === undefined) {
    throw new AnfrageFehler(
      'Bei dieser Anfrage ist die Identität nicht offen.', 'nicht_gefunden', 404);
  }
}

/**
 * Die Frist verlängern (Art. 12 Abs. 3 Satz 3).
 *
 * **Zwei Monate höchstens, und nur mit Grund.** Der Artikel erlaubt die
 * Verlängerung „um weitere zwei Monate, wenn dies unter Berücksichtigung der
 * Komplexität und der Anzahl von Anträgen erforderlich ist" — und nur, wenn die
 * betroffene Person binnen eines Monats darüber UND über die Gründe unterrichtet
 * wird. Der Grund steht deshalb nicht optional daneben: ohne ihn ist die
 * Verlängerung unwirksam, und die ursprüngliche Frist läuft weiter.
 */
export async function verlaengere(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim() === '') {
    throw new AnfrageFehler(
      'Eine Verlängerung ohne Grund ist nach Art. 12 Abs. 3 unwirksam — die '
      + 'betroffene Person muss die Gründe erfahren.', 'ohne_begruendung');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update betroffenenanfrage
        set verlaengert_bis = eingegangen_am + interval '3 months',
            verlaengert_grund = $2,
            status = case when status = 'neu' then 'in_bearbeitung'::betroffenenanfrage_status
                          else status end
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and verlaengert_bis is null
        and status not in ('beantwortet', 'abgelehnt')
      returning id`,
    [id, grund.trim()]);
  if (zeilen[0] === undefined) {
    throw new AnfrageFehler(
      'Diese Anfrage gibt es nicht, sie ist entschieden, oder die Frist wurde '
      + 'schon einmal verlängert — ein zweites Mal sieht Art. 12 nicht vor.',
      'nicht_moeglich', 409);
  }
}

/* =========================================================================
 * Die Zuordnung — von einem Menschen, nicht von einem Abgleich
 * ========================================================================= */

/**
 * Wem gehoert diese Anfrage?
 *
 * **Drei Ziele, weil es drei Arten von Personenbezug gibt** (D-09): die
 * `person` ist der Mensch (Stammdaten, Zeiten, Nachweise), der
 * `ansprechpartner` die Rolle bei einem Kunden (§ 7 UWG, Rechtsgrundlage), die
 * `bewerbung` ein Vorgang ohne Anstellung. Eine Bewerberin hat keine `person`
 * — deshalb ist sie ein eigenes Ziel und nicht ein Sonderfall des ersten.
 */
export type ZuordnungArt = 'person' | 'ansprechpartner' | 'bewerbung' | 'keine';

export const ZUORDNUNG_TEXT: Readonly<Record<ZuordnungArt, string>> = {
  person: 'Beschäftigte oder ehemalige Beschäftigte',
  ansprechpartner: 'Ansprechpartner eines Kunden',
  bewerbung: 'Bewerbung',
  keine: 'keine Zuordnung',
};

export interface Kandidat {
  readonly art: Exclude<ZuordnungArt, 'keine'>;
  readonly id: string;
  readonly name: string;
  /** Was die Zuordnung plausibel macht: E-Mail, Kunde, Stelle. */
  readonly beiwerk: string;
}

/**
 * Wer koennte es sein? — mandantengebunden, und ohne Auskunft ueber Fremde.
 *
 * **Sie sucht nur, wenn etwas gesucht wird.** Eine leere Suche gibt eine leere
 * Liste und nicht „alle": die Liste aller Beschaeftigten, aller Kontakte und
 * aller Bewerbungen ist genau das, was diese Seite nicht herausgeben soll —
 * sie steht hinter einem Datenschutzrecht, nicht hinter `personal.lesen`.
 *
 * **Die Mandantenpruefung steht in der Abfrage und nicht nur in der Policy.**
 * `person` traegt kein `mandant_id` (D-09), und `t_person_lesen` bindet an
 * `app.sichtbare_mandanten()` — das ist in einer Mandantensitzung der aktive
 * Bereich, in einer Gruppensitzung aber mehr. Die Anstellung wird deshalb hier
 * ausdruecklich gegen `app.aktiver_mandant()` gebunden.
 *
 * Wen sie NICHT findet: einen Menschen ohne jede Anstellung in dieser
 * Gesellschaft. Das ist richtig — er ist dann keine `person` dieser
 * Gesellschaft, sondern eine `bewerbung` oder ein `ansprechpartner`, und
 * beides sucht sie mit.
 */
export async function kandidaten(
  kontext: LeseKontext, suche: string,
): Promise<readonly Kandidat[]> {
  const nadel = suche.trim();
  if (nadel.length < 2) return [];
  const muster = `%${nadel.toLowerCase()}%`;

  const personen = await kontext.abfrage<Kandidat>(
    `select 'person'::text as art, p.id,
            btrim(coalesce(p.vorname, '') || ' ' || p.nachname) as name,
            coalesce(
              string_agg(distinct a.personalnummer, ', ' order by a.personalnummer),
              '—') as beiwerk
       from person p
       join anstellung a
         on a.person_id = p.id and a.mandant_id = app.aktiver_mandant()
        and a.geloescht_am is null
      where p.geloescht_am is null
        and (lower(p.nachname) like $1 or lower(coalesce(p.vorname, '')) like $1)
      group by p.id, p.vorname, p.nachname
      order by 3
      limit 20`, [muster]);

  const kontakte = await kontext.abfrage<Kandidat>(
    `select 'ansprechpartner'::text as art, ap.id,
            btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
            coalesce(k.name, '—') as beiwerk
       from ansprechpartner ap
       left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
      where ap.mandant_id = app.aktiver_mandant()
        and ap.archiviert_am is null and ap.anonymisiert_am is null
        and (lower(ap.nachname) like $1
             or lower(coalesce(ap.vorname, '')) like $1
             or lower(coalesce(ap.email, '')) like $1)
      order by 3
      limit 20`, [muster]);

  const bewerbungen = await kontext.abfrage<Kandidat>(
    `select 'bewerbung'::text as art, b.id, b.name,
            coalesce(s.titel, '—') as beiwerk
       from bewerbung b
       left join stelle s on s.mandant_id = b.mandant_id and s.id = b.stelle_id
      where b.mandant_id = app.aktiver_mandant() and b.geloescht_am is null
        and (lower(b.name) like $1 or lower(coalesce(b.email, '')) like $1)
      order by b.eingegangen_am desc
      limit 20`, [muster]);

  return [...personen, ...kontakte, ...bewerbungen];
}

/**
 * Die Zuordnung setzen — oder loesen.
 *
 * **Sie prueft die Existenz IM AKTIVEN MANDANTEN, obwohl es
 * Fremdschluessel gibt.** `0220` hat sie nachgetragen, und fuer
 * `ansprechpartner` prueft der zusammengesetzte Schluessel auch den Mandanten
 * mit. Fuer `person` und `bewerbung` kann er das nicht: `person` traegt kein
 * `mandant_id` (D-09), `bewerbung` nur ein einspaltiges UNIQUE. Ohne diese
 * Pruefung liesse sich eine Kennung aus einer FREMDEN Gesellschaft eintragen —
 * und die Auskunft, die darauf aufbaut, gaebe die Daten eines anderen
 * Menschen heraus. Das ist keine Anzeigefrage, das ist die Datenpanne selbst.
 *
 * **Sie ist aenderbar, und das ist Absicht.** Eine falsche Zuordnung muss sich
 * berichtigen lassen, sonst wird aus dem Irrtum eine Sackgasse. Was NICHT
 * aenderbar ist, ist die Entscheidung — und die steht in `entscheide()`.
 */
export async function ordneZu(
  kontext: SchreibKontext, id: string, art: ZuordnungArt, ziel: string | null,
): Promise<void> {
  if (art !== 'keine' && (ziel === null || ziel === '')) {
    throw new AnfrageFehler(
      'Bitte wählen Sie einen Datensatz aus der Trefferliste.', 'ziel_fehlt');
  }

  if (art === 'person') {
    const [treffer] = await kontext.abfrage<{ id: string }>(
      `select p.id from person p
         join anstellung a on a.person_id = p.id
          and a.mandant_id = app.aktiver_mandant() and a.geloescht_am is null
        where p.id = $1::uuid and p.geloescht_am is null
        limit 1`, [ziel]);
    if (treffer === undefined) {
      throw new AnfrageFehler(
        'Zu dieser Kennung gibt es in dieser Gesellschaft keine Beschäftigte.',
        'person_unbekannt', 404);
    }
  }
  if (art === 'bewerbung') {
    const [treffer] = await kontext.abfrage<{ id: string }>(
      `select id from bewerbung
        where id = $1::uuid and mandant_id = app.aktiver_mandant()
          and geloescht_am is null`, [ziel]);
    if (treffer === undefined) {
      throw new AnfrageFehler(
        'Zu dieser Kennung gibt es in dieser Gesellschaft keine Bewerbung.',
        'bewerbung_unbekannt', 404);
    }
  }
  if (art === 'ansprechpartner') {
    const [treffer] = await kontext.abfrage<{ id: string }>(
      `select id from ansprechpartner
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [ziel]);
    if (treffer === undefined) {
      throw new AnfrageFehler(
        'Zu dieser Kennung gibt es in dieser Gesellschaft keinen Ansprechpartner. '
        + 'Möglich ist auch, dass Ihnen crm.lesen fehlt.',
        'kontakt_unbekannt', 404);
    }
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update betroffenenanfrage
        set person_id          = case when $2 = 'person'          then $3::uuid end,
            ansprechpartner_id = case when $2 = 'ansprechpartner' then $3::uuid end,
            bewerbung_id       = case when $2 = 'bewerbung'       then $3::uuid end,
            status = case when status = 'neu' then 'in_bearbeitung'::betroffenenanfrage_status
                          else status end
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and status not in ('beantwortet', 'abgelehnt')
      returning id`,
    [id, art, art === 'keine' ? null : ziel]);

  if (zeilen[0] === undefined) {
    throw new AnfrageFehler(
      'Diese Anfrage gibt es nicht — oder sie ist bereits entschieden. Eine '
      + 'entschiedene Anfrage wird nicht mehr umgeordnet.',
      'nicht_zuordenbar', 409);
  }
}

/** Die Zuordnung einer geladenen Anfrage, in EINEM Wert. */
export interface Zuordnung {
  readonly art: ZuordnungArt;
  readonly id: string | null;
  /** Der Name des zugeordneten Datensatzes — `null`, wenn er nicht lesbar ist. */
  readonly name: string | null;
  /**
   * Das Ziel im Portal, wo es eines gibt.
   *
   * `null` auch dann, wenn der Aufrufer keinen Bereichsslug mitgibt — eine
   * API-Route braucht die Zuordnung, aber keinen Verweis, und ein Pfad mit
   * leerem Slug (`/portal//personal/…`) waere ein Verweis, der ins Nichts
   * fuehrt und wie einer aussieht.
   */
  readonly pfad: string | null;
}

export async function ladeZuordnung(
  kontext: LeseKontext, mandantSlug: string | null, id: string,
): Promise<Zuordnung> {
  const [z] = await kontext.abfrage<{
    person_id: string | null; ansprechpartner_id: string | null;
    bewerbung_id: string | null;
  }>(
    `select person_id, ansprechpartner_id, bewerbung_id
       from betroffenenanfrage
      where mandant_id = app.aktiver_mandant() and id = $1::uuid`, [id]);

  if (z === undefined) return { art: 'keine', id: null, name: null, pfad: null };

  if (z.person_id !== null) {
    const [p] = await kontext.abfrage<{ name: string }>(
      `select btrim(coalesce(vorname, '') || ' ' || nachname) as name
         from person where id = $1::uuid`, [z.person_id]);
    /*
     * **Der Pfad kommt aus `editorPfad`, nicht aus einer zweiten Zeile hier**
     * (V-218). Bis dahin stand an dieser Stelle `/personal/<id>` — eine
     * Adresse, die es nicht gibt (unter `/personal` liegt kein `[id]`); der
     * Verweis im Kopf jedes Vorgangs mit zugeordneter Person fiel auf 404.
     * `berichtigung.ts` hatte denselben Fehler schon behoben und
     * dokumentiert, nur lief diese Stelle daneben weiter. Eine Funktion für
     * beide heisst: sie können nicht wieder auseinanderlaufen.
     */
    return {
      art: 'person', id: z.person_id, name: p?.name ?? null,
      pfad: mandantSlug === null
        ? null : editorPfad(mandantSlug, 'person', z.person_id),
    };
  }
  if (z.ansprechpartner_id !== null) {
    const [k] = await kontext.abfrage<{ name: string; kunde_id: string | null }>(
      `select btrim(coalesce(vorname, '') || ' ' || nachname) as name, kunde_id
         from ansprechpartner
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
      [z.ansprechpartner_id]);
    return {
      art: 'ansprechpartner', id: z.ansprechpartner_id, name: k?.name ?? null,
      pfad: mandantSlug === null || k?.kunde_id === null || k?.kunde_id === undefined
        ? null : `/portal/${mandantSlug}/crm/kunden/${k.kunde_id}`,
    };
  }
  if (z.bewerbung_id !== null) {
    const [b] = await kontext.abfrage<{ name: string }>(
      `select name from bewerbung
        where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [z.bewerbung_id]);
    return {
      art: 'bewerbung', id: z.bewerbung_id, name: b?.name ?? null,
      pfad: mandantSlug === null
        ? null : editorPfad(mandantSlug, 'bewerbung', z.bewerbung_id),
    };
  }
  return { art: 'keine', id: null, name: null, pfad: null };
}

/* ------------------------------------------------------------------------- *
 * Die Aufnahme im Büro — der Brief, der Anruf, die E-Mail (V-031)
 * ------------------------------------------------------------------------- */

/** Wie ein Antrag eingegangen ist — die Aufzählung des Art. 12 Abs. 1. */
export type Eingangsweg = 'formular' | 'email' | 'brief' | 'telefon' | 'persoenlich';

/**
 * Die Wege, die ein MENSCH aufnehmen kann — `formular` fehlt mit Absicht.
 *
 * Das Formular legt der Eingangsprinzipal an, und nur er; die Policy
 * `t_betroffenenanfrage_aufnahme` (0378) schliesst diesen Wert aus. Stünde er
 * hier in der Liste, böte die Oberfläche eine Wahl an, die die Datenbank
 * ablehnt.
 */
/** Ein Weg, den ein Mensch aufnehmen kann — `formular` ist keiner. */
export type AufnahmeWeg = Exclude<Eingangsweg, 'formular'>;

export const AUFNAHME_WEGE: readonly AufnahmeWeg[] = [
  'brief', 'telefon', 'email', 'persoenlich',
];

/**
 * Ob ein Weg vom BUERO aufgenommen werden darf.
 *
 * Die Route nimmt eine Zeichenkette aus einem Formular entgegen; der Typ
 * `Eingangsweg` ist dort eine Behauptung. Diese Wache macht daraus eine
 * Feststellung — und schliesst `formular` aus, das nur dem Eingangsprinzipal
 * gehoert. Die Policy `t_betroffenenanfrage_aufnahme` (0378) sagt dasselbe
 * noch einmal in der Datenbank: eine Prüfung im Dienst gibt einen Satz, die
 * Policy gibt die Gewissheit.
 */
export function istAufnahmeWeg(weg: Eingangsweg): weg is AufnahmeWeg {
  return (AUFNAHME_WEGE as readonly Eingangsweg[]).includes(weg);
}

export const WEG_TEXT: Readonly<Record<Eingangsweg, string>> = {
  formular: 'Öffentliches Formular',
  email: 'E-Mail',
  brief: 'Brief',
  telefon: 'Telefon',
  persoenlich: 'Persönlich vor Ort',
};

export const WEG_TEXT_EN: Readonly<Record<Eingangsweg, string>> = {
  formular: 'Public form',
  email: 'Email',
  brief: 'Letter',
  telefon: 'Telephone',
  persoenlich: 'In person',
};

export interface AufzunehmendeAnfrage extends NeueAnfrage {
  readonly eingangsweg: Eingangsweg;
  /**
   * Der Eingang als Berliner Ortszeit-Angabe (`YYYY-MM-DDTHH:mm`), so wie ein
   * `datetime-local`-Feld sie liefert. Leer heisst: jetzt.
   */
  readonly eingegangenAm?: string | undefined;
}

/**
 * Eine Anfrage aufnehmen, die NICHT durch das Formular kam (Art. 12 Abs. 1).
 *
 * **Warum das nicht `nimmAn` mit einem Feld mehr ist.** Die beiden Wege
 * unterscheiden sich in dem, was die Frist auslöst. Beim Formular ist der
 * Eingang der Augenblick des Absendens — `now()`, und niemand kann ihn
 * behaupten. Beim Brief ist der Eingang der Posteingangsstempel, er liegt
 * hinter uns, und ein Mensch trägt ihn ein. Das ist keine Variante derselben
 * Handlung, sondern eine andere: die eine nimmt entgegen, die andere
 * PROTOKOLLIERT eine Entgegennahme.
 *
 * **Und deshalb wandert der Eingangszeitpunkt hier durch die Hand eines
 * Menschen, ohne Invariante 5 zu brechen.** Die Regel sagt, dass die Uhr des
 * GERÄTS nie die Wahrheit ist — sie sagt nicht, dass eine Tatsache der
 * Vergangenheit nicht erfasst werden darf. Der Unterschied liegt in der
 * Richtung: `zeiteintrag` misst, was gerade geschieht, und eine Gerätezeit
 * wäre dort eine unüberprüfbare Behauptung über die Gegenwart. Hier wird ein
 * Briefdatum abgeschrieben. Die Datenbank hält dagegen, was sie halten kann:
 * der Eingang darf nicht in der ZUKUNFT liegen (0378), denn nur diese Richtung
 * verschafft eine längere Frist.
 *
 * Die Frist rechnet danach `kern.betroffenenanfrage_frist()` aus genau diesem
 * Wert — dieselbe Funktion wie beim Formular. Der Brief vom Ersten steht am
 * Zwanzigsten als „noch zehn Tage" da, nicht als „noch ein Monat".
 */
export async function nimmAnfrageAuf(
  kontext: SchreibKontext, eingabe: AufzunehmendeAnfrage,
): Promise<{ readonly id: string; readonly fristAm: Date }> {
  const name = eingabe.name.trim();
  const email = eingabe.email.trim().toLowerCase();

  if (name === '') {
    throw new AnfrageFehler('Bitte nennen Sie den Namen der anfragenden Person.',
      'name_fehlt');
  }
  /*
   * **Die E-Mail-Adresse bleibt Pflicht, auch beim Brief.** An sie geht die
   * Antwort, und die Spalte verlangt sie (0176). Wer nur eine Anschrift hat,
   * beantwortet die Anfrage postalisch — dann gehört die Anschrift in die
   * Nachricht, und die Zeile braucht trotzdem eine erreichbare Adresse.
   * TODO(client, O-892): Soll eine rein postalische Anfrage ohne E-Mail-Adresse
   * erfassbar sein, und wohin geht dann die Antwort?
   */
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/iu.test(email)) {
    throw new AnfrageFehler(
      'Bitte prüfen Sie die E-Mail-Adresse — an sie geht die Antwort.',
      'email_ungueltig');
  }
  if (!ANFRAGE_ARTEN.includes(eingabe.art)) {
    throw new AnfrageFehler('Bitte wählen Sie das Anliegen.', 'art_fehlt');
  }
  if (!istAufnahmeWeg(eingabe.eingangsweg)) {
    throw new AnfrageFehler(
      'Bitte wählen Sie, auf welchem Weg die Anfrage eingegangen ist.',
      'weg_fehlt');
  }

  const roh = eingabe.eingegangenAm?.trim() ?? '';
  if (roh !== '' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(roh)) {
    throw new AnfrageFehler(
      'Der Eingangszeitpunkt ist nicht lesbar. Erwartet wird Datum und Uhrzeit.',
      'eingang_unlesbar');
  }

  let zeilen: readonly { id: string; frist_am: Date }[];
  try {
    zeilen = await kontext.schreibe<{ id: string; frist_am: Date }>(
      /*
       * Der Eingang wird als BERLINER Ortszeit gelesen (`at time zone`) —
       * genau das, was auf dem Stempel steht. Ohne die Zone wäre „02.11. 09:00"
       * in der Nacht der Zeitumstellung eine andere Stunde als gemeint
       * (Invariante 2).
       */
      `insert into betroffenenanfrage
         (mandant_id, art, name, email, nachricht, rolle_angabe,
          eingangsweg, erfasst_von, eingegangen_am)
       values (app.aktiver_mandant(), $1::betroffenenanfrage_art, $2, $3, $4, $5,
               $6::betroffenenanfrage_eingangsweg, app.aktueller_benutzer(),
               coalesce(($7::text)::timestamp at time zone 'Europe/Berlin', now()))
       returning id, frist_am`,
      [eingabe.art, name, email,
        eingabe.nachricht?.trim() === undefined || eingabe.nachricht.trim() === ''
          ? null : eingabe.nachricht.trim(),
        eingabe.rolleAngabe?.trim() === undefined || eingabe.rolleAngabe.trim() === ''
          ? null : eingabe.rolleAngabe.trim(),
        eingabe.eingangsweg, roh === '' ? null : roh],
    );
  } catch (fehler) {
    /*
     * Der Ausloeser aus 0378 wirft `check_violation`, wenn der Eingang in der
     * Zukunft liegt. Die Oberfläche bekommt daraus einen Satz — eine
     * Datenbankmeldung auf einem Formular ist für die Aufnehmende kein Hinweis.
     */
    const code = (fehler as { code?: string }).code;
    if (code === '23514') {
      throw new AnfrageFehler(
        'Der Eingang liegt in der Zukunft. Die Frist des Art. 12 Abs. 3 läuft ab '
        + 'Eingang — ein späteres Datum verlängerte sie.', 'eingang_zukunft');
    }
    throw fehler;
  }

  const z = zeilen[0];
  if (z === undefined) {
    throw new AnfrageFehler(
      'Die Anfrage konnte nicht gespeichert werden.', 'nicht_gespeichert', 500);
  }
  return { id: z.id, fristAm: z.frist_am };
}

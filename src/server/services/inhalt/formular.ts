import type { LeseKontext, SchreibKontext } from '@/server/kontext/index';
import { Felder, type FormularFeld } from '@/lib/formular/schema';
import {
  type FormularZustand, formularZustand, naechsteVersion,
} from '@/lib/formular/pflege';
import { RedaktionFehler } from './redaktion';

/**
 * Die Pflege der Anfrageformulare (REQ-01 … REQ-04, §5.21).
 *
 * **Warum das ein eigener Dienst ist und nicht in `redaktion.ts` steht.**
 * Die Redaktion schreibt in `seite`, `abschnitt`, `medien`, `referenz` und
 * `unternehmensprofil` — fünf Tabellen unter `referenz.*`. Ein Formular hängt
 * an einem anderen Recht (`formular.*`), an einem anderen Schutz (eine
 * veröffentlichte Version ist EINGEFROREN) und an einer anderen Folge: wer
 * eine Feldliste ändert, ändert, was `formular_eingang` speichert und was
 * `/angebot/<bereich>` validiert. `RedaktionFehler` teilt er trotzdem — für
 * den Menschen davor ist „das ging nicht, und hier ist der Grund" dieselbe
 * Antwort, und zwei Fehlerklassen wären zwei Fehlerbilder in einer
 * Oberfläche.
 *
 * **Was dieser Dienst NICHT tut: Felder ändern.** Die englische Fassung eines
 * Formulars ist CODE (`lib/i18n/formular-en.ts`) und keine Zeile: sie
 * überlagert Label, Hilfetext, Fehlermeldung und Optionsbezeichnungen und
 * fällt auf Deutsch zurück, wo ein Eintrag fehlt. Ein im Portal neu
 * angelegtes Feld stünde damit auf `/en/angebot` deutsch da — D-82/D-83
 * gebrochen, und `tests/kern/i18n.test.ts` schlägt nicht an, weil er die
 * Seed-Konstante prüft und nicht die Datenbank. Solange die Übersetzung im
 * Code lebt, ist die Feldliste hier LESBAR und nicht änderbar; geändert wird,
 * was ohne zweite Quelle auskommt: Titel, Beschreibung, Zuständigkeit — und
 * der Zustand.
 *
 * // TODO(client, O-680): Sollen die Anfrageformulare im Portal um eigene
 * // Felder erweiterbar sein? Dann braucht die englische Fassung eine
 * // Übersetzungstabelle (Migration), denn sonst steht ein neues Feld auf
 * // /en/angebot deutsch da (D-82, D-83).
 */

/* ------------------------------------------------------------------- Lesen */

export interface FormularPflegeZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly version: number;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly felderZahl: number;
  readonly datenschutzVersion: string;
  readonly veroeffentlichtAm: string | null;
  readonly zurueckgezogenAm: string | null;
  /** `false` heisst: keine Zuständigkeitszeile — oder keine LESBARE. */
  readonly hatZustaendigkeit: boolean;
  readonly slaStunden: number | null;
  readonly besitzerId: string | null;
  readonly eskalationId: string | null;
  /**
   * Der Name des Besitzers — **`null` trotz gesetzter `besitzerId` heisst „nicht
   * lesbar", nicht „niemand".**
   *
   * `t_benutzer_lesen` zeigt ein Konto nur dem, der es selbst ist, einem
   * `super_admin`, oder einem Mitglied DERSELBEN Gesellschaft mit
   * `system.benutzer_lesen`. Der Erstbestand setzt als Besitzer die
   * Gruppen-Administration — einen `super_admin` OHNE `benutzer_mandant`-Zeile.
   * Für eine `admin`-Sitzung kommt der Name deshalb leer zurück, obwohl die
   * Zuständigkeit dasteht. Eine Oberfläche, die daraus „kein Besitzer" macht,
   * behauptet, dass niemand zuständig ist.
   */
  readonly besitzerName: string | null;
  readonly eskalationName: string | null;
  readonly eingaenge: number;
}

export interface FormularZeile extends FormularPflegeZeile {
  readonly zustand: FormularZustand;
}

/**
 * Warum der Zustand hier und nicht in der Abfrage entsteht: er ist eine
 * ABLEITUNG aus zwei Zeitpunkten (`lib/formular/pflege.ts`), und dieselbe
 * Ableitung bestimmt oben in der Seite, welche Knöpfe stehen. Zweimal
 * geschrieben wäre sie die Stelle, an der Anzeige und Regel auseinanderlaufen.
 */
function mitZustand(z: FormularPflegeZeile): FormularZeile {
  return { ...z, zustand: formularZustand(z.veroeffentlichtAm, z.zurueckgezogenAm) };
}

const FELDER = `fd.id, fd.schluessel, fd.version, fd.titel, fd.beschreibung,
                jsonb_array_length(fd.felder) as "felderZahl",
                fd.datenschutz_hinweis_version as "datenschutzVersion",
                fd.veroeffentlicht_am as "veroeffentlichtAm",
                fd.zurueckgezogen_am as "zurueckgezogenAm",
                (z.id is not null) as "hatZustaendigkeit",
                z.sla_stunden as "slaStunden",
                z.standard_besitzer_benutzer_id as "besitzerId",
                z.eskalation_benutzer_id as "eskalationId",
                bb.name as "besitzerName",
                be.name as "eskalationName",
                (select count(*)::int from formular_eingang e
                  where e.mandant_id = fd.mandant_id
                    and e.formular_definition_id = fd.id) as eingaenge`;

const JOINS = `left join formular_zustaendigkeit z
                      on z.mandant_id = fd.mandant_id and z.formular_definition_id = fd.id
               left join benutzer bb on bb.id = z.standard_besitzer_benutzer_id
               left join benutzer be on be.id = z.eskalation_benutzer_id`;

/**
 * Alle Formularversionen DIESER Gesellschaft — Entwürfe, live, zurückgezogen.
 *
 * **`mandant_id = app.aktiver_mandant()` steht hier, obwohl RLS es auch
 * prüft.** `t_formular_lesen` lässt `app.sichtbare_mandanten()` zu, und das
 * ist in der Gruppenansicht mehr als einer; eine Pflegeliste, die dort vier
 * Bereiche übereinander zeigt, sieht aus wie doppelte Datensätze.
 *
 * **Die Zuständigkeit hängt an einem ANDEREN Recht als die Definition.**
 * `t_formular_schreiben` ist `FOR ALL` — wer `formular.schreiben` hält, liest
 * die Definitionen damit auch. `t_zustaendigkeit` und `t_eingang_lesen`
 * verlangen dagegen `formular.lesen`. Die Rolle `formular_eingang` hält das
 * erste und ausdrücklich nicht das zweite: sie sieht die Formulare, aber
 * keinen Besitzer und keine Eingänge. Deshalb kommt `slaStunden` als `null`
 * und `eingaenge` als `0` — und die Seite darf daraus nicht „keine Frist" und
 * „keine Anfragen" machen, sondern „nicht lesbar". Was gilt, sagt
 * `haeltRechte('formular.lesen')` in der Seite.
 */
export async function listeFormulare(kontext: LeseKontext): Promise<readonly FormularZeile[]> {
  const zeilen = await kontext.abfrage<FormularPflegeZeile>(
    `select ${FELDER}
       from formular_definition fd
       ${JOINS}
      where fd.mandant_id = app.aktiver_mandant()
      order by fd.schluessel, fd.version desc`);
  return zeilen.map(mitZustand);
}

export interface FormularDetail {
  readonly formular: FormularZeile;
  /** Die Felder der Definition, geordnet nach `sortierung`. */
  readonly felder: readonly FormularFeld[];
  /**
   * `true`, wenn `felder` nicht gegen `lib/formular/schema.ts` aufgeht.
   *
   * Eine Definition, die der Vertrag nicht liest, ist keine Definition —
   * `/angebot/<bereich>` könnte sie nicht rendern. Die Seite zeigt das als
   * Warnung, statt eine leere Feldliste als „dieses Formular hat keine
   * Felder" auszugeben.
   */
  readonly felderUnlesbar: boolean;
  /** Die anderen Versionen desselben Schlüssels, neueste zuerst. */
  readonly geschwister: readonly FormularZeile[];
  /** Die Version desselben Schlüssels, die gerade live ist — oder `null`. */
  readonly liveVersion: FormularZeile | null;
}

export async function ladeFormularZurPflege(
  kontext: LeseKontext, id: string,
): Promise<FormularDetail | null> {
  const [roh] = await kontext.abfrage<FormularPflegeZeile & { felder: unknown }>(
    `select ${FELDER}, fd.felder
       from formular_definition fd
       ${JOINS}
      where fd.id = $1::uuid and fd.mandant_id = app.aktiver_mandant()`,
    [id]);
  // 404 und nicht 403: eine Kennung aus einer fremden Gesellschaft darf nicht
  // daran erkennbar sein, dass die Antwort eine andere ist (AUT-06).
  if (roh === undefined) return null;

  const formular = mitZustand(roh);
  const geprueft = Felder.safeParse(roh.felder);
  const felder = geprueft.success
    ? [...geprueft.data].sort((a, b) => a.sortierung - b.sortierung)
    : [];

  const alle = await kontext.abfrage<FormularPflegeZeile>(
    `select ${FELDER}
       from formular_definition fd
       ${JOINS}
      where fd.mandant_id = app.aktiver_mandant() and fd.schluessel = $1
        and fd.id <> $2::uuid
      order by fd.version desc`,
    [roh.schluessel, id]);
  const geschwister = alle.map(mitZustand);
  const live = [formular, ...geschwister].find((g) => g.zustand === 'live') ?? null;

  return { formular, felder, felderUnlesbar: !geprueft.success, geschwister, liveVersion: live };
}

export interface BenutzerWahl {
  readonly id: string;
  readonly name: string;
}

/**
 * Die Menschen, die als Besitzer oder Eskalationsziel in Frage kommen.
 *
 * **Leer heisst nicht „niemand".** `t_benutzer_lesen` verlangt
 * `system.benutzer_lesen`; ohne dieses Recht kommt die Liste leer zurück,
 * obwohl es Mitglieder gibt. Die Seite bietet die Auswahl deshalb nur an, wo
 * die Liste etwas enthält — ein leeres Auswahlfeld, dessen Absenden den
 * Besitzer auf nichts setzen würde, wäre schlimmer als kein Feld.
 */
export async function waehlbareBenutzer(
  kontext: LeseKontext,
): Promise<readonly BenutzerWahl[]> {
  return kontext.abfrage<BenutzerWahl>(
    `select distinct b.id, b.name
       from benutzer_mandant bm
       join benutzer b on b.id = bm.benutzer_id
      where bm.mandant_id = app.aktiver_mandant() and bm.entzogen_am is null
        and b.status = 'aktiv' and b.deaktiviert_am is null
      order by b.name`);
}

/* --------------------------------------------------------------- Schreiben */

/**
 * **Ist diese Sitzung ein Dienstkonto?**
 *
 * `t_benutzer_lesen` lässt jede Sitzung ihre EIGENE Zeile lesen
 * (`id = app.aktueller_benutzer()`) — dafür braucht es kein
 * `system.benutzer_lesen`.
 */
export async function istDienstkonto(kontext: LeseKontext): Promise<boolean> {
  const [z] = await kontext.abfrage<{ ja: boolean }>(
    `select coalesce((select b.ist_dienstkonto from benutzer b
                       where b.id = app.aktueller_benutzer()), false) as ja`);
  return z?.ja ?? false;
}

/**
 * **Der Riegel, den dieser Dienst gebraucht hat, bevor er existierte.**
 *
 * `formular.schreiben` hält nicht nur `admin`, `leitung` und `super_admin`,
 * sondern auch die Rolle `formular_eingang` — der **zum Internet offene
 * Annahmeprinzipal** (03-AUTH §14.3, ein `ist_dienstkonto`). Er hält das Recht,
 * weil er eine Einsendung in `formular_eingang` schreiben muss, und der Seed
 * begründet ausdrücklich, was er NICHT können soll: „er nimmt Einsendungen
 * entgegen und kann keine zurückholen."
 *
 * Bis zu diesem Dienst gab es im Portal keinen Schreibweg auf
 * `formular_definition`; das Recht war insofern latent. Mit der Pflegeseite
 * wäre es das nicht mehr: wer diesen Prinzipal übernimmt, könnte das lebende
 * Anfrageformular einer Gesellschaft zurückziehen (die öffentliche Seite
 * antwortet danach mit 404) oder einen Entwurf live stellen. Das wäre ein
 * ERWEITERTER Zugriff, den niemand beschlossen hat — und ein neues Recht zu
 * erfinden, wäre eine Entscheidung über die Rollenmatrix, die dem Auftraggeber
 * gehört.
 *
 * Deshalb ist hier fail-closed: ein Dienstkonto pflegt keine Website. Die
 * eigentliche Frage bleibt offen und steht im Register.
 *
 * // TODO(client, O-682): Welches Recht trägt das Live-Stellen und
 * // Zurückziehen eines Anfrageformulars? `formular.schreiben` hält auch der
 * // zum Internet offene Annahmeprinzipal `formular_eingang`; braucht die
 * // Redaktion ein eigenes Recht (wie `referenz.veroeffentlichen` bei `seite`)?
 */
export async function verweigereDienstkonto(kontext: LeseKontext): Promise<void> {
  if (await istDienstkonto(kontext)) {
    throw new RedaktionFehler(
      'Ein Dienstkonto pflegt keine Website. Der Annahmeprinzipal hält '
      + 'formular.schreiben, weil er Einsendungen speichern muss — nicht, um ein '
      + 'öffentliches Formular zu ändern (O-682).', 'dienstkonto');
  }
}

/**
 * Ändert Titel und Beschreibung — auch an einer LEBENDEN Version.
 *
 * `kern.formular_definition_unveraenderlich` friert `felder`,
 * `datenschutz_hinweis_version`, `schluessel` und `version` ein, sobald
 * veröffentlicht ist; Titel und Beschreibung bleiben offen, und das ist
 * richtig: `formular_eingang` zeigt per Fremdschlüssel auf die VERSION, nicht
 * auf ihre Überschrift. Ein Schreibfehler in der Überschrift ist kein Grund,
 * die laufende Version stillzulegen.
 */
export async function aendereFormularKopf(
  kontext: SchreibKontext, id: string,
  felder: { readonly titel: string; readonly beschreibung: string | null },
): Promise<void> {
  const titel = felder.titel.trim();
  if (titel === '') {
    throw new RedaktionFehler(
      'Ein Formular ohne Titel hat keine Überschrift auf der öffentlichen Seite.',
      'titel_fehlt');
  }
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update formular_definition
        set titel = $2, beschreibung = $3, geaendert_von = $4::uuid
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      returning id`,
    [id, titel, felder.beschreibung, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Das Formular wurde nicht geändert — es gehört nicht zu dieser Gesellschaft, '
      + 'oder dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

export interface ZustaendigkeitEingabe {
  /** `null` heisst „unverändert lassen" — nicht „löschen". */
  readonly besitzerId: string | null;
  readonly eskalationId: string | null;
  /** `null` heisst wirklich keine Frist (O-14 lässt sie offen). */
  readonly slaStunden: number | null;
}

/**
 * Setzt Besitzer, Eskalationsziel und Reaktionszeit EINES Formulars.
 *
 * **Die Reaktionszeit wird nicht erfunden.** O-14 lässt offen, ob sie in
 * Kalender- oder Werktagsstunden zählt und wann sie an einem Freitagabend
 * anläuft; die Spalte ist deshalb nullable, der Erstbestand trägt 24 als
 * ZEILE, und die Oberfläche weist sie als vorläufig aus (D-75). Dieser Dienst
 * speichert, was jemand einträgt, und rechnet nichts daraus — die Frist
 * berechnet `services/lead/sla.ts`, und auch dort steht O-14.
 *
 * // TODO(client, O-14): Zählt die Reaktionszeit in Kalender- oder
 * // Werktagsstunden, und wann läuft sie an einem Freitagabend an?
 *
 * **Ein fremder Benutzer wird abgewiesen, nicht gespeichert.** `benutzer(id)`
 * ist ein globaler Fremdschlüssel; ohne diese Prüfung könnte ein präparierter
 * POST das Eskalationsziel einer Gesellschaft auf einen Menschen einer
 * anderen setzen — und der stünde dann in einer Benachrichtigung.
 */
export async function setzeZustaendigkeit(
  kontext: SchreibKontext, id: string, eingabe: ZustaendigkeitEingabe,
): Promise<void> {
  if (eingabe.slaStunden !== null
      && (!Number.isInteger(eingabe.slaStunden) || eingabe.slaStunden <= 0)) {
    throw new RedaktionFehler(
      'Die Reaktionszeit ist eine ganze Zahl von Stunden über null — oder nichts.',
      'sla_ungueltig');
  }

  const [vorhanden] = await kontext.abfrage<{
    besitzerId: string; eskalationId: string | null;
  }>(
    `select standard_besitzer_benutzer_id as "besitzerId",
            eskalation_benutzer_id as "eskalationId"
       from formular_zustaendigkeit
      where formular_definition_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id]);

  const besitzer = eingabe.besitzerId ?? vorhanden?.besitzerId ?? null;
  if (besitzer === null) {
    throw new RedaktionFehler(
      'Ohne Besitzer gibt es niemanden, dem eine Anfrage zufällt. '
      + '`formular_zustaendigkeit.standard_besitzer_benutzer_id` ist Pflicht.',
      'besitzer_fehlt');
  }
  const eskalation = eingabe.eskalationId ?? vorhanden?.eskalationId ?? null;

  for (const kandidat of [besitzer, eskalation]) {
    if (kandidat === null) continue;
    // Unverändert gebliebene Werte werden nicht neu geprüft: die Leseliste
    // hängt an `system.benutzer_lesen`, und eine Sitzung ohne dieses Recht
    // soll die Frist trotzdem eintragen können.
    if (kandidat === vorhanden?.besitzerId || kandidat === vorhanden?.eskalationId) continue;
    const [m] = await kontext.abfrage<{ ja: boolean }>(
      `select exists (
         select 1 from benutzer_mandant bm
          where bm.benutzer_id = $1::uuid and bm.mandant_id = app.aktiver_mandant()
            and bm.entzogen_am is null) as ja`,
      [kandidat]);
    if (m?.ja !== true) {
      throw new RedaktionFehler(
        'Dieser Mensch gehört nicht zu dieser Gesellschaft — oder diese Sitzung darf '
        + 'die Mitgliederliste nicht lesen (system.benutzer_lesen).', 'benutzer_unbekannt');
    }
  }

  /*
   * Ein UPSERT und kein Löschen-und-Neuanlegen: `formular_zustaendigkeit`
   * trägt eine Löschsperre (`verhindere_loeschung`), und ein `delete` fiele
   * mit einer Meldung aus der Datenbank auf, die niemandem sagt, was gemeint
   * war. `formular_zustaendigkeit_uk` ist auf `formular_definition_id` —
   * genau eine Zuständigkeit je Version.
   */
  const zeilen = await kontext.abfrage<{ id: string }>(
    `insert into formular_zustaendigkeit
       (mandant_id, formular_definition_id, sla_stunden,
        standard_besitzer_benutzer_id, eskalation_benutzer_id, erstellt_von)
     select fd.mandant_id, fd.id, $2::int, $3::uuid, $4::uuid, $5::uuid
       from formular_definition fd
      where fd.id = $1::uuid and fd.mandant_id = app.aktiver_mandant()
     on conflict (formular_definition_id) do update
        set sla_stunden = excluded.sla_stunden,
            standard_besitzer_benutzer_id = excluded.standard_besitzer_benutzer_id,
            eskalation_benutzer_id = excluded.eskalation_benutzer_id,
            geaendert_von = $5::uuid
     returning id`,
    [id, eingabe.slaStunden, besitzer, eskalation, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Zuständigkeit wurde nicht gesetzt — das Formular gehört nicht zu dieser '
      + 'Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.', 'nicht_geaendert');
  }
}

/**
 * Stellt eine Version live — und zieht die bisher lebende desselben
 * Schlüssels im GLEICHEN Schritt zurück.
 *
 * **Warum beides zusammen und nicht zwei Klicks.** `formular_definition_live_uk`
 * lässt genau eine lebende Version je (Mandant, Schlüssel) zu. Zwei getrennte
 * Handlungen hätten zwischen ihnen ein Fenster, in dem `/angebot/<bereich>`
 * kein Formular findet und mit 404 antwortet — eine öffentliche Seite, die
 * während einer Pflegeaktion verschwindet. Die Oberfläche NENNT die zweite
 * Wirkung auf dem Knopf; still ist sie damit nicht.
 *
 * **Der Zeitpunkt kommt vom Server.** `kern.erzwinge_serverzeit_veroeffentlichung`
 * überschreibt `veroeffentlicht_am` mit `now()` und friert es danach ein
 * (Invariante 5). Was hier übergeben wird, ist deshalb nur „nicht null".
 *
 * **Und einfrieren heisst: beim ERSTEN Mal.** Wird eine zurückgezogene Version
 * wieder live gestellt, setzt der Auslöser den alten Wert zurück
 * (`elsif tg_op = 'UPDATE' and old.veroeffentlicht_am is not null then
 * new.veroeffentlicht_am := old.veroeffentlicht_am`) — die Zeile trägt danach
 * weiter ihren ersten Zeitpunkt. Das ist gewollt (ein Datum, das sich
 * rückwirkend ändert, wäre schlimmer), aber es ist nicht „seit wann ist sie
 * draussen". Liste und Detailseite beschriften den Wert deshalb als
 * „erstmals veröffentlicht" und nicht als „veröffentlicht".
 */
export async function veroeffentlicheFormular(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly zurueckgezogeneVersion: number | null }> {
  const [ziel] = await kontext.abfrage<{
    schluessel: string; version: number;
    veroeffentlichtAm: string | null; zurueckgezogenAm: string | null;
  }>(
    `select schluessel, version,
            veroeffentlicht_am as "veroeffentlichtAm",
            zurueckgezogen_am as "zurueckgezogenAm"
       from formular_definition
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [id]);
  if (ziel === undefined) {
    throw new RedaktionFehler('Diese Formularversion gibt es hier nicht.', 'nicht_gefunden');
  }
  if (formularZustand(ziel.veroeffentlichtAm, ziel.zurueckgezogenAm) === 'live') {
    throw new RedaktionFehler('Diese Version ist schon live.', 'schon_live');
  }

  const vorher = await kontext.abfrage<{ version: number }>(
    `update formular_definition
        set zurueckgezogen_am = now(), geaendert_von = $3::uuid
      where mandant_id = app.aktiver_mandant() and schluessel = $1 and id <> $2::uuid
        and veroeffentlicht_am is not null and zurueckgezogen_am is null
      returning version`,
    [ziel.schluessel, id, kontext.benutzerId]);

  const zeilen = await kontext.abfrage<{ id: string }>(
    `update formular_definition
        set veroeffentlicht_am = now(), zurueckgezogen_am = null,
            geaendert_von = $2::uuid
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      returning id`,
    [id, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Version wurde nicht veröffentlicht — dieser Sitzung fehlt das Schreibrecht.',
      'nicht_geaendert');
  }
  return { zurueckgezogeneVersion: vorher[0]?.version ?? null };
}

/**
 * Zieht eine Version zurück — und sagt, was danach öffentlich passiert.
 *
 * Ohne lebende Version antwortet `/angebot/<bereich>` mit 404: der Bereich hat
 * dann kein Anfrageformular. Das ist kein Fehler, sondern eine Entscheidung,
 * und die Seite schreibt sie hin, bevor jemand den Knopf drückt.
 */
export async function zieheFormularZurueck(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `update formular_definition
        set zurueckgezogen_am = now(), geaendert_von = $2::uuid
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and veroeffentlicht_am is not null and zurueckgezogen_am is null
      returning id`,
    [id, kontext.benutzerId]);
  if (zeilen.length === 0) {
    throw new RedaktionFehler(
      'Die Version wurde nicht zurückgezogen — sie ist nicht live, gehört nicht zu '
      + 'dieser Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.',
      'nicht_geaendert');
  }
}

/**
 * Legt Version + 1 als Entwurf an — Felder und Zuständigkeit mitkopiert.
 *
 * **Eine lebende Definition wird nicht an ihrem Platz geändert.**
 * `formular_eingang` zeigt per `(mandant_id, formular_definition_id)` auf
 * genau die Version, die der Besucher gesehen hat. Wer die Felder darunter
 * austauschte, machte aus jeder alten Einsendung eine Antwort auf Fragen, die
 * nie gestellt wurden — und der Datenschutzhinweis, den sie bestätigt hat,
 * wäre ein anderer.
 */
export async function legeNeueVersionAn(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly id: string; readonly version: number;
             readonly zustaendigkeitKopiert: boolean }> {
  const versionen = await kontext.abfrage<{ version: number }>(
    `select fd2.version
       from formular_definition fd
       join formular_definition fd2
            on fd2.mandant_id = fd.mandant_id and fd2.schluessel = fd.schluessel
      where fd.id = $1::uuid and fd.mandant_id = app.aktiver_mandant()`,
    [id]);
  if (versionen.length === 0) {
    throw new RedaktionFehler('Diese Formularversion gibt es hier nicht.', 'nicht_gefunden');
  }
  const naechste = naechsteVersion(versionen.map((v) => v.version));

  const [neu] = await kontext.abfrage<{ id: string }>(
    `insert into formular_definition
       (mandant_id, schluessel, version, titel, beschreibung, felder,
        datenschutz_hinweis_version, erstellt_von)
     select fd.mandant_id, fd.schluessel, $2::int, fd.titel, fd.beschreibung, fd.felder,
            fd.datenschutz_hinweis_version, $3::uuid
       from formular_definition fd
      where fd.id = $1::uuid and fd.mandant_id = app.aktiver_mandant()
     returning id`,
    [id, naechste, kontext.benutzerId]);
  if (neu === undefined) {
    throw new RedaktionFehler(
      'Die neue Version wurde nicht angelegt — dieser Sitzung fehlt das Schreibrecht.',
      'nicht_geaendert');
  }

  /*
   * Die Zuständigkeit reist mit, WO SIE LESBAR IST. `t_zustaendigkeit`
   * verlangt zum Lesen `formular.lesen`; eine Sitzung, die nur
   * `formular.schreiben` hält, sieht die Quellzeile nicht und kann sie
   * deshalb nicht kopieren. Das wird gemeldet und nicht verschwiegen: eine
   * Version ohne Besitzer nimmt keine Anfrage entgegen, und das soll jemand
   * sehen, bevor er sie live stellt.
   */
  const kopiert = await kontext.abfrage<{ id: string }>(
    `insert into formular_zustaendigkeit
       (mandant_id, formular_definition_id, sla_stunden,
        standard_besitzer_benutzer_id, eskalation_benutzer_id, erstellt_von)
     select z.mandant_id, $2::uuid, z.sla_stunden,
            z.standard_besitzer_benutzer_id, z.eskalation_benutzer_id, $3::uuid
       from formular_zustaendigkeit z
      where z.formular_definition_id = $1::uuid and z.mandant_id = app.aktiver_mandant()
     on conflict (formular_definition_id) do nothing
     returning id`,
    [id, neu.id, kontext.benutzerId]);

  return { id: neu.id, version: naechste, zustaendigkeitKopiert: kopiert.length > 0 };
}

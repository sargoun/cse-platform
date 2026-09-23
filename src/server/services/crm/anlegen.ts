/**
 * Kunden, Kontakte und Leads von Hand anlegen (CRM-01, CRM-03, CRM-07, OPS-01).
 *
 * **Warum das eine eigene Datei ist und nicht in `lead/annahme.ts` steht.**
 * `annahme.ts` ist der ANONYME Weg: Honigtopf, Ratenlimit, Validierung gegen
 * eine veröffentlichte Formularversion, Schreiben über einen Prinzipal ohne
 * Leserecht. Hier sitzt ein angemeldeter Mensch mit `crm.schreiben` vor dem
 * Bildschirm und trägt ein, was er am Telefon gehört hat. Dieselbe Funktion
 * für beides hiesse, dass jede Änderung am einen Weg den anderen mitverändert
 * — und einer der beiden ist öffentlich erreichbar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Rechtsgrundlage ist die eine Stelle, an der dieses Modul streng ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kunde.rechtsgrundlage` und `ansprechpartner.rechtsgrundlage` sind die
 * Felder, aus denen `app.darf_kontaktiert_werden` seine Antwort zieht — und
 * die entscheidet, ob eine Werbenachricht hinausgeht oder abgewiesen wird
 * (§7 UWG, LEG-08). Sie sind deshalb **keine Vorgabe, die man wegklicken
 * kann**:
 *
 *  - Ohne Angabe ist die Grundlage `keine`. Das ist der fail-closed-Zweig: der
 *    Kontakt steht in der Liste, ist sichtbar, und ihm geht nichts hinaus.
 *  - Wer eine angibt, muss QUELLE und DATUM nennen — der CHECK
 *    `kunde_grundlage_belegt` erzwingt es ohnehin, und hier steht der Grund
 *    dafür in Worten: eine Einwilligung, von der niemand sagen kann, wann und
 *    wo sie erteilt wurde, ist in einer Abmahnung nichts wert.
 */
import type { SchreibKontext } from '../../kontext/index.js';

export type KundeTyp = 'firma' | 'behoerde' | 'privat';
export type Rechtsgrundlage = 'einwilligung' | 'bestandskunde' | 'anfrage' | 'keine';

export class CrmFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'CrmFehler';
  }
}

export interface NeuerKunde {
  readonly name: string;
  readonly typ: KundeTyp;
  readonly strasse?: string | undefined;
  readonly hausnummer?: string | undefined;
  readonly plz?: string | undefined;
  readonly ort?: string | undefined;
  readonly emailZentral?: string | undefined;
  readonly telefonZentral?: string | undefined;
  readonly webseite?: string | undefined;
  readonly ustId?: string | undefined;
  readonly rechtsgrundlage: Rechtsgrundlage;
  /** Woher die Grundlage stammt — Pflicht, sobald sie nicht `keine` ist. */
  readonly grundlageQuelle?: string | undefined;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

/**
 * **Die Firma hinter dem Kunden — über die USt-IdNr.** (V-140, CRM-06, D-634).
 *
 * Die Gruppenliste erkennt denselben Kunden in zwei Gesellschaften allein an
 * `kunde.firma_id`. `app.firma_aufloesen` (0020) ist die EINZIGE Stelle, an
 * der eine `firma` entsteht — und hatte keinen Aufrufer. Jeder im Portal
 * angelegte Kunde blieb ohne Firma, und „auch in" war für echte Daten leer.
 *
 * **Nur mit USt-IdNr., nur für Firma und Behörde.** Die Nummer ist die
 * Identität einer Rechtseinheit; ein gleicher Name ist keine — zwei
 * „Muster GmbH" in Berlin sind zwei Unternehmen, und eine Verschmelzung über
 * den Namen legte die Historie des einen in die des anderen. Eine
 * Privatperson ist keine Firma. Ohne Nummer bleibt `firma_id` leer, und das
 * ist eine Aussage („nicht zugeordnet"), keine Lücke.
 *
 * Die Funktion gibt NUR die Kennung zurück — nie ein Attribut aus einer
 * anderen Gesellschaft.
 */
export async function firmaFuer(
  kontext: SchreibKontext, typ: KundeTyp, name: string, ustId: string | null,
): Promise<string | null> {
  if (typ === 'privat' || ustId === null) return null;
  const [z] = await kontext.schreibe<{ id: string | null }>(
    `select app.firma_aufloesen($1, $2)::text as id`, [ustId, name]);
  return z?.id ?? null;
}

/**
 * Die Kundennummer.
 *
 * **Kein Nummernkreis** (K-12). Dieselbe Begründung wie bei der Leadnummer:
 * die lückenlose Kette gehört Rechnungen, wo eine Lücke ein GoBD-Befund ist.
 * Ein Kunde ist kein Beleg, und ein abgebrochenes Formular darf eine Nummer
 * verbrauchen. Den Rechnungszähler dafür zu benutzen hiesse, ihn von aussen
 * auslösbar zu machen.
 *
 * Sie wird in der Datenbank gebildet, aus dem laufenden Zählerstand dieser
 * Gesellschaft — und zwar in derselben Anweisung wie der `insert`, damit zwei
 * gleichzeitige Anlagen nicht dieselbe Nummer bekommen. Liefen sie getrennt,
 * bekämen beide dieselbe Zahl, und die zweite fiele auf `kunde_nummer_uk`
 * — mit einem Fehler, den der Mensch davor nicht versteht.
 */
export async function legeKundeAn(
  kontext: SchreibKontext, eingabe: NeuerKunde,
): Promise<{ readonly id: string; readonly kundennummer: string }> {
  const name = eingabe.name.trim();
  if (name === '') {
    throw new CrmFehler('Ein Kunde braucht einen Namen.', 'name_fehlt');
  }
  if (!['firma', 'behoerde', 'privat'].includes(eingabe.typ)) {
    throw new CrmFehler('Bitte wählen Sie eine Art.', 'typ_fehlt');
  }

  const grundlage = eingabe.rechtsgrundlage;
  const quelle = leer(eingabe.grundlageQuelle);
  if (grundlage !== 'keine' && quelle === null) {
    throw new CrmFehler(
      'Zu einer Rechtsgrundlage gehört, woher sie kommt — sonst ist sie in einer '
      + 'Abmahnung nichts wert. Beispiel: „Häkchen im Angebotsformular vom 12.03." '
      + 'oder „bestehender Rahmenvertrag RV-2024-08".',
      'grundlage_ohne_quelle');
  }

  const ustId = leer(eingabe.ustId);
  const firmaId = await firmaFuer(kontext, eingabe.typ, name, ustId);

  const zeilen = await kontext.schreibe<{ id: string; kundennummer: string }>(
    `insert into kunde
       (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort,
        email_zentral, telefon_zentral, webseite, ust_id,
        ist_oeffentlicher_auftraggeber,
        rechtsgrundlage, rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
        erstellt_von, firma_id)
     select app.aktiver_mandant(),
            -- Nummer aus dem Bestand dieser Gesellschaft; siehe Kommentar oben.
            'K-' || lpad((
              coalesce(max(substring(k.kundennummer from '^K-(\\d+)$')::int), 0) + 1
            )::text, 5, '0'),
            $1::kunde_typ, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $1::kunde_typ = 'behoerde',
            $11::rechtsgrundlage, $12,
            case when $11::rechtsgrundlage = 'keine' then null else now() end,
            app.aktueller_benutzer(), $13::uuid
       from kunde k
      where k.mandant_id = app.aktiver_mandant()
     returning id, kundennummer`,
    [eingabe.typ, name, leer(eingabe.strasse), leer(eingabe.hausnummer),
      leer(eingabe.plz), leer(eingabe.ort), leer(eingabe.emailZentral),
      leer(eingabe.telefonZentral), leer(eingabe.webseite), ustId,
      grundlage, quelle, firmaId],
  );

  const z = zeilen[0];
  if (z === undefined) {
    throw new CrmFehler(
      'Der Kunde wurde nicht angelegt — fehlt `crm.schreiben`?', 'kein_schreibrecht', 403);
  }
  return { id: z.id, kundennummer: z.kundennummer };
}

export interface NeuerKontakt {
  readonly kundeId: string;
  readonly nachname: string;
  readonly vorname?: string | undefined;
  readonly anrede?: string | undefined;
  readonly position?: string | undefined;
  readonly email?: string | undefined;
  readonly telefon?: string | undefined;
  readonly istHauptkontakt?: boolean | undefined;
  readonly rechtsgrundlage: Rechtsgrundlage;
  readonly grundlageQuelle?: string | undefined;
  /** Bei `einwilligung`: über welche Kanäle sie erteilt wurde. */
  readonly einwilligungKanaele?: readonly string[] | undefined;
}

const KANAELE = ['email', 'telefon', 'sms', 'post', 'whatsapp'] as const;

/**
 * Einen Ansprechpartner anlegen.
 *
 * **`einwilligung` ohne Kanäle ist eine Einwilligung in nichts.**
 * `app.darf_kontaktiert_werden` prüft bei `rechtsgrundlage = 'einwilligung'`,
 * ob der Kanal in `einwilligung_kanaele` steht — eine leere Liste heisst also:
 * jeder elektronische Kanal ist gesperrt. Das ist technisch richtig und als
 * Eingabe fast immer ein Versehen, deshalb wird es hier abgewiesen statt
 * stillschweigend übernommen.
 */
export async function legeKontaktAn(
  kontext: SchreibKontext, eingabe: NeuerKontakt,
): Promise<string> {
  const nachname = eingabe.nachname.trim();
  if (nachname === '') {
    throw new CrmFehler('Ein Kontakt braucht mindestens einen Nachnamen.', 'name_fehlt');
  }
  const quelle = leer(eingabe.grundlageQuelle);
  if (eingabe.rechtsgrundlage !== 'keine' && quelle === null) {
    throw new CrmFehler(
      'Zu einer Rechtsgrundlage gehört, woher sie kommt (§7 UWG, LEG-08).',
      'grundlage_ohne_quelle');
  }

  const kanaele = (eingabe.einwilligungKanaele ?? [])
    .filter((k) => (KANAELE as readonly string[]).includes(k));
  if (eingabe.rechtsgrundlage === 'einwilligung' && kanaele.length === 0) {
    throw new CrmFehler(
      'Eine Einwilligung gilt für bestimmte Wege. Ohne Kanal ist sie eine '
      + 'Einwilligung in nichts — das Tor weist dann jede elektronische Nachricht '
      + 'ab. Bitte nennen Sie, worein eingewilligt wurde.',
      'einwilligung_ohne_kanal');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into ansprechpartner
       (mandant_id, kunde_id, anrede, vorname, nachname, position, email, telefon,
        ist_hauptkontakt, rechtsgrundlage, rechtsgrundlage_quelle,
        rechtsgrundlage_erfasst_am, einwilligung_kanaele, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4, $5, $6, $7, $8,
             $9::rechtsgrundlage, $10,
             case when $9::rechtsgrundlage = 'keine' then null else now() end,
             case when $9::rechtsgrundlage = 'einwilligung' then $11::text[] else null end,
             app.aktueller_benutzer())
     returning id`,
    [eingabe.kundeId, leer(eingabe.anrede), leer(eingabe.vorname), nachname,
      leer(eingabe.position), leer(eingabe.email), leer(eingabe.telefon),
      eingabe.istHauptkontakt ?? false,
      eingabe.rechtsgrundlage, quelle, kanaele],
  );

  const z = zeilen[0];
  if (z === undefined) {
    throw new CrmFehler(
      'Der Kontakt wurde nicht angelegt — gibt es diesen Kunden?', 'nicht_angelegt', 400);
  }
  return z.id;
}

export interface NeuerLead {
  readonly betreff: string;
  readonly firmaName?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly bedarf?: string | undefined;
  readonly besitzerBenutzerId: string;
  /**
   * Die Herkunft eines von Hand erfassten Leads (V-139, CRM-07). Vorgabe
   * `manuell`. `empfehlung` verlangt den empfehlenden Kunden — der CHECK
   * `lead_herkunft_stimmig` (0017) ohnehin, hier steht der Satz dazu.
   * Webformular, Vergaberadar und Akquise haben eigene Wege mit eigenem
   * Beleg und stehen hier deshalb nicht zur Wahl.
   */
  readonly quelle?: 'manuell' | 'empfehlung' | undefined;
  readonly empfehlungVonKundeId?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Ein Kunde DIESER Gesellschaft, nicht archiviert — oder `null`.
 *
 * `lead.kunde_id` hatte bis 0400 keinen Fremdschlüssel; ein Formular, das
 * eine fremde Kennung schickte, hängte einen Lead an einen Kunden einer
 * anderen Gesellschaft. Jetzt hielte der Schlüssel das mit einem `23503` —
 * hier steht der Satz dazu.
 */
async function kundeHier(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly id: string; readonly name: string } | null> {
  if (!UUID.test(id)) return null;
  const [k] = await kontext.abfrage<{ id: string; name: string }>(
    `select id::text as id, name from kunde
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null`, [id]);
  return k ?? null;
}

/**
 * Einen Lead von Hand anlegen — `quelle = 'manuell'` oder `'empfehlung'`.
 *
 * **Keine SLA-Frist.** `sla_stunden` steht an einem Formular; ein Lead, den
 * jemand nach einem Telefonat einträgt, hat keine zu erben. Eine zu erfinden
 * hiesse, eine Geschäftsregel per Vorgabewert zu wählen (O-14) — und die
 * REQ-06-Eskalation liefe dann auf einen Vorgang, für den niemand eine Frist
 * zugesagt hat.
 */
export async function legeLeadAn(
  kontext: SchreibKontext, eingabe: NeuerLead,
): Promise<{ readonly id: string; readonly leadnummer: string }> {
  const betreff = eingabe.betreff.trim();
  if (betreff === '') {
    throw new CrmFehler('Ein Lead braucht einen Betreff.', 'betreff_fehlt');
  }
  const firma = leer(eingabe.firmaName);
  const kundeId = leer(eingabe.kundeId);
  if (firma === null && kundeId === null) {
    throw new CrmFehler(
      'Ein Lead braucht einen Namen: entweder einen bestehenden Kunden oder eine '
      + 'Firma im Klartext.', 'ohne_namen');
  }
  if (kundeId !== null && await kundeHier(kontext, kundeId) === null) {
    throw new CrmFehler('Diesen Kunden gibt es in dieser Gesellschaft nicht.',
      'kunde_unbekannt');
  }

  /*
   * **Die Empfehlung** (V-139, CRM-07). Ein Kunde, der sich selbst empfiehlt,
   * ist keine Empfehlung, sondern ein Bestandskunde mit neuem Bedarf — der
   * Herkunftsbericht zählte ihn sonst als Kanal „Empfehlung", und die Zahl,
   * wie viele NEUE Kunden über Empfehlungen kommen, stimmte nicht.
   */
  const quelle = eingabe.quelle ?? 'manuell';
  if (quelle !== 'manuell' && quelle !== 'empfehlung') {
    throw new CrmFehler('Diese Herkunft gibt es hier nicht.', 'unbekannte_quelle');
  }
  let empfehler: { readonly id: string; readonly name: string } | null = null;
  if (quelle === 'empfehlung') {
    const empfehlerId = leer(eingabe.empfehlungVonKundeId);
    if (empfehlerId === null) {
      throw new CrmFehler(
        'Eine Empfehlung nennt den Kunden, der empfohlen hat — sonst ist sie eine '
        + 'Erfassung von Hand.', 'empfehlung_ohne_kunde');
    }
    empfehler = await kundeHier(kontext, empfehlerId);
    if (empfehler === null) {
      throw new CrmFehler('Diesen Kunden gibt es in dieser Gesellschaft nicht.',
        'kunde_unbekannt');
    }
    if (kundeId !== null && empfehler.id === kundeId) {
      throw new CrmFehler(
        'Ein Kunde empfiehlt sich nicht selbst. Eine neue Anfrage eines Bestandskunden ist '
        + 'eine Erfassung von Hand.', 'empfehlung_selbst');
    }
  }

  const zeilen = await kontext.schreibe<{ id: string; leadnummer: string }>(
    `insert into lead
       (mandant_id, leadnummer, quelle, firma_name, kunde_id, betreff,
        bedarf_zusammenfassung, besitzer_benutzer_id, akteur_art, erstellt_von,
        empfehlung_von_kunde_id)
     values (app.aktiver_mandant(),
             'L-' || upper(replace(gen_random_uuid()::text, '-', ''))::text,
             $6::lead_quelle, $1, $2::uuid, $3, $4, $5::uuid, 'mensch',
             app.aktueller_benutzer(), $7::uuid)
     returning id, leadnummer`,
    [firma, kundeId, betreff, leer(eingabe.bedarf), eingabe.besitzerBenutzerId,
      quelle, empfehler?.id ?? null]);

  const z = zeilen[0];
  if (z === undefined) {
    throw new CrmFehler(
      'Der Lead wurde nicht angelegt — fehlt `crm.schreiben`?', 'kein_schreibrecht', 403);
  }

  /*
   * Die Eingangsaktivitaet ist `intern`, nicht `ausgehend`: der Ausloeser
   * `kern.setze_erste_reaktion()` stempelt auf die erste AUSGEHENDE Aktivitaet,
   * und ein frisch eingetragener Lead waere sonst in der Sekunde seiner
   * Entstehung „beantwortet". Dieselbe Begruendung wie in `annahme.ts`.
   */
  await kontext.schreibe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
        akteur_art, rechtsgrundlage_snapshot)
     values (app.aktiver_mandant(), $1::uuid, 'notiz', 'intern', 'intern', 'portal',
             'Von Hand angelegt', $2, 'mensch', 'keine')`,
    [z.id, `Eingetragen im Portal. ${firma === null ? '' : `Firma: ${firma}.`}`
      + `${empfehler === null ? '' : ` Empfohlen von ${empfehler.name}.`}`]);

  return { id: z.id, leadnummer: z.leadnummer };
}

/**
 * Den Stand eines Leads ändern (CRM-02).
 *
 * **Ein Verlust trägt einen Grund** — beide Verlustzustände. Der CHECK
 * `lead_verlust_begruendet` verlangt ihn ohnehin; hier steht der Satz dazu, den
 * ein Mensch lesen kann. `kein_bedarf` ist für die Auswertung genauso ein
 * Verlust wie `verloren`, und eine Pipeline, in der die Hälfte der Verluste
 * „ohne Grund" heisst, beantwortet keine einzige Frage.
 */
export async function setzeLeadStatus(
  kontext: SchreibKontext, id: string, status: string, grund?: string | undefined,
): Promise<void> {
  const erlaubt = ['neu', 'in_bearbeitung', 'angebot', 'gewonnen', 'verloren', 'kein_bedarf'];
  if (!erlaubt.includes(status)) {
    throw new CrmFehler('Diesen Stand gibt es nicht.', 'unbekannter_status');
  }
  const verlust = status === 'verloren' || status === 'kein_bedarf';
  const text = leer(grund);
  if (verlust && text === null) {
    throw new CrmFehler(
      'Ein verlorener Lead trägt einen Grund — sonst sagt die Auswertung nichts '
      + 'darüber, warum verloren wurde.', 'verlust_ohne_grund');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lead
        set status = $2::lead_status,
            verloren_grund = case when $2 in ('verloren','kein_bedarf') then $3
                                  else verloren_grund end,
            konvertiert_am = case when $2 = 'gewonnen' then now() else konvertiert_am end,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [id, status, text]);
  if (zeilen[0] === undefined) {
    throw new CrmFehler('Diesen Lead gibt es nicht.', 'nicht_gefunden', 404);
  }
}

export interface LeadPflege {
  readonly prioritaet?: string | undefined;
  readonly besitzerBenutzerId?: string | undefined;
}

/**
 * Priorität und Besitzer eines Leads setzen (V-137, CRM-02).
 *
 * Beides stand seit 0017 in der Tabelle und liess sich nirgends setzen: die
 * Priorität blieb für immer „normal", und wer eine Anfrage übernahm, stand
 * nicht daran — die Meldung bei neuer Anfrage und bei überschrittener
 * Reaktionszeit ging weiter an den Vorgabebesitzer des Formulars.
 *
 * **Ein Besitzer arbeitet in diesem Bereich.** Geprüft gegen eine GÜLTIGE
 * Mitgliedschaft (dasselbe Fenster wie überall, 0169) und ein aktives Konto;
 * ein Dienstkonto besitzt keine Anfrage. Sonst ginge die nächste Meldung an
 * jemanden, der den Lead nicht einmal öffnen darf.
 */
export async function setzeLeadPflege(
  kontext: SchreibKontext, id: string, pflege: LeadPflege,
): Promise<void> {
  const prioritaet = leer(pflege.prioritaet);
  if (prioritaet !== null && !['niedrig', 'normal', 'hoch'].includes(prioritaet)) {
    throw new CrmFehler('Diese Priorität gibt es nicht.', 'unbekannte_prioritaet');
  }
  const gewuenscht = leer(pflege.besitzerBenutzerId);
  const [jetzt] = gewuenscht === null ? [] : await kontext.abfrage<{ besitzer: string }>(
    `select besitzer_benutzer_id::text as besitzer from lead
      where mandant_id = app.aktiver_mandant() and id = $1::uuid`, [id]);
  /* Ein unveränderter Besitzer ist keine Änderung und wird nicht neu geprüft. */
  const besitzer = gewuenscht !== null && gewuenscht !== jetzt?.besitzer ? gewuenscht : null;
  if (besitzer !== null) {
    /*
     * Eine gültige Mitgliedschaft in DIESEM Bereich — oder eine aktive
     * globale Rolle, die in jedem Bereich gilt (TEN-08): der Vorgabebesitzer
     * der Formulare im Seed ist die Super-Administration, ohne Mitgliedszeile.
     */
    const [mitglied] = await kontext.abfrage<{ ok: boolean }>(
      `select exists (
         select 1 from benutzer b
          where b.id = $1::uuid
            and b.status = 'aktiv' and b.deaktiviert_am is null
            and not b.ist_dienstkonto
            and (b.globale_rolle_id is not null
                 or exists (select 1 from benutzer_mandant bm
                             where bm.benutzer_id = b.id
                               and bm.mandant_id = app.aktiver_mandant()
                               and bm.entzogen_am is null
                               and bm.gueltig_ab <= app.berlin_heute()
                               and (bm.gueltig_bis is null
                                    or bm.gueltig_bis >= app.berlin_heute())))) as ok`,
      [besitzer]);
    if (mitglied?.ok !== true) {
      throw new CrmFehler('Dieser Mensch arbeitet nicht in diesem Bereich.',
        'unbekannter_besitzer');
    }
  }
  if (prioritaet === null && besitzer === null) return;

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lead
        set prioritaet = coalesce($2::lead_prioritaet, prioritaet),
            besitzer_benutzer_id = coalesce($3::uuid, besitzer_benutzer_id),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [id, prioritaet, besitzer]);
  if (zeilen[0] === undefined) {
    throw new CrmFehler('Diesen Lead gibt es nicht.', 'nicht_gefunden', 404);
  }
}

/**
 * **Der Mensch hinter der Anfrage — wählen, anlegen, ansprechen** (V-141,
 * CRM-03, CRM-04, CRM-07, REQ-05, D-635).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lead.ansprechpartner_id` liess sich nach der Anlage nicht setzen. Nur die
 * Annahme eines Webformulars legte einen Kontakt an (0396); jeder Lead, der
 * von Hand, aus einer Empfehlung, aus dem Vergaberadar oder aus der Akquise
 * entstand, blieb für immer ohne. Das Leadblatt sagte „legen Sie den Kontakt
 * am Kunden an" — und der Lead zeigte danach trotzdem auf niemanden. Jeder
 * ausgehende Anruf und jede ausgehende E-Mail brach mit `kein_kontakt` ab,
 * auch nach „Als Kunde übernehmen", also gerade für die Quellen, die V-139
 * neu geschaffen hatte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was dieses Modul tut.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - Es setzt den Ansprechpartner eines Leads: einen Kontakt SEINES Kunden
 *    (`waehleLeadKontakt`) oder einen neuen (`legeLeadKontaktAn`) — mit der
 *    Regel der Annahme, dass eine bekannte E-Mail-Adresse ein bekannter Mensch
 *    ist.
 *  - Es hält eine Aktivität am Lead fest (`halteLeadAktivitaetFest`) und
 *    entscheidet dabei, mit welchem ZWECK ein ausgehender Kontakt durch das
 *    UWG-Tor geht (`LEAD_ZWECK_REGEL`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum der Zweck an der Herkunft hängt — und warum das eine offene Frage ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Route schrieb JEDE ausgehende Aktivität mit dem Zweck `vertraglich`.
 * Für eine Web-Anfrage stimmt das (D-631): wer um ein Angebot bittet, bekommt
 * darauf eine Antwort, und die hängt am Tor nicht an einer Werbeerlaubnis.
 * Solange nur Web-Leads einen Kontakt hatten, war das die ganze Wahrheit.
 * Sobald jeder Lead einen bekommt, wäre dieselbe Zeile ein Weg AM Werbetor
 * vorbei: ein recherchiertes Akquiseziel, dem niemand eine Frage gestellt
 * hat, liesse sich als „vertraglich" anrufen (§ 7 UWG) — genau das, was
 * `akquise/uebernahme.ts` ausschliessen will („wer diese Firma anschreiben
 * will, muss zuerst einen Kontakt anlegen und dessen Rechtsgrundlage
 * benennen").
 *
 * Ob eine Erfassung von Hand, eine Empfehlung oder eine Bekanntmachung selbst
 * schon eine Anfrage DES KONTAKTS ist, ist eine Rechtsfrage (Art. 6 Abs. 1
 * lit. b DSGVO, § 7 UWG) und wird hier nicht beantwortet. Bis zur Antwort
 * gilt der restriktive Zweig: `werbung`. Die Folge ist sichtbar und nie
 * lockerer als vorher — ein solcher Kontakt braucht eine festgestellte
 * Rechtsgrundlage mit Quelle und Datum, und das Leadblatt sagt es.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CrmFehler } from './anlegen.js';
import { istKennung } from './lead-kette.js';

// ---------------------------------------------------------------------------
// 1. Mit welchem Zweck geht ein ausgehender Kontakt durch das Tor?
// ---------------------------------------------------------------------------

export type AusgehenderZweck = 'vertraglich' | 'werbung';

export interface ZweckAntwort {
  readonly zweck: AusgehenderZweck;
  /**
   * `true`, solange die Zuordnung für diese Herkunft eine offene Frage ist
   * (O-907). Die Oberfläche nennt dann die Frage statt einer Regel.
   */
  readonly offen: boolean;
}

/**
 * Die Regel als Schnittstelle — die Antwort auf O-907 tauscht die
 * Umsetzung, nicht die Aufrufer.
 */
export interface LeadZweckRegel {
  zweckAusgehend(quelle: string): ZweckAntwort;
}

/**
 * **PLATZHALTER bis O-907.** Entschieden sind nur die beiden Ränder:
 *
 *  - `webformular` → `vertraglich` (D-631): der Mensch hat angefragt.
 *  - `akquise` → `werbung` (0171/0172, `akquise/uebernahme.ts`): recherchiert,
 *    niemand hat gefragt.
 *
 * Alles dazwischen geht den restriktiven Weg, bis der Mandant antwortet.
 */
export const PLATZHALTER_LEAD_ZWECK: LeadZweckRegel = {
  zweckAusgehend(quelle: string): ZweckAntwort {
    if (quelle === 'webformular') return { zweck: 'vertraglich', offen: false };
    if (quelle === 'akquise') return { zweck: 'werbung', offen: false };
    // TODO(client, O-907): Begründen eine Erfassung von Hand (nach einem Gespräch), eine Empfehlung eines Kunden oder eine Bekanntmachung im Vergaberadar eine Anfrage des Kontakts, sodass die Antwort vertraglich ist und nicht Werbung (Art. 6 Abs. 1 lit. b DSGVO, § 7 UWG)?
    return { zweck: 'werbung', offen: true };
  },
};

/** Die Regel, die gilt. Heute der Platzhalter — siehe O-907. */
export const LEAD_ZWECK_REGEL: LeadZweckRegel = PLATZHALTER_LEAD_ZWECK;

// ---------------------------------------------------------------------------
// 2. Den Ansprechpartner setzen.
// ---------------------------------------------------------------------------

/** Dieselbe Form wie der CHECK `ansprechpartner_email_form` (0020). */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;

function leer(wert: string | null | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

interface LeadKopf {
  readonly id: string;
  readonly kunde_id: string | null;
  readonly ansprechpartner_id: string | null;
}

/**
 * Den Lead sperren — zwei gleichzeitige Zuordnungen überschrieben einander
 * sonst still, und die Systemzeile nennte den falschen Menschen.
 */
async function sperreLead(kontext: SchreibKontext, leadId: string): Promise<LeadKopf> {
  if (!istKennung(leadId)) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }
  const [lead] = await kontext.abfrage<LeadKopf>(
    `select id::text as id, kunde_id::text as kunde_id,
            ansprechpartner_id::text as ansprechpartner_id
       from lead
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null
      for update`, [leadId]);
  if (lead === undefined) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }
  return lead;
}

async function zeigeAuf(
  kontext: SchreibKontext, leadId: string, kontaktId: string, notiz: string,
): Promise<void> {
  await kontext.schreibe(
    `update lead set ansprechpartner_id = $2::uuid, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [leadId, kontaktId]);
  /*
   * Eine Systemzeile, keine ausgehende: sie hält fest, WER ab jetzt der
   * Ansprechpartner ist, und stoppt die Reaktionsuhr nicht (0017).
   */
  await kontext.schreibe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff,
        akteur_art, benutzer_id, rechtsgrundlage_snapshot)
     values (app.aktiver_mandant(), $1::uuid, 'system', 'intern', 'intern', 'portal', $2,
             'mensch', app.aktueller_benutzer(), 'keine')`, [leadId, notiz]);
}

export interface KontaktWahlZeile {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
}

/**
 * Die Kontakte, die für diese Anfrage zur Wahl stehen: die des KUNDEN der
 * Anfrage, die noch im Unternehmen sind (V-110: Post an eine ausgeschiedene
 * Person liest ihr Nachfolger). Ohne Kunden gibt es nichts zu wählen — der
 * Kontakt wird dann angelegt und wandert mit, sobald die Anfrage einen Kunden
 * bekommt (`lead-kette.ts`, `nimmKontaktMit`).
 */
export async function leseLeadKontaktWahl(
  kontext: LeseKontext, leadId: string,
): Promise<readonly KontaktWahlZeile[]> {
  if (!istKennung(leadId)) return [];
  return kontext.abfrage<KontaktWahlZeile>(
    `select a.id::text as id,
            trim(coalesce(a.vorname, '') || ' ' || a.nachname) as name, a.email
       from lead l
       join ansprechpartner a
         on a.kunde_id = l.kunde_id and a.mandant_id = l.mandant_id
      where l.id = $1::uuid and l.mandant_id = app.aktiver_mandant()
        and a.archiviert_am is null and a.anonymisiert_am is null
        and a.ausgeschieden_am is null
      order by a.nachname, a.vorname limit 200`, [leadId]);
}

/**
 * **Einen Kontakt des Kunden wählen.**
 *
 * Der Kontakt gehört zum Kunden der Anfrage — oder, solange sie keinen hat,
 * zu keinem. Ein Kontakt eines ANDEREN Kunden wäre hier eine Zuordnung über
 * Kundengrenzen, die das Angebot danach ohnehin nicht nehmen könnte
 * (`angebot_ansprechpartner_fk`). Ein Kontakt, der ausgeschieden ist, wird
 * nicht gewählt: das Tor liesse an ihn nicht einmal die vertragliche Antwort
 * (V-110).
 */
export async function waehleLeadKontakt(
  kontext: SchreibKontext, leadId: string, ansprechpartnerId: string,
): Promise<void> {
  const lead = await sperreLead(kontext, leadId);
  if (!istKennung(ansprechpartnerId)) {
    throw new CrmFehler('Diesen Ansprechpartner gibt es in dieser Gesellschaft nicht.',
      'kontakt_unbekannt');
  }
  const [kontakt] = await kontext.abfrage<{
    id: string; kunde_id: string | null; name: string; ausgeschieden: boolean;
  }>(
    `select id::text as id, kunde_id::text as kunde_id,
            trim(coalesce(vorname, '') || ' ' || nachname) as name,
            ausgeschieden_am is not null as ausgeschieden
       from ansprechpartner
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null and anonymisiert_am is null`, [ansprechpartnerId]);
  if (kontakt === undefined) {
    throw new CrmFehler('Diesen Ansprechpartner gibt es in dieser Gesellschaft nicht.',
      'kontakt_unbekannt');
  }
  if (kontakt.ausgeschieden) {
    throw new CrmFehler(
      'Dieser Ansprechpartner ist aus dem Unternehmen ausgeschieden. Post an ihn liest sein '
      + 'Nachfolger — wählen Sie einen anderen.', 'kontakt_ausgeschieden');
  }
  if (kontakt.kunde_id !== lead.kunde_id) {
    throw new CrmFehler(
      'Dieser Ansprechpartner gehört nicht zum Kunden dieser Anfrage.', 'kontakt_fremd');
  }
  if (lead.ansprechpartner_id === kontakt.id) return;
  await zeigeAuf(kontext, lead.id, kontakt.id, `Ansprechpartner: ${kontakt.name}`);
}

export interface NeuerLeadKontakt {
  readonly vorname?: string | undefined;
  readonly nachname: string;
  readonly email?: string | undefined;
  readonly telefon?: string | undefined;
}

/**
 * **Einen Ansprechpartner anlegen — und die Anfrage auf ihn zeigen lassen.**
 *
 * Der Kontakt entsteht beim Kunden der Anfrage; hat sie noch keinen, ohne
 * Kunden (wie der Kontakt einer Web-Anfrage, 0396), und er wandert mit, wenn
 * sie einen bekommt.
 *
 * **Die Rechtsgrundlage ist `keine`.** Sie ist eine Feststellung mit Quelle
 * und Datum, die ein Mensch auf dem Kontaktblatt trifft
 * (`crm/kontakt-grundlage.ts`, eigenes Recht) — nicht eine Vorgabe, die ein
 * Anlegeformular nebenbei setzt (K-05, `crm/anlegen.ts`).
 *
 * **Ein Mensch, ein Kontakt** — dieselbe Regel wie in der Annahme (D-631):
 * gibt es im Bereich schon einen erreichbaren Kontakt mit derselben
 * E-Mail-Adresse, zeigt die Anfrage auf DEN, bevorzugt den ihres Kunden. Ein
 * Widerspruch, der an ihm steht, gilt dann auch hier. Ein Zwilling, der
 * ausgeschieden ist, wird nicht wiederbelebt — für denselben Kunden hält ihn
 * der Eindeutigkeitsschlüssel trotzdem, und die Seite sagt, warum.
 */
export async function legeLeadKontaktAn(
  kontext: SchreibKontext, leadId: string, eingabe: NeuerLeadKontakt,
): Promise<{ readonly id: string; readonly vorhanden: boolean }> {
  const lead = await sperreLead(kontext, leadId);
  const nachname = leer(eingabe.nachname);
  if (nachname === null) {
    throw new CrmFehler('Ein Ansprechpartner braucht einen Nachnamen.', 'nachname_fehlt');
  }
  const email = leer(eingabe.email);
  if (email !== null && !EMAIL.test(email)) {
    throw new CrmFehler('Diese E-Mail-Adresse ist nicht lesbar.', 'email_ungueltig');
  }

  if (email !== null) {
    const [zwilling] = await kontext.abfrage<{ id: string; name: string }>(
      `select a.id::text as id, trim(coalesce(a.vorname, '') || ' ' || a.nachname) as name
         from ansprechpartner a
        where a.mandant_id = app.aktiver_mandant() and lower(a.email) = lower($1)
          and a.archiviert_am is null and a.anonymisiert_am is null
          and a.ausgeschieden_am is null
        order by (a.kunde_id is not distinct from $2::uuid) desc, (a.kunde_id is null),
                 a.erstellt_am desc
        limit 1`, [email, lead.kunde_id]);
    if (zwilling !== undefined) {
      if (lead.ansprechpartner_id !== zwilling.id) {
        await zeigeAuf(kontext, lead.id, zwilling.id,
          `Ansprechpartner: ${zwilling.name} (vorhandener Kontakt mit derselben E-Mail-Adresse)`);
      }
      return { id: zwilling.id, vorhanden: true };
    }
  }

  const vorname = leer(eingabe.vorname);
  let neu: { id: string } | undefined;
  try {
    [neu] = await kontext.schreibe<{ id: string }>(
      `insert into ansprechpartner
         (mandant_id, kunde_id, vorname, nachname, email, telefon, rechtsgrundlage,
          erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2, $3, $4, $5, 'keine',
               app.aktueller_benutzer())
       returning id::text as id`,
      [lead.kunde_id, vorname, nachname, email, leer(eingabe.telefon)]);
  } catch (fehler) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23505' && f.constraint_name === 'ansprechpartner_email_uk') {
      throw new CrmFehler(
        'Unter dieser E-Mail-Adresse führt der Kunde schon einen Ansprechpartner, der aus dem '
        + 'Unternehmen ausgeschieden ist. Legen Sie den neuen Kontakt ohne diese Adresse an '
        + 'oder mit der Adresse, unter der er heute erreichbar ist.', 'kontakt_email_vergeben');
    }
    throw fehler;
  }
  if (neu === undefined) {
    throw new CrmFehler(
      'Der Ansprechpartner wurde nicht angelegt — fehlt das Schreibrecht?',
      'kein_schreibrecht', 403);
  }
  const name = vorname === null ? nachname : `${vorname} ${nachname}`;
  await zeigeAuf(kontext, lead.id, neu.id, `Ansprechpartner angelegt: ${name}`);
  return { id: neu.id, vorhanden: false };
}

// ---------------------------------------------------------------------------
// 3. Eine Aktivität festhalten.
// ---------------------------------------------------------------------------

export const AKTIVITAET_TYPEN = ['notiz', 'anruf', 'email', 'termin', 'aufgabe'] as const;
export const AKTIVITAET_RICHTUNGEN = ['intern', 'ausgehend', 'eingehend'] as const;

/**
 * Der Kanal, den eine Aktivität nach aussen nimmt — und nur der (V-137).
 *
 * Ein Anruf geht übers Telefon, eine E-Mail per E-Mail, ein Termin vor Ort.
 * Notiz und Aufgabe haben keine Richtung nach draussen: sie bleiben intern,
 * gleich was das Formular schickt. Ohne Kanal weist das UWG-Tor eine
 * ausgehende E-Mail oder einen Anruf ab (0020) — und das zu Recht.
 */
const KANAL: Readonly<Record<string, string>> = {
  anruf: 'telefon', email: 'email', termin: 'vor_ort',
};

export interface LeadAktivitaet {
  readonly typ: string;
  readonly richtung: string;
  readonly inhalt: string;
  readonly betreff?: string | undefined;
  readonly benutzerId: string;
}

/**
 * `betreff` ist NOT NULL, und das Formular fragt ihn nicht. Fehlt er, trägt
 * der Eintrag die ERSTE ZEILE der Notiz: das ist es, was in einer Liste
 * gelesen wird.
 */
export function betreffAus(inhalt: string, betreff?: string | null): string {
  const gegeben = leer(betreff);
  if (gegeben !== null) return gegeben;
  const ersteZeile = inhalt.split('\n')[0] ?? inhalt;
  return ersteZeile.length > 80 ? `${ersteZeile.slice(0, 79)}…` : ersteZeile;
}

/**
 * **Eine Aktivität am Lead festhalten — angelegt, nie geändert** (CRM-04).
 *
 * Ein ausgehender Anruf oder eine ausgehende E-Mail geht an den
 * Ansprechpartner der Anfrage und durch das UWG-Tor (0020), mit dem Zweck,
 * den `LEAD_ZWECK_REGEL` für ihre Herkunft nennt. Die erste ausgehende
 * Aktivität hält die Reaktionsuhr an (0017, REQ-05). Eingehendes geht am Tor
 * vorbei — es verlässt das Haus nicht — und bleibt `vertraglich` wie bisher.
 */
export async function halteLeadAktivitaetFest(
  kontext: SchreibKontext, leadId: string, eingabe: LeadAktivitaet,
): Promise<void> {
  if (!(AKTIVITAET_TYPEN as readonly string[]).includes(eingabe.typ)
      || !(AKTIVITAET_RICHTUNGEN as readonly string[]).includes(eingabe.richtung)) {
    throw new CrmFehler('Es fehlt eine Angabe.', 'unvollstaendig');
  }
  if (!istKennung(leadId)) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }
  const [lead] = await kontext.abfrage<{ quelle: string; ansprechpartner_id: string | null }>(
    `select quelle::text as quelle, ansprechpartner_id::text as ansprechpartner_id
       from lead where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [leadId]);
  if (lead === undefined) {
    throw new CrmFehler('Diese Anfrage gibt es nicht.', 'nicht_gefunden', 404);
  }

  const kanal = KANAL[eingabe.typ] ?? null;
  const richtung = kanal === null ? 'intern' : eingabe.richtung;
  const zweck = richtung === 'intern' ? 'intern'
    : richtung === 'ausgehend' ? LEAD_ZWECK_REGEL.zweckAusgehend(lead.quelle).zweck
      : 'vertraglich';
  const ansprechpartner = richtung === 'intern' ? null : lead.ansprechpartner_id;
  if (richtung === 'ausgehend' && ansprechpartner === null
      && (eingabe.typ === 'anruf' || eingabe.typ === 'email')) {
    throw new CrmFehler(
      'Ein ausgehender Anruf oder eine ausgehende E-Mail braucht einen Ansprechpartner.',
      'kein_kontakt');
  }

  try {
    await kontext.schreibe(
      `insert into lead_aktivitaet
         (mandant_id, lead_id, typ, richtung, betreff, inhalt, geschehen_am,
          benutzer_id, zweck, kanal, ansprechpartner_id)
       values (app.aktiver_mandant(), $1::uuid, $2::aktivitaet_typ,
               $3::aktivitaet_richtung, $4, $5, now(), $6::uuid,
               $7::kommunikationszweck, $8, $9::uuid)`,
      [leadId, eingabe.typ, richtung, betreffAus(eingabe.inhalt, eingabe.betreff),
        eingabe.inhalt, eingabe.benutzerId, zweck, richtung === 'intern' ? null : kanal,
        ansprechpartner]);
  } catch (grund: unknown) {
    /* Das UWG-Tor spricht als `insufficient_privilege` (42501). */
    if ((grund as { code?: unknown }).code === '42501') {
      throw new CrmFehler(
        'Dieser Kontakt ist über diesen Weg nicht zulässig (§ 7 UWG / Art. 21 DSGVO).',
        zweck === 'werbung' ? 'uwg_werbung' : 'uwg');
    }
    throw grund;
  }
}

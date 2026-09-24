/**
 * Kunden und Ansprechpartner ÄNDERN (V-017, V-018, V-019, V-087, CRM-01,
 * CRM-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: Stammdaten waren nach dem Anlegen unveränderlich.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `crm/anlegen.ts` legt an — und das war alles. Es gab keine Funktion, die
 * einen Kunden ändert. Ein Tippfehler im Firmennamen, ein Umzug, eine neue
 * USt-IdNr.: nichts davon war über die Plattform zu machen. Dasselbe beim
 * Ansprechpartner, wo nur die Rechtsgrundlage einen eigenen Weg hatte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Spalten fasst diese Datei NICHT an, und das ist der Kern von K-05.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen an `information_schema.column_privileges`: `cse_app` darf
 * `debitorennummer`, `zahlungsziel_tage`, `mahnsperre_bis` und
 * `mahnsperre_grund` **schreiben**, aber **nicht lesen**.
 *
 * Das ist kein Versehen, sondern die Absicherung: ein Formular, das den
 * ganzen Datensatz lädt und zurückschreibt, würde diese vier mit `null`
 * überschreiben — es hat sie ja nie gesehen. Eine gelöschte Mahnsperre ist
 * eine Mahnung an einen Kunden, mit dem gerade verhandelt wird.
 *
 * Deshalb: **diese Datei nennt die vier Spalten in keinem `UPDATE`.** Wer sie
 * ändern will, geht über `crm/kondition`, das `crm_entgelt.lesen`
 * zusätzlich verlangt. Zwei Wege, weil es zwei Berechtigungen sind.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Rechtsgrundlage ändert diese Datei ebenfalls nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie ist das Feld, aus dem `app.darf_kontaktiert_werden` seine Antwort zieht
 * (§ 7 UWG, LEG-08), und sie trägt ein Datum, das bezeugt, WANN sie erfasst
 * wurde. Ein Änderungsformular, das sie beiläufig mitschreibt, setzt dieses
 * Datum auf heute — und macht damit aus einer Einwilligung von 2024 eine von
 * heute. Sie hat ihren eigenen Weg und behält ihn.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { CrmFehler, firmaFuer, type KundeTyp } from './anlegen.js';

export type KundeStatus = 'aktiv' | 'inaktiv' | 'gesperrt';

export interface KundeAenderung {
  readonly id: string;
  readonly name: string;
  readonly typ: KundeTyp;
  readonly rechtsform?: string | undefined;
  readonly ustId?: string | undefined;
  readonly steuernummer?: string | undefined;
  readonly strasse?: string | undefined;
  readonly hausnummer?: string | undefined;
  readonly plz?: string | undefined;
  readonly ort?: string | undefined;
  readonly land?: string | undefined;
  readonly emailZentral?: string | undefined;
  readonly telefonZentral?: string | undefined;
  readonly webseite?: string | undefined;
  readonly notiz?: string | undefined;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

/**
 * Die Stammdaten eines Kunden ändern.
 *
 * **`ist_oeffentlicher_auftraggeber` folgt dem Typ und wird nicht getrennt
 * gepflegt** — genau wie beim Anlegen. Davon hängt ab, ob eine Rechnung als
 * XRechnung gestellt werden muss; zwei Felder, die dasselbe sagen können und
 * auseinanderlaufen dürfen, sind ein Fehler mit Ansage.
 */
export async function aendereKunde(
  kontext: SchreibKontext, eingabe: KundeAenderung,
): Promise<void> {
  const name = eingabe.name.trim();
  if (name === '') {
    throw new CrmFehler('Ein Kunde braucht einen Namen.', 'name_fehlt');
  }
  if (!['firma', 'behoerde', 'privat'].includes(eingabe.typ)) {
    throw new CrmFehler('Bitte wählen Sie eine Art.', 'typ_fehlt');
  }

  const zeilen = await kontext.schreibe<{
    id: string; firma_id: string | null; land: string;
  }>(
    `update kunde
        set name = $2, typ = $3::kunde_typ,
            ist_oeffentlicher_auftraggeber = ($3::kunde_typ = 'behoerde'),
            rechtsform = $4, ust_id = $5, steuernummer = $6,
            strasse = $7, hausnummer = $8, plz = $9, ort = $10,
            land = coalesce($11, land),
            email_zentral = $12, telefon_zentral = $13, webseite = $14,
            notiz = $15,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null
     returning id, firma_id::text as firma_id, land`,
    [eingabe.id, name, eingabe.typ, leer(eingabe.rechtsform), leer(eingabe.ustId),
      leer(eingabe.steuernummer), leer(eingabe.strasse), leer(eingabe.hausnummer),
      leer(eingabe.plz), leer(eingabe.ort), leer(eingabe.land),
      leer(eingabe.emailZentral), leer(eingabe.telefonZentral),
      leer(eingabe.webseite), leer(eingabe.notiz)],
  );
  const z = zeilen[0];
  if (z === undefined) {
    throw new CrmFehler(
      'Diesen Kunden gibt es nicht mehr, oder er ist bereits archiviert.',
      'kunde_unbekannt', 404);
  }

  /*
   * **Die Firma wird nachgetragen, nicht getauscht** (V-140, CRM-06, D-634).
   * Wer die USt-IdNr. nachreicht, verbindet den Kunden mit seiner Firma —
   * dieselbe Regel wie beim Anlegen (`firmaFuer`). Trägt der Kunde schon eine
   * Firma, bleibt sie: ein anderer Kunde einer anderen Gesellschaft kann an
   * derselben hängen, und eine berichtigte Nummer ist dann eine Frage der
   * Zusammenführung (`firma.zusammengefuehrt_in_firma_id`), nicht eines
   * stillen Umhängens.
   */
  if (z.firma_id === null) {
    /* Mit dem Land, das der Kunde JETZT trägt — dieselbe Regel wie 0401 (V-142). */
    const firmaId = await firmaFuer(kontext, eingabe.typ, name, leer(eingabe.ustId), z.land);
    if (firmaId !== null) {
      await kontext.schreibe(
        `update kunde set firma_id = $2::uuid
          where id = $1::uuid and mandant_id = app.aktiver_mandant()
            and firma_id is null and archiviert_am is null`,
        [eingabe.id, firmaId]);
    }
  }
}

/**
 * Den Stand eines Kunden setzen — und `gesperrt` ist die UWG-Werbesperre
 * (V-087, LEG-08).
 *
 * **Warum das nicht im Änderungsformular steht.** `gesperrt` heisst nicht
 * „inaktiv", sondern: an diesen Kunden geht **keine Werbung** mehr hinaus.
 * Das ist eine rechtliche Feststellung, keine Stammdatenpflege — sie gehört
 * an einen eigenen Knopf mit einem eigenen Satz daneben, nicht in ein
 * Auswahlfeld zwischen Strasse und Webseite.
 */
export async function setzeKundeStatus(
  kontext: SchreibKontext, id: string, status: KundeStatus,
): Promise<void> {
  if (!['aktiv', 'inaktiv', 'gesperrt'].includes(status)) {
    throw new CrmFehler('Unbekannter Stand.', 'status_unbekannt');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kunde
        set status = $2::kunde_status,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [id, status],
  );
  if (zeilen[0] === undefined) {
    throw new CrmFehler(
      'Diesen Kunden gibt es nicht mehr, oder er ist bereits archiviert.',
      'kunde_unbekannt', 404);
  }
}

/**
 * Einen Kunden archivieren (V-018).
 *
 * **Archivieren, nicht löschen** — dieselbe Begründung wie beim Objekt: an
 * einem Kunden hängen Aufträge, Angebote und Rechnungen, und ein `delete`
 * machte aus jeder Rechnung eine ohne Empfänger. Invariante 8 verbietet es im
 * Finanzbereich ohnehin.
 *
 * **Ein Kunde mit offenen Aufträgen wird nicht archiviert.** Sonst
 * verschwände der Auftraggeber unter einem laufenden Auftrag — und die
 * Rechnung dazu hätte niemanden mehr, an den sie geht.
 */
export async function archiviereKunde(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const [offen] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from auftrag a
      where a.kunde_id = $1::uuid and a.archiviert_am is null
        and a.status not in ('storniert', 'abgeschlossen')`,
    [id],
  );
  if (offen !== undefined && offen.anzahl !== '0') {
    throw new CrmFehler(
      `Zu diesem Kunden laufen noch ${offen.anzahl} Aufträge. Schliessen oder `
      + 'stornieren Sie diese zuerst — sonst hat eine Rechnung hinterher '
      + 'keinen Empfänger mehr.',
      'auftraege_offen', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kunde
        set archiviert_am = now(),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [id],
  );
  if (zeilen[0] === undefined) {
    throw new CrmFehler(
      'Diesen Kunden gibt es nicht mehr, oder er ist bereits archiviert.',
      'kunde_unbekannt', 404);
  }
}

export interface KontaktAenderung {
  readonly id: string;
  readonly nachname: string;
  readonly vorname?: string | undefined;
  readonly anrede?: string | undefined;
  readonly titel?: string | undefined;
  readonly position?: string | undefined;
  readonly abteilung?: string | undefined;
  readonly email?: string | undefined;
  readonly telefon?: string | undefined;
  readonly mobil?: string | undefined;
}

/**
 * Einen Ansprechpartner ändern (V-019).
 *
 * **Ohne `rechtsgrundlage`, ohne `einwilligung_kanaele`, ohne
 * `ist_hauptkontakt`.** Die ersten beiden haben ihren eigenen Weg (siehe
 * Kopf dieser Datei); der Hauptkontakt ist eine Eigenschaft des KUNDEN, nicht
 * des Kontakts — er kann nur einer sein, und ein Formular je Kontakt kann das
 * nicht sicherstellen.
 */
export async function aendereKontakt(
  kontext: SchreibKontext, eingabe: KontaktAenderung,
): Promise<void> {
  const nachname = eingabe.nachname.trim();
  if (nachname === '') {
    throw new CrmFehler('Ein Ansprechpartner braucht einen Nachnamen.', 'nachname_fehlt');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ansprechpartner
        set nachname = $2, vorname = $3, anrede = $4, titel = $5,
            position = $6, abteilung = $7,
            email = $8, telefon = $9, mobil = $10,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null and ausgeschieden_am is null
     returning id`,
    [eingabe.id, nachname, leer(eingabe.vorname), leer(eingabe.anrede),
      leer(eingabe.titel), leer(eingabe.position), leer(eingabe.abteilung),
      leer(eingabe.email), leer(eingabe.telefon), leer(eingabe.mobil)],
  );
  if (zeilen[0] === undefined) {
    throw new CrmFehler(
      'Diesen Ansprechpartner gibt es nicht mehr, oder er ist ausgeschieden.',
      'kontakt_unbekannt', 404);
  }
}

/**
 * Einen Ansprechpartner als ausgeschieden vermerken (V-019).
 *
 * **Nicht gelöscht, und das ist keine Förmlichkeit.** Der Name steht auf
 * unterschriebenen Leistungsnachweisen und in Auftragskorrespondenz. Was hier
 * passiert, ist eine Feststellung: ab heute geht nichts mehr an diese Person.
 *
 * `app.darf_kontaktiert_werden` prüft `ausgeschieden_am` mit — die Sperre
 * wirkt damit sofort und überall, nicht nur dort, wo jemand daran denkt.
 */
export async function scheideKontaktAus(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ansprechpartner
        set ausgeschieden_am = now(),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null and ausgeschieden_am is null
     returning id`,
    [id],
  );
  if (zeilen[0] === undefined) {
    throw new CrmFehler(
      'Diesen Ansprechpartner gibt es nicht mehr, oder er ist bereits ausgeschieden.',
      'kontakt_unbekannt', 404);
  }
}

/**
 * **Den Hauptkontakt eines Kunden bestimmen** (V-097, CRM-02).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ansprechpartner.ist_hauptkontakt` steht seit `0020` da, ein partieller
 * eindeutiger Index (`ansprechpartner_hauptkontakt_uk`) hält genau einen je
 * Kunde, das Kundenblatt zeigt das Etikett an — und gesetzt wurde die Spalte
 * NUR beim Anlegen des allerersten Kontakts. Wer den Hauptkontakt wechseln
 * wollte, weil die Objektleiterin gewechselt hat, konnte es nicht; das
 * Etikett blieb auf einem Menschen stehen, der das Haus verlassen hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das nicht in `aendereKontakt` gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Kopf jener Funktion sagt es und behält recht: der Hauptkontakt ist eine
 * Eigenschaft des KUNDEN, nicht des Kontakts. Es kann nur einer sein, und ein
 * Formular je Kontakt kann das nicht sicherstellen — zwei Menschen, die
 * gleichzeitig ihr eigenes Häkchen setzen, ergäben zwei Hauptkontakte oder,
 * mit dem Index, eine Fehlermeldung an der falschen Stelle.
 *
 * **Deshalb zuerst LÖSCHEN, dann setzen, in einer Anweisungsfolge.** Der
 * Index ist nicht aufgeschoben (`deferrable` steht nicht dabei): setzte man
 * erst den neuen, fiele die Eindeutigkeit, solange der alte noch steht. Beide
 * Anweisungen laufen in DERSELBEN Transaktion — der Aufrufer ist ein
 * `SchreibKontext`, und der ist eine.
 */
export async function setzeHauptkontakt(
  kontext: SchreibKontext, kundeId: string, ansprechpartnerId: string,
): Promise<void> {
  /*
   * Erst prüfen, DANN löschen: sonst stünde der Kunde nach einem Tippfehler
   * ohne Hauptkontakt da, und die Fehlermeldung erklärte nicht, dass der alte
   * dabei verlorenging.
   */
  const [ziel] = await kontext.abfrage<{ id: string }>(
    `select id from ansprechpartner
      where id = $1::uuid and kunde_id = $2::uuid
        and mandant_id = app.aktiver_mandant()
        and archiviert_am is null and ausgeschieden_am is null`,
    [ansprechpartnerId, kundeId]);
  if (ziel === undefined) {
    throw new CrmFehler(
      'Dieser Ansprechpartner gehört nicht zu diesem Kunden, oder er ist ausgeschieden.',
      'kontakt_unbekannt', 404);
  }

  await kontext.schreibe(
    `update ansprechpartner
        set ist_hauptkontakt = false,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where kunde_id = $1::uuid and mandant_id = app.aktiver_mandant()
        and ist_hauptkontakt and archiviert_am is null and id <> $2::uuid`,
    [kundeId, ansprechpartnerId]);

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update ansprechpartner
        set ist_hauptkontakt = true,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and kunde_id = $2::uuid
        and mandant_id = app.aktiver_mandant()
        and archiviert_am is null and ausgeschieden_am is null
     returning id`,
    [ansprechpartnerId, kundeId]);
  /*
   * Ein von RLS abgewiesenes UPDATE gibt null Zeilen zurück und wirft nicht.
   * Ohne diese Zeile meldete die Seite „gesetzt", und der Kunde stünde danach
   * ganz OHNE Hauptkontakt da — das Löschen darüber hätte gegriffen.
   */
  if (zeilen[0] === undefined) {
    throw new CrmFehler(
      'Der Hauptkontakt wurde nicht gesetzt — fehlt crm.schreiben in dieser Gesellschaft?',
      'abgewiesen', 403);
  }
}

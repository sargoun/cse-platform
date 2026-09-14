import 'server-only';
import type { SchreibKontext } from '../../../kontext/index.js';
import { gate, nutzlastHash, type Freigabe, type Nutzlast, type Richtlinie }
  from '../../../agent/policy.js';
import type { Speicher } from '../../../storage/adapter.js';
import { ladeHoch } from '../../dokument/upload.js';
import { schreibeTextPdf } from '../../dokument/pdf.js';
import { erteileFreigabe } from '../../freigabe/erteilen.js';
import { cent, formatiereGeld, type Cent } from '../geld.js';

/**
 * Der Weg einer Mahnung vom Entwurf bis zum Briefkasten (FIN-15,
 * `05-FINANZEN.md` §10, PR 55).
 *
 * **Der Lauf schlägt vor, ein Mensch entscheidet, und erst danach geht etwas
 * hinaus.** `lauf.ts` erzeugt Entwürfe; hier sind die drei Schritte, die ein
 * Mensch auslöst:
 *
 *   1. `verwirf` — der Entwurf war falsch, und der Grund bleibt stehen.
 *   2. `gibFrei` — die Freigabe nach K-13 entsteht, DANN kippt der Zustand,
 *      und erst dabei zieht die Datenbank die Nummer. Ein Entwurf trägt
 *      keine (`mahnung_entwurf_ohne_nummer`).
 *   3. `dokumentiereVersand` — der Versand geht durch `agent/policy.ts`
 *      (Invariante 7), das Schreiben wird als PDF abgelegt, und erst danach
 *      steht das Absendedatum. Der Auslöser `mahnung_2_versand` schreibt
 *      dann `letzte_mahnstufe` und `letzte_mahnung_am` auf den Posten fort —
 *      das ist der Zeitpunkt, ab dem §286 BGB den Verzug laufen lässt.
 *
 * **Es gibt keinen Mailversand, und es wird keiner vorgetäuscht.** Die
 * Mahnung geht als Brief, Einschreiben oder durch Boten hinaus; ein Mensch
 * tut das und dokumentiert es hier. `e_mail` und `portal` werden abgewiesen,
 * solange kein Kanal verbunden ist — und das Kundenportal zeigt ohnehin keine
 * Mahnungen (§7.5).
 *
 * **Gerechnet wird hier nichts.** Beträge stehen auf der Mahnung, seit der
 * Lauf sie geschrieben hat; dieser Dienst liest sie und stellt sie dar.
 */

export type MahnungStatus =
  'entwurf' | 'freigegeben' | 'versendet' | 'erledigt' | 'verworfen';

export type Versandart = 'brief' | 'einschreiben' | 'bote' | 'e_mail' | 'portal';

/** Die Kanäle, die ein MENSCH bedient — hier wird dokumentiert, nicht gesendet. */
export const MENSCHLICHE_KANAELE: readonly Versandart[] = ['brief', 'einschreiben', 'bote'];

export class KanalNichtVerbundenFehler extends Error {
  readonly code = 'KANAL_NICHT_VERBUNDEN' as const;
  constructor(readonly kanal: Versandart) {
    super(
      `Der Kanal „${kanal}" ist nicht verbunden. Es gibt in dieser Anwendung `
      + 'keinen automatischen Versand (O-116); die Mahnung geht als Brief, '
      + 'Einschreiben oder durch Boten hinaus und wird hier dokumentiert.',
    );
    this.name = 'KanalNichtVerbundenFehler';
  }
}

export class MahnungFehler extends Error {
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'kein_entwurf' | 'nicht_freigegeben'
      | 'schon_versendet' | 'ohne_position' | 'ohne_grund'
      | 'zeichen_nicht_darstellbar',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'MahnungFehler';
  }
}

export interface MahnungZeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly kundeId: string;
  readonly kundeName: string;
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly status: MahnungStatus;
  readonly mahndatum: string;
  readonly zahlbarBis: string;
  readonly forderungCent: Cent;
  readonly gebuehrCent: Cent;
  readonly zinsenCent: Cent;
  readonly gesamtCent: Cent;
  readonly versendetAm: string | null;
  readonly verworfenGrund: string | null;
  readonly stufensprungGrund: string | null;
}

export interface MahnungPositionZeile {
  readonly rechnungsnummer: string | null;
  readonly offenCent: Cent;
  readonly faelligAm: string;
  readonly verzugsbeginnAm: string | null;
  readonly verzugstage: number;
  readonly zinsBp: number;
  readonly zinsCent: Cent;
}

const KOPF_SQL = `
  select m.id, m.nummer, m.kunde_id, k.name as kunde_name, m.stufe,
         ms.bezeichnung, m.status::text as status,
         m.mahndatum::text as mahndatum, m.zahlbar_bis::text as zahlbar_bis,
         m.forderung_cent::text, m.gebuehr_cent::text, m.zinsen_cent::text,
         m.gesamt_cent::text, m.versendet_am::text as versendet_am,
         m.verworfen_grund, m.stufensprung_grund
    from mahnung m
    join kunde k on k.id = m.kunde_id and k.mandant_id = m.mandant_id
    join mahnstufe ms on ms.id = m.mahnstufe_id and ms.mandant_id = m.mandant_id`;

interface KopfRoh {
  id: string; nummer: string | null; kunde_id: string; kunde_name: string;
  stufe: number; bezeichnung: string; status: string; mahndatum: string;
  zahlbar_bis: string; forderung_cent: string; gebuehr_cent: string;
  zinsen_cent: string; gesamt_cent: string; versendet_am: string | null;
  verworfen_grund: string | null; stufensprung_grund: string | null;
}

function zuZeile(r: KopfRoh): MahnungZeile {
  return {
    id: r.id, nummer: r.nummer, kundeId: r.kunde_id, kundeName: r.kunde_name,
    stufe: r.stufe, bezeichnung: r.bezeichnung, status: r.status as MahnungStatus,
    mahndatum: r.mahndatum, zahlbarBis: r.zahlbar_bis,
    forderungCent: cent(BigInt(r.forderung_cent)),
    gebuehrCent: cent(BigInt(r.gebuehr_cent)),
    zinsenCent: cent(BigInt(r.zinsen_cent)),
    gesamtCent: cent(BigInt(r.gesamt_cent)),
    versendetAm: r.versendet_am, verworfenGrund: r.verworfen_grund,
    stufensprungGrund: r.stufensprung_grund,
  };
}

export async function mahnungen(
  kontext: SchreibKontext, status?: MahnungStatus,
): Promise<readonly MahnungZeile[]> {
  const zeilen = await kontext.abfrage<KopfRoh>(
    `${KOPF_SQL}
      where ($1::text is null or m.status::text = $1)
      order by m.mahndatum desc, k.name`,
    [status ?? null]);
  return zeilen.map(zuZeile);
}

export async function findeMahnung(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly kopf: MahnungZeile;
             readonly positionen: readonly MahnungPositionZeile[] } | null> {
  const [kopf] = await kontext.abfrage<KopfRoh>(`${KOPF_SQL} where m.id = $1::uuid`, [id]);
  if (kopf === undefined) return null;

  const roh = await kontext.abfrage<{
    rechnungsnummer: string | null; offener_betrag_cent: string; faellig_am: string;
    verzugsbeginn_am: string | null; verzugstage: number; zins_bp: number; zins_cent: string;
  }>(
    `select r.nummer as rechnungsnummer, mp.offener_betrag_cent::text,
            mp.faellig_am::text as faellig_am,
            mp.verzugsbeginn_am::text as verzugsbeginn_am,
            mp.verzugstage, mp.zins_bp, mp.zins_cent::text
       from mahnung_position mp
       join rechnung r on r.id = mp.rechnung_id and r.mandant_id = mp.mandant_id
      where mp.mahnung_id = $1::uuid
      order by mp.faellig_am, r.nummer`, [id]);

  return {
    kopf: zuZeile(kopf),
    positionen: roh.map((p) => ({
      rechnungsnummer: p.rechnungsnummer,
      offenCent: cent(BigInt(p.offener_betrag_cent)),
      faelligAm: p.faellig_am,
      verzugsbeginnAm: p.verzugsbeginn_am,
      verzugstage: p.verzugstage,
      zinsBp: p.zins_bp,
      zinsCent: cent(BigInt(p.zins_cent)),
    })),
  };
}

/** Ein Entwurf, der nicht hinausgehen soll — mit genanntem Grund (Invariante 8). */
export async function verwirf(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 5) {
    throw new MahnungFehler(
      'ohne_grund',
      'Ein verworfener Entwurf nennt seinen Grund — er steht später allein da, '
      + 'wenn jemand fragt, warum nicht gemahnt wurde.');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update mahnung
        set status = 'verworfen', verworfen_grund = $2,
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'entwurf'
      returning id`, [id, grund.trim()]);
  if (zeilen.length === 0) {
    throw new MahnungFehler(
      'kein_entwurf',
      'Nur ein Entwurf wird verworfen — eine freigegebene Mahnung trägt eine Nummer.');
  }
}

/**
 * Die Nutzlast, über die entschieden wird — und die das Tor beim Versand
 * wiedererkennen muss.
 *
 * **Ohne die Nummer, und das ist kein Versehen.** Die Nummer entsteht erst
 * DURCH die Freigabe (der Auslöser zieht sie beim Zustandswechsel), sie kann
 * also zum Zeitpunkt der Entscheidung nicht darin stehen. Sie ist auch nichts,
 * worüber ein Mensch entscheidet: sie kommt lückenlos aus dem Zähler. Was ein
 * Mensch entscheidet, steht hier — Empfänger, Stufe, jede geforderte Position
 * und jeder Betrag.
 */
export function mahnungNutzlast(
  mandantId: string, kopf: MahnungZeile, positionen: readonly MahnungPositionZeile[],
): Nutzlast {
  return {
    aktion: 'mahnung_senden',
    mandantId,
    betragCent: kopf.gesamtCent,
    inhalt: {
      mahnungId: kopf.id,
      kundeId: kopf.kundeId,
      kunde: kopf.kundeName,
      stufe: kopf.stufe,
      bezeichnung: kopf.bezeichnung,
      mahndatum: kopf.mahndatum,
      zahlbarBis: kopf.zahlbarBis,
      forderungCent: String(kopf.forderungCent),
      gebuehrCent: String(kopf.gebuehrCent),
      zinsenCent: String(kopf.zinsenCent),
      gesamtCent: String(kopf.gesamtCent),
      positionen: positionen.map((p) => ({
        rechnung: p.rechnungsnummer,
        offenCent: String(p.offenCent),
        faelligAm: p.faelligAm,
        verzugstage: p.verzugstage,
        zinsBp: p.zinsBp,
        zinsCent: String(p.zinsCent),
      })),
    },
  };
}

/**
 * Die menschliche Freigabe — K-13 und Invariante 7 in einem Schritt.
 *
 * Der Abdruck im Schnappschuss ist `policy.nutzlastHash`, NICHT der
 * allgemeine Abdruck des Freigabedienstes: das Tor beim Versand vergleicht
 * gegen genau diesen Wert. Zwei Kanonisierungen derselben Nutzlast hiessen,
 * dass eine erteilte Freigabe nie zu dem passt, was hinausgeht.
 */
export async function gibFrei(
  kontext: SchreibKontext, id: string, begruendung: string,
): Promise<{ readonly freigabeId: string; readonly nummer: string }> {
  const vorgang = await findeMahnung(kontext, id);
  if (vorgang === null) throw new MahnungFehler('nicht_gefunden', 'Nicht gefunden.');
  if (vorgang.kopf.status !== 'entwurf') {
    throw new MahnungFehler(
      'kein_entwurf', `Diese Mahnung steht auf „${vorgang.kopf.status}".`);
  }
  if (vorgang.positionen.length === 0) {
    throw new MahnungFehler(
      'ohne_position', 'Eine Mahnung ohne Position fordert nichts.');
  }

  const nutzlast = mahnungNutzlast(kontext.aktiverMandantId, vorgang.kopf, vorgang.positionen);
  const freigabeId = await erteileFreigabe(
    { abfrage: kontext.schreibe.bind(kontext) },
    {
      aktion: 'mahnung_senden',
      inhalt: nutzlast.inhalt,
      begruendung,
      abdruck: nutzlastHash(nutzlast),
    });

  const [zeile] = await kontext.schreibe<{ nummer: string | null }>(
    `update mahnung
        set status = 'freigegeben', freigabe_id = $2::uuid,
            freigegeben_am = now(), freigegeben_von = app.aktueller_benutzer(),
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'entwurf'
      returning nummer`, [id, freigabeId]);
  if (zeile?.nummer == null) {
    throw new MahnungFehler(
      'kein_entwurf', 'Die Freigabe hat keine Nummer gezogen — der Zustand blieb stehen.');
  }
  return { freigabeId, nummer: zeile.nummer };
}

/** Der Brief, wie er hinausgeht — dieselbe Quelle wie die Nutzlast. */
export function mahnungstext(
  kopf: MahnungZeile, positionen: readonly MahnungPositionZeile[],
): string {
  const zeilen: string[] = [];
  zeilen.push(`${kopf.bezeichnung} — ${kopf.nummer ?? '(ohne Nummer)'}`);
  zeilen.push('');
  zeilen.push(`Kunde: ${kopf.kundeName}`);
  zeilen.push(`Datum: ${kopf.mahndatum}`);
  zeilen.push('');
  zeilen.push('Offene Forderungen:');
  for (const p of positionen) {
    const zins = p.zinsCent === 0n
      ? ''
      : `, Verzugszins ${formatiereGeld(p.zinsCent)} `
        + `(${String(p.verzugstage)} Tage, ${String(p.zinsBp)} Basispunkte)`;
    zeilen.push(
      `  · Rechnung ${p.rechnungsnummer ?? '—'}, fällig am ${p.faelligAm}: `
      + `${formatiereGeld(p.offenCent)}${zins}`);
  }
  zeilen.push('');
  zeilen.push(`Forderung:      ${formatiereGeld(kopf.forderungCent)}`);
  zeilen.push(`Mahngebühr:     ${formatiereGeld(kopf.gebuehrCent)}`);
  zeilen.push(`Verzugszinsen:  ${formatiereGeld(kopf.zinsenCent)}`);
  zeilen.push(`Gesamtbetrag:   ${formatiereGeld(kopf.gesamtCent)}`);
  zeilen.push('');
  zeilen.push(`Wir bitten um Ausgleich bis zum ${kopf.zahlbarBis}.`);
  return zeilen.join('\n');
}

export interface VersandEingabe {
  readonly id: string;
  readonly versandart: Versandart;
  readonly empfaenger: string;
}

/**
 * Dokumentiert den Versand — nach dem Tor, nicht davor.
 *
 * Die Reihenfolge ist dieselbe wie bei der Behinderungsanzeige, und aus
 * demselben Grund:
 *
 *   1. Kanal prüfen — ein nicht verbundener wird abgewiesen, BEVOR etwas
 *      entsteht.
 *   2. Freigabe laden und `gate()` fragen, mit dem Abdruck über die Nutzlast,
 *      wie sie JETZT in der Datenbank steht.
 *   3. Das PDF erzeugen und ablegen — ist der Speicher nicht verbunden,
 *      bricht es hier ab, und die Mahnung bleibt „freigegeben".
 *   4. Erst danach das Absendedatum. Der Auslöser schreibt dann den Posten
 *      fort, und ab diesem Tag läuft der Verzug.
 *
 * Wer 4 vor 3 stellt, hat eine versendete Mahnung ohne archiviertes
 * Schreiben; wer 2 nach 4 stellt, hat sie ohne Freigabe verschickt.
 */
export async function dokumentiereVersand(
  kontext: SchreibKontext,
  eingabe: VersandEingabe,
  speicher: Speicher,
  richtlinie: Richtlinie | null = null,
): Promise<{ readonly dokumentId: string; readonly versendetAm: string }> {
  if (!MENSCHLICHE_KANAELE.includes(eingabe.versandart)) {
    throw new KanalNichtVerbundenFehler(eingabe.versandart);
  }

  const vorgang = await findeMahnung(kontext, eingabe.id);
  if (vorgang === null) throw new MahnungFehler('nicht_gefunden', 'Nicht gefunden.');
  if (vorgang.kopf.status === 'versendet' || vorgang.kopf.versendetAm !== null) {
    throw new MahnungFehler(
      'schon_versendet',
      'Diese Mahnung ist hinausgegangen. Eine zweite Mahnung ist die nächste Stufe, '
      + 'kein zweiter Versand.');
  }
  if (vorgang.kopf.status !== 'freigegeben') {
    throw new MahnungFehler(
      'nicht_freigegeben',
      `Diese Mahnung steht auf „${vorgang.kopf.status}" — es geht nur hinaus, was `
      + 'freigegeben ist (Invariante 7).');
  }

  const [freigabeZeile] = await kontext.abfrage<{
    id: string; aktion: string; status: string; freigegeben_von: string | null;
    nutzlast_hash: string | null;
  }>(
    `select f.id, f.aktion, f.status::text as status, f.freigegeben_von,
            (select s.nutzlast_hash from freigabe_snapshot s
              where s.freigabe_id = f.id and s.mandant_id = f.mandant_id
              order by s.kette_nr desc limit 1) as nutzlast_hash
       from freigabe f
       join mahnung m on m.freigabe_id = f.id and m.mandant_id = f.mandant_id
      where m.id = $1::uuid`, [eingabe.id]);

  const nutzlast = mahnungNutzlast(
    kontext.aktiverMandantId, vorgang.kopf, vorgang.positionen);
  const freigabe: Freigabe | null = freigabeZeile === undefined ? null : {
    id: freigabeZeile.id,
    aktion: freigabeZeile.aktion as Freigabe['aktion'],
    mandantId: kontext.aktiverMandantId,
    status: freigabeZeile.status as Freigabe['status'],
    freigegebenVon: freigabeZeile.freigegeben_von,
    nutzlastHash: freigabeZeile.nutzlast_hash ?? '',
  };

  const entscheidung = gate(nutzlast, freigabe, richtlinie);
  if (!entscheidung.erlaubt) throw entscheidung.fehler;

  const pdf = schreibeTextPdf({
    titel: `Mahnung ${vorgang.kopf.nummer ?? ''} — ${vorgang.kopf.kundeName}`,
    text: mahnungstext(vorgang.kopf, vorgang.positionen),
  });
  if (pdf.ersetzteZeichen > 0) {
    throw new MahnungFehler(
      'zeichen_nicht_darstellbar',
      `${String(pdf.ersetzteZeichen)} Zeichen des Schreibens lassen sich in der Schrift `
      + 'des PDF nicht darstellen und stünden als Fragezeichen darin. Es wurde NICHTS '
      + 'abgelegt und kein Absendedatum gesetzt.');
  }

  const [jahr] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from app.berlin_heute())::int as jahr`);
  if (jahr === undefined) {
    throw new Error('Die Datenbank lieferte kein Berliner Kalenderjahr.');
  }

  const hoch = await ladeHoch(
    {
      mandantId: kontext.aktiverMandantId,
      kategorie: 'buchhaltung',
      titel: `Mahnung ${vorgang.kopf.nummer ?? ''} (${vorgang.kopf.kundeName})`,
      dateiname: `mahnung-${vorgang.kopf.nummer ?? vorgang.kopf.id}.pdf`,
      daten: pdf.bytes,
      behaupteterTyp: 'application/pdf',
    },
    speicher, jahr.jahr);

  /**
   * **Ab hier liegt ein Brief im Bucket, den die Transaktion nicht mehr
   * zurücknehmen kann.**
   *
   * Vier Schreibvorgänge folgen — `dokument`, `dokument_version`, der
   * Zustandswechsel der Mahnung und die Versandzeile. Scheitert einer davon
   * (der Zustand hat sich geändert, ein Auslöser weist ab), rollt alles
   * zurück und dieses PDF bleibt: ein Mahnschreiben mit Name, Betrag und
   * Zahlungsfrist eines Kunden, auf das keine Zeile zeigt. Es ist unauffindbar
   * und deshalb auch nicht löschbar — genau die Sorte Datenbestand, die eine
   * Auskunft nach Art. 15 DSGVO nicht beantworten kann.
   *
   * Der Rest der Funktion läuft deshalb in einem `try`, und das `catch`
   * entfernt das Objekt, bevor es den Fehler weiterreicht. Dieselbe
   * Vorrichtung wie beim Schichtfoto (`api/check-in/[token]/medien`).
   */
  try {

    /**
     * Zwei Zeilen, weil das Schema sie so fuehrt (0009): `dokument` traegt
     * Titel, Kategorie und Aufbewahrung, `dokument_version` die Fassung mit
     * ihrem SHA-256. Der Digest ist hier kein Beiwerk — der Brief ist das
     * Beweisstueck fuer den Verzugsbeginn, und ohne Pruefsumme laesst sich
     * spaeter nicht zeigen, dass die abgelegte Datei noch dieselbe ist.
     */
    await kontext.schreibe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                             mime_verifiziert, groesse_bytes, bucket,
                             objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                             loeschsperre, kunde_id, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, $8, $9::date, $10, $11::uuid, app.aktueller_benutzer())`,
      [hoch.dokumentId, kontext.aktiverMandantId,
       `Mahnung ${vorgang.kopf.nummer ?? ''} (${vorgang.kopf.kundeName})`,
       hoch.mimeTyp, String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
       hoch.exifEntfernt, hoch.aufbewahrungBis, hoch.loeschsperre,
       vorgang.kopf.kundeId]);
    await kontext.schreibe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ, erstellt_von)
       values ($1::uuid, $2::uuid, 1, $3, $4, $5::bigint, $6, app.aktueller_benutzer())`,
      [kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
       hoch.sha256, String(hoch.groesseBytes), hoch.mimeTyp]);

    const [nachher] = await kontext.schreibe<{ versendet_am: string }>(
      `update mahnung
          set status = 'versendet', versendet_am = now(), dokument_id = $2::uuid,
              geaendert_am = now(), geaendert_von_art = 'mensch',
              geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid and status = 'freigegeben'
        returning versendet_am::text as versendet_am`,
      [eingabe.id, hoch.dokumentId]);
    if (nachher === undefined) {
      throw new MahnungFehler(
        'nicht_freigegeben', 'Der Zustand hat sich zwischenzeitlich geändert.');
    }

    /** Der einzige Ausgang trägt seine Freigabe (0012, `versand`). */
    await kontext.schreibe(
      `insert into versand (mandant_id, freigabe_id, aktion, kanal, empfaenger,
                            nutzlast_hash, gesendet_am, ergebnis)
       values ($1::uuid, $2::uuid, 'mahnung_senden', $3, $4, $5, now(), 'dokumentiert')`,
      [kontext.aktiverMandantId, freigabe?.id ?? null, eingabe.versandart,
       eingabe.empfaenger, nutzlastHash(nutzlast)]);

      return { dokumentId: hoch.dokumentId, versendetAm: nachher.versendet_am };
  } catch (fehler) {
    try {
      await speicher.entferne(hoch.bucket, hoch.objektSchluessel);
    } catch {
      /*
       * Auch das Aufräumen kann scheitern. Dann bleibt ein verwaistes Objekt —
       * und es bleibt AUFFINDBAR: es steht in keiner `dokument`-Zeile, und
       * genau daran erkennt es der Waisenlauf. Den ursprünglichen Fehler
       * verdeckt dieser zweite auf keinen Fall.
       */
    }
    throw fehler;
  }
}

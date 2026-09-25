/**
 * Die verlangten Nachweise eines Postens, einer Veranstaltung, eines Objekts
 * oder der ganzen Gesellschaft — `einsatzanforderung` (SEC-01, SEC-04, SEC-08,
 * V-179, D-673).
 *
 * **Der Befund.** Das SEC-04-Tor (`app.einsatz_qualifikation_erfuellt`, 0031)
 * liest seine Anforderungen aus dieser Tabelle — und fuer sie gab es keinen
 * Dienst, keine Route und kein Formular. Ohne Zeile meldet das Tor `erfuellt`
 * fuer jede Einteilung, und die harte Sperre bei abgelaufener
 * §34a-Sachkunde trat in keinem Mandanten je ein. Die Postenseite sagte
 * „angelegt werden sie woanders", und ein solches Woanders gab es nicht.
 *
 * **Was hier entschieden wird und was nicht.** WELCHE Qualifikation ein
 * Posten verlangt, entscheidet die Gesellschaft (O-342) — dieser Dienst legt
 * ab, was ein Mensch mit `security.schreiben` einträgt, und sagt dazu, ob er
 * es als bestätigt eingetragen hat (`ist_platzhalter`, §1.16). Er erfindet
 * keine Anforderung und keine Frist.
 *
 * **Vier Geltungsbereiche, additiv** (0031): eine Postenanforderung hebt die
 * des Objekts und die mandantenweite nicht auf. Welcher Bereich gemeint ist,
 * sagt das Formular; WORAN er haengt, loest dieser Dienst aus dem Posten oder
 * der Veranstaltung auf, auf deren Seite das Formular steht — nie aus einer
 * Objektkennung aus der Anfrage.
 *
 * **Die Schichten ziehen nach, die Vergangenheit nicht** (V-129, D-624).
 * Einen neuen oder archivierten Eintrag uebernimmt der Ausloeser aus `0465`
 * in den Schnappschuss jeder KUENFTIGEN Schicht des Bereichs und bewertet
 * deren Mischung neu; eine Schicht, die schon begonnen hat, bleibt bei dem,
 * was damals verlangt war. Das harte Tor selbst liest ohnehin live.
 *
 * **Geloescht wird nicht** — archiviert (`trg_einsatzanforderung_kein_hard_delete`).
 * Eine Schicht, deren Schnappschuss die Anforderung nennt, soll sie auch
 * spaeter noch benennen koennen.
 */
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export const ANFORDERUNG_BEREICHE = ['posten', 'veranstaltung', 'objekt', 'mandant'] as const;
export type AnforderungBereich = (typeof ANFORDERUNG_BEREICHE)[number];

export const ANFORDERUNG_GELTUNGEN = ['jeder', 'mindestens_einer'] as const;
export type AnforderungGeltung = (typeof ANFORDERUNG_GELTUNGEN)[number];

export function istAnforderungBereich(wert: unknown): wert is AnforderungBereich {
  return typeof wert === 'string' && (ANFORDERUNG_BEREICHE as readonly string[]).includes(wert);
}

export function istAnforderungGeltung(wert: unknown): wert is AnforderungGeltung {
  return typeof wert === 'string' && (ANFORDERUNG_GELTUNGEN as readonly string[]).includes(wert);
}

/** Die Gruende einer Abweisung — sie reisen als `?fehler=` zurueck (D-599). */
export type AnforderungGrund =
  | 'unvollstaendig'
  | 'nicht_gefunden'
  | 'qualifikation_unbekannt'
  | 'kein_objekt'
  | 'bereich_passt_nicht'
  | 'sperre_nur_jeder'
  | 'doppelt'
  | 'schon_archiviert';

export class AnforderungFehler extends Error {
  readonly code: AnforderungGrund;
  constructor(
    readonly grund: AnforderungGrund,
    nachricht: string,
    readonly status: number = grund === 'nicht_gefunden' || grund === 'qualifikation_unbekannt'
      ? 404 : grund === 'doppelt' || grund === 'schon_archiviert' ? 409 : 422,
  ) {
    super(nachricht);
    this.code = grund;
    this.name = 'AnforderungFehler';
  }
}

/** Von welcher Seite aus eingetragen wird — sie bestimmt Posten, Veranstaltung und Objekt. */
export interface AnforderungHerkunft {
  readonly art: 'posten' | 'veranstaltung';
  readonly id: string;
}

export interface AnforderungEingabe {
  readonly herkunft: AnforderungHerkunft;
  readonly bereich: AnforderungBereich;
  readonly qualifikationId: string;
  /** `true` = harte Sperre (SEC-04), `false` = Warnung. */
  readonly zwingend: boolean;
  readonly geltung: AnforderungGeltung;
  /** Nur bei `mindestens_einer` von Bedeutung; sonst 1. */
  readonly mindestanzahl: number;
  /** SEC-03: zusaetzlich eine lebende Eintragung im Bewacherregister. */
  readonly bewacherregisterPflicht: boolean;
  /** `JJJJ-MM-TT`, Berliner Kalendertag — ab wann die Anforderung gilt. */
  readonly gueltigAb: string | null;
  /** Anzeigetext, z. B. „§ 34a Abs. 1a GewO". Nie Grundlage einer Entscheidung. */
  readonly rechtsgrundlage: string | null;
  /** Aus Vertrag oder Dienstanweisung bestaetigt? Sonst bleibt sie als unbestaetigt markiert. */
  readonly bestaetigt: boolean;
}

const KALENDERTAG = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Prueft die Eingabe, BEVOR die Datenbank es tut — mit einem Satz statt
 * einer Bedingungsverletzung. Rein, ohne Datenbank.
 */
export function pruefeAnforderungEingabe(e: AnforderungEingabe): AnforderungEingabe {
  if (e.bereich === 'posten' && e.herkunft.art !== 'posten') {
    throw new AnforderungFehler('bereich_passt_nicht',
      'Eine Postenanforderung wird auf der Seite des Postens eingetragen.');
  }
  if (e.bereich === 'veranstaltung' && e.herkunft.art !== 'veranstaltung') {
    throw new AnforderungFehler('bereich_passt_nicht',
      'Eine Veranstaltungsanforderung wird auf der Seite der Veranstaltung eingetragen.');
  }
  /*
   * `ea_geltung_zwischenstand` (0031): eine harte Sperre mit
   * „mindestens eine Person" prueft zur Schreibzeit niemand — das Tor kennt
   * je Zuordnung nur `jeder`, die Schichtpruefung aus §9.4 gibt es nicht.
   * Die Sperre gaelte stillschweigend nicht. Also nur als Warnung.
   */
  if (e.zwingend && e.geltung !== 'jeder') {
    throw new AnforderungFehler('sperre_nur_jeder',
      'Eine Sperre gilt heute für jede eingesetzte Person. „Mindestens eine Person" '
      + 'lässt sich als Warnung eintragen, bis die Prüfung der ganzen Schicht gebaut ist.');
  }
  if (!Number.isInteger(e.mindestanzahl) || e.mindestanzahl < 1 || e.mindestanzahl > 99) {
    throw new AnforderungFehler('unvollstaendig',
      'Die Mindestanzahl ist eine ganze Zahl von 1 bis 99.');
  }
  if (e.gueltigAb !== null && !KALENDERTAG.test(e.gueltigAb)) {
    throw new AnforderungFehler('unvollstaendig', 'Gültig ab ist ein Datum.');
  }
  if (e.qualifikationId.trim() === '') {
    throw new AnforderungFehler('unvollstaendig', 'Welche Qualifikation wird verlangt?');
  }
  const text = (e.rechtsgrundlage ?? '').trim();
  return {
    ...e,
    mindestanzahl: e.geltung === 'jeder' ? 1 : e.mindestanzahl,
    rechtsgrundlage: text === '' ? null : text,
  };
}

interface Herkunftszeile {
  readonly posten_id: string | null;
  readonly veranstaltung_id: string | null;
  readonly objekt_id: string | null;
}

/** Posten oder Veranstaltung dieser Gesellschaft — oder 404 (AUT-06). */
async function herkunft(
  kontext: LeseKontext, h: AnforderungHerkunft,
): Promise<Herkunftszeile> {
  const [z] = h.art === 'posten'
    ? await kontext.abfrage<Herkunftszeile>(
      `select p.id as posten_id, null::uuid as veranstaltung_id, p.objekt_id
         from posten p where p.id = $1::uuid`, [h.id])
    : await kontext.abfrage<Herkunftszeile>(
      `select null::uuid as posten_id, v.id as veranstaltung_id, v.objekt_id
         from veranstaltung v where v.id = $1::uuid`, [h.id]);
  if (z === undefined) {
    throw new AnforderungFehler('nicht_gefunden',
      h.art === 'posten' ? 'Diesen Posten gibt es hier nicht.'
        : 'Diese Veranstaltung gibt es hier nicht.');
  }
  return z;
}

function istEindeutigkeitsVerstoss(fehler: unknown): boolean {
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === '23505' && f.constraint_name === 'ea_scope_uk';
}

/**
 * Traegt eine Anforderung ein und gibt ihre Kennung zurueck.
 *
 * Die Kennung entsteht in der Anwendung: `returning` zoege die Lesepolicy
 * mit hinein, und die verlangt `security.lesen` — dieselbe Bauart wie beim
 * Wachbuch. Wer hier schreiben darf, darf zwar auch lesen, aber die Zusage
 * soll nicht an der Rollenmatrix haengen.
 */
export async function legeAnforderungAn(
  kontext: SchreibKontext, roh: AnforderungEingabe,
): Promise<{ readonly id: string; readonly herkunft: AnforderungHerkunft }> {
  const e = pruefeAnforderungEingabe(roh);
  const h = await herkunft(kontext, e.herkunft);

  const [q] = await kontext.abfrage<{ id: string }>(
    `select id from qualifikation where id = $1::uuid and archiviert_am is null`,
    [e.qualifikationId],
  );
  if (q === undefined) {
    throw new AnforderungFehler('qualifikation_unbekannt',
      'Diese Qualifikation steht nicht (mehr) im Katalog.');
  }

  const spalten = {
    posten: e.bereich === 'posten' ? h.posten_id : null,
    veranstaltung: e.bereich === 'veranstaltung' ? h.veranstaltung_id : null,
    objekt: e.bereich === 'objekt' ? h.objekt_id : null,
  };
  if (e.bereich === 'objekt' && h.objekt_id === null) {
    throw new AnforderungFehler('kein_objekt',
      'Diese Veranstaltung hängt an keinem Objekt — eine Objektanforderung hätte '
      + 'keinen Ort. Tragen Sie sie für die Veranstaltung selbst ein.');
  }

  const id = randomUUID();
  try {
    await kontext.schreibe(
      `insert into einsatzanforderung
         (id, mandant_id, geltungsbereich, posten_id, veranstaltung_id, objekt_id,
          qualifikation_id, zwingend, geltung, mindestanzahl, gueltig_ab,
          bewacherregister_pflicht, rechtsgrundlage, ist_platzhalter, erstellt_von)
       values ($1::uuid, $2::uuid, $3::einsatzanforderung_bereich, $4::uuid, $5::uuid,
               $6::uuid, $7::uuid, $8::boolean, $9::qualifikation_geltung, $10::smallint,
               $11::date, $12::boolean, $13, $14::boolean, $15::uuid)`,
      [
        id, kontext.aktiverMandantId, e.bereich,
        spalten.posten, spalten.veranstaltung, spalten.objekt,
        q.id, e.zwingend, e.geltung, e.mindestanzahl, e.gueltigAb,
        e.bewacherregisterPflicht, e.rechtsgrundlage, !e.bestaetigt, kontext.benutzerId,
      ],
    );
  } catch (fehler) {
    if (istEindeutigkeitsVerstoss(fehler)) {
      throw new AnforderungFehler('doppelt',
        'Diese Qualifikation wird für diesen Bereich schon verlangt. Ändern heißt: '
        + 'die bestehende Anforderung archivieren und neu eintragen.');
    }
    throw fehler;
  }
  return { id, herkunft: e.herkunft };
}

/**
 * Archiviert eine Anforderung — sie gilt ab sofort fuer keine kuenftige
 * Schicht mehr. Eine Schicht, die schon begonnen hat, behaelt sie in ihrem
 * Schnappschuss (V-129).
 */
export async function archiviereAnforderung(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const [z] = await kontext.abfrage<{ archiviert: boolean }>(
    `select (archiviert_am is not null) as archiviert from einsatzanforderung
      where id = $1::uuid`, [id]);
  if (z === undefined) {
    throw new AnforderungFehler('nicht_gefunden', 'Diese Anforderung gibt es hier nicht.');
  }
  if (z.archiviert) {
    throw new AnforderungFehler('schon_archiviert', 'Diese Anforderung ist schon archiviert.');
  }
  await kontext.schreibe(
    `update einsatzanforderung
        set archiviert_am = now(), archiviert_von = $2::uuid, geaendert_von = $2::uuid
      where id = $1::uuid and archiviert_am is null`,
    [id, kontext.benutzerId]);
}

/** Eine Anforderung, wie die Seiten sie zeigen. */
export interface AnforderungZeile {
  readonly id: string;
  readonly qualifikation: string;
  readonly bereich: AnforderungBereich;
  readonly zwingend: boolean;
  readonly geltung: AnforderungGeltung;
  readonly mindestanzahl: number;
  readonly register: boolean;
  readonly rechtsgrundlage: string | null;
  readonly platzhalter: boolean;
  /** `TT.MM.JJJJ` oder `null` — ab wann sie gilt. */
  readonly gueltigAb: string | null;
}

/**
 * Was fuer diesen Posten (oder diese Veranstaltung) gilt — additiv, genau wie
 * der Aufloeser im Tor es liest (§9.2): der eigene Bereich, das Objekt, die
 * Gesellschaft. Nur die eigenen Zeilen zu zeigen hiesse, eine
 * mandantenweite §34a-Grundanforderung zu verschweigen, die trotzdem greift.
 */
export async function leseAnforderungen(
  kontext: LeseKontext, h: AnforderungHerkunft & { readonly objektId: string | null },
): Promise<readonly AnforderungZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; qualifikation: string; bereich: AnforderungBereich; zwingend: boolean;
    geltung: AnforderungGeltung; mindestanzahl: number; register: boolean;
    rechtsgrundlage: string | null; platzhalter: boolean; gueltig_ab: string | null;
  }>(
    `select ea.id, q.bezeichnung as qualifikation, ea.geltungsbereich::text as bereich,
            ea.zwingend, ea.geltung::text as geltung, ea.mindestanzahl,
            ea.bewacherregister_pflicht as register, ea.rechtsgrundlage,
            ea.ist_platzhalter as platzhalter,
            to_char(ea.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab
       from einsatzanforderung ea
       join qualifikation q on q.id = ea.qualifikation_id
      where ea.archiviert_am is null
        and (   (ea.geltungsbereich = 'posten' and ea.posten_id = $1::uuid)
             or (ea.geltungsbereich = 'veranstaltung' and ea.veranstaltung_id = $2::uuid)
             or (ea.geltungsbereich = 'objekt' and ea.objekt_id = $3::uuid)
             or ea.geltungsbereich = 'mandant')
      order by ea.zwingend desc, q.bezeichnung`,
    [
      h.art === 'posten' ? h.id : null,
      h.art === 'veranstaltung' ? h.id : null,
      h.objektId,
    ],
  );
  return zeilen.map((z) => ({
    id: z.id,
    qualifikation: z.qualifikation,
    bereich: z.bereich,
    zwingend: z.zwingend,
    geltung: z.geltung,
    mindestanzahl: Number(z.mindestanzahl),
    register: z.register,
    rechtsgrundlage: z.rechtsgrundlage,
    platzhalter: z.platzhalter,
    gueltigAb: z.gueltig_ab,
  }));
}

/** Die Qualifikationen, die man verlangen kann — lebend, plattformweit oder eigene. */
export async function waehlbareQualifikationen(
  kontext: LeseKontext,
): Promise<readonly { readonly id: string; readonly bezeichnung: string }[]> {
  /*
   * `q_lesen` zeigt die Qualifikationen ALLER sichtbaren Gesellschaften; eine
   * fremde weist der Ausloeser `a_ea_qualifikation_mandant` ab (0031). Sie
   * gar nicht erst anzubieten ist die freundlichere Haelfte derselben Regel.
   */
  return kontext.abfrage<{ id: string; bezeichnung: string }>(
    `select id, bezeichnung from qualifikation
      where archiviert_am is null
        and (mandant_id is null or mandant_id = app.aktiver_mandant())
      order by (mandant_id is null) desc, bezeichnung`);
}

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
  readonly beantwortetAm: Date | null;
  readonly entscheidung: string | null;
  /** Tage bis zur wirksamen Frist — negativ heisst überfällig. */
  readonly tageBisFrist: number;
}

const FELDER = `id, art::text as art, status::text as status, name, email, nachricht,
                rolle_angabe as "rolleAngabe", eingegangen_am as "eingegangenAm",
                frist_am as "fristAm", verlaengert_bis as "verlaengertBis",
                verlaengert_grund as "verlaengertGrund",
                beantwortet_am as "beantwortetAm", entscheidung,
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

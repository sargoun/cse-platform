/**
 * Demodaten fuer den Qualifikationskatalog und die Nachweise eines Menschen
 * (EMP-08, SEC-02, SEC-04, PER-06).
 *
 * **Ohne diese Datei ist der Katalog LEER** — und zwar auf jedem Bildschirm
 * gleich ueberzeugend. Das Nachweisregister aus PR 44 zeigte dann null Zeilen,
 * die Ablaufwarnung warnte nie, und die Qualifikationssperre der Einteilung
 * sperrte nichts: `app.einsatz_qualifikation_erfuellt` fragt nach
 * Anforderungen, und ohne eine einzige `qualifikation` gibt es keine. Der
 * gefaehrlichste Zustand ist dabei nicht der sichtbar leere Bildschirm,
 * sondern die gruene Einteilung: ein Posten, der eine §34a-Sachkunde
 * verlangt, besetzt mit jemandem, der keine hat, und niemand sieht es.
 *
 * **Die vier Katalogeintraege sind Rechtstatsachen, keine Erfindungen.**
 * `34a_sachkunde` und `34a_unterrichtung` sind die beiden Wege des §34a
 * Abs. 1a GewO und stehen als `nachweis_art` schon in der Migration (D-122);
 * der Bewacherausweis nach §11b GewO ist die Voraussetzung dafuer, ueberhaupt
 * eingesetzt zu werden; die jaehrliche Unterweisung steht in DGUV Vorschrift 1
 * §4. Alles, was die Gruppe darueber hinaus verlangen mag — eine
 * Hausordnungsschulung, ein Reinigungsmittel-Sachkundenachweis — gehoert dem
 * Mandanten und wird hier NICHT geraten.
 *
 * **Die Gueltigkeitsdauer des Bewacherausweises bleibt offen** (O-341). Der
 * Katalog sagt `laeuft_ab = true` und laesst `standard_gueltigkeit_monate`
 * leer; das Datum steht am einzelnen Nachweis, wo es herkommt — aus dem
 * Ausweis. Ein geratener Vorgabewert traegt sich sonst in jeden neu erfassten
 * Nachweis ein und sieht dort aus wie eine gepruefte Angabe.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien.
 */
import type postgres from 'postgres';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface QualifikationErgebnis {
  readonly qualifikationen: number;
  readonly nachweise: number;
}

interface Katalogeintrag {
  readonly schluessel: string;
  readonly nachweisArt: string | null;
  readonly bezeichnung: string;
  readonly i18n: Readonly<Record<'de' | 'en' | 'ar' | 'tr', string>>;
  readonly kategorie: 'gesetzlich' | 'fachlich' | 'fuehrerschein' | 'gesundheit' | 'intern';
  readonly rechtsgrundlage: string;
  readonly laeuftAb: boolean;
  /** `null` heisst: die Frist steht am Nachweis, nicht im Katalog (O-341). */
  readonly gueltigkeitMonate: number | null;
  readonly blockiert: boolean;
  readonly erfordertDokument: boolean;
}

/**
 * Vier Eintraege, und jeder traegt seine Rechtsgrundlage.
 *
 * `blockiert_einsatz` ist dabei die teuerste Spalte der Tabelle: sie
 * entscheidet, ob die Einteilung verweigert oder nur warnt. Sie steht hier
 * genau dort auf `true`, wo das Gesetz den Einsatz verbietet — und nicht dort,
 * wo ein Fehlen nur aergerlich ist.
 */
const KATALOG: readonly Katalogeintrag[] = [
  {
    schluessel: '34a_sachkunde',
    nachweisArt: '34a_sachkunde',
    bezeichnung: 'Sachkundeprüfung nach §34a GewO',
    i18n: {
      de: 'Sachkundeprüfung nach §34a GewO',
      en: 'Competence examination under §34a GewO',
      ar: 'اختبار الكفاءة وفق المادة 34أ من قانون المهن',
      tr: '§34a GewO uyarınca yeterlilik sınavı',
    },
    kategorie: 'gesetzlich',
    rechtsgrundlage: '§34a Abs. 1a GewO',
    // Die bestandene Pruefung verfaellt nicht. Ein Ablaufdatum darauf waere
    // eine erfundene Frist, und der Bildschirm mahnte eine Erneuerung an, die
    // es nicht gibt.
    laeuftAb: false,
    gueltigkeitMonate: null,
    blockiert: true,
    erfordertDokument: true,
  },
  {
    schluessel: '34a_unterrichtung',
    nachweisArt: '34a_unterrichtung',
    bezeichnung: 'Unterrichtung nach §34a GewO',
    i18n: {
      de: 'Unterrichtung nach §34a GewO',
      en: 'Instruction under §34a GewO',
      ar: 'التلقين وفق المادة 34أ من قانون المهن',
      tr: '§34a GewO uyarınca bilgilendirme',
    },
    kategorie: 'gesetzlich',
    rechtsgrundlage: '§34a Abs. 1a Satz 1 Nr. 3 GewO',
    laeuftAb: false,
    gueltigkeitMonate: null,
    blockiert: true,
    erfordertDokument: true,
  },
  {
    schluessel: 'bewacherausweis',
    nachweisArt: null,
    bezeichnung: 'Bewacherausweis',
    i18n: {
      de: 'Bewacherausweis',
      en: 'Security guard ID card',
      ar: 'بطاقة حارس الأمن',
      tr: 'Güvenlik görevlisi kimlik kartı',
    },
    kategorie: 'gesetzlich',
    rechtsgrundlage: '§11b GewO',
    /**
     * // TODO(client, O-341): Mit welcher Frist läuft ein Bewacherausweis in
     * Ihrem Haus ab — folgt sie der Wiederholung der Zuverlässigkeitsprüfung
     * oder dem aufgedruckten Datum des Ausweises?
     */
    laeuftAb: true,
    gueltigkeitMonate: null,
    blockiert: true,
    erfordertDokument: true,
  },
  {
    schluessel: 'unterweisung_dguv1',
    nachweisArt: null,
    bezeichnung: 'Jährliche Unterweisung nach DGUV Vorschrift 1',
    i18n: {
      de: 'Jährliche Unterweisung nach DGUV Vorschrift 1',
      en: 'Annual safety instruction under DGUV Regulation 1',
      ar: 'التدريب السنوي وفق لائحة DGUV رقم 1',
      tr: 'DGUV Yönetmelik 1 uyarınca yıllık eğitim',
    },
    kategorie: 'gesetzlich',
    rechtsgrundlage: '§4 DGUV Vorschrift 1',
    // Jaehrlich — das steht in der Vorschrift und ist deshalb keine Annahme.
    laeuftAb: true,
    gueltigkeitMonate: 12,
    blockiert: false,
    erfordertDokument: false,
  },
];

/**
 * Wer welchen Nachweis hat — und mit welcher Lage.
 *
 * Ein Register, in dem alles gruen ist, zeigt die eine Spalte nie, um
 * derentwillen es gebaut wurde. Deshalb traegt jeder Mensch hier eine andere
 * Lage: gueltig, in der Warnfrist, und abgelaufen. `tageBisAblauf` ist relativ
 * zum Berliner Heute, damit der Seed in einem Jahr dieselben Bildschirme
 * zeigt wie heute.
 */
interface NachweisVorgabe {
  readonly nachname: string;
  readonly qualifikation: string;
  /** `null` bei einer Qualifikation, die nicht ablaeuft. */
  readonly tageBisAblauf: number | null;
  readonly stelle: string;
}

const NACHWEISE: readonly NachweisVorgabe[] = [
  // Fatima arbeitet in beiden Gesellschaften; §34a gehoert dem MENSCHEN und
  // gilt deshalb in beiden (D-128).
  { nachname: 'Yildiz', qualifikation: '34a_sachkunde', tageBisAblauf: null,
    stelle: 'IHK Berlin' },
  /**
   * Und ihr Bewacherausweis ist ABGELAUFEN — der Fall, um dessentwillen
   * EMP-08 und SEC-04 gebaut sind. Er sitzt mit Absicht an der meistgenutzten
   * Fixtur: eine Sperre, die nur an einem Randdatensatz zu sehen ist, sieht
   * beim Abnehmen niemand. Ihre Reinigungsschichten beruehrt er nicht — dort
   * verlangt keine `einsatzanforderung` den Ausweis.
   */
  { nachname: 'Yildiz', qualifikation: 'bewacherausweis', tageBisAblauf: -12,
    stelle: 'Ordnungsamt Berlin-Mitte' },
  { nachname: 'Yildiz', qualifikation: 'unterweisung_dguv1', tageBisAblauf: 210,
    stelle: 'CSE Dienstleistungen GmbH' },
  // Amir dagegen ist vollstaendig ausgestattet — sonst zeigte das Register nur
  // Rot und niemand saehe, wie eine gueltige Zeile aussieht.
  { nachname: 'Haddad', qualifikation: '34a_unterrichtung', tageBisAblauf: null,
    stelle: 'IHK Berlin' },
  { nachname: 'Haddad', qualifikation: 'bewacherausweis', tageBisAblauf: 45,
    stelle: 'Ordnungsamt Berlin-Mitte' },
  // Und einer, bei dem nur die Unterweisung faellig wird — eine Warnung ohne
  // Sperre, damit der Unterschied auf dem Bildschirm sichtbar ist.
  { nachname: 'Berger', qualifikation: 'unterweisung_dguv1', tageBisAblauf: 5,
    stelle: 'CSE Dienstleistungen GmbH' },
];

/**
 * Der Zustand eines Nachweises — und warum so mancher NICHT `gueltig` ist.
 *
 * `kern.nachweis_dokumentpflicht` verweigert `gueltig`, solange bei einer
 * dokumentpflichtigen Qualifikation kein `dokument_id` haengt (DOC-01). Das
 * ist keine Schikane, sondern die Regel selbst: wer eine Sachkundeprüfung als
 * gueltig fuehrt, ohne die Urkunde zu haben, fuehrt eine Behauptung.
 *
 * **Der Seed umgeht sie nicht.** Er koennte eine `dokument`-Zeile schreiben,
 * die auf einen Speicherschluessel zeigt, unter dem nichts liegt — es ist
 * kein Speicher angebunden. Eine Zeile, die eine Datei verspricht, die beim
 * Anklicken nicht da ist, ist genau die vorgetaeuschte Integration, die
 * CLAUDE.md verbietet. Die betroffenen Nachweise stehen deshalb als
 * `beantragt` da: erfasst, aber ohne hinterlegte Urkunde — und damit als
 * das, was sie sind.
 *
 * // TODO(client, O-343): Sollen die Urkunden zu §34a und Bewacherausweis in
 * der Plattform liegen (dann braucht es den Objektspeicher), oder genuegt die
 * Personalakte auf Papier und die Plattform fuehrt nur Nummer und Frist?
 */
function status(n: NachweisVorgabe, dokumentpflichtig: boolean): string {
  if (n.tageBisAblauf !== null && n.tageBisAblauf < 0) return 'abgelaufen';
  return dokumentpflichtig ? 'beantragt' : 'gueltig';
}

export async function seedQualifikationen(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<QualifikationErgebnis> {
  const erfasser = ids.get('security') ?? ids.get('reinigung');
  if (erfasser === undefined) throw new Error('Kein Mandant für nachweis.erfasst_von_mandant_id');

  const katalogIds = new Map<string, string>();
  const dokumentpflicht = new Set(
    KATALOG.filter((k) => k.erfordertDokument).map((k) => k.schluessel));
  let qualifikationen = 0;
  for (const k of KATALOG) {
    const [da] = await sql<{ id: string }[]>`
      select id from qualifikation
       where mandant_id is null and schluessel = ${k.schluessel} limit 1`;
    if (da !== undefined) { katalogIds.set(k.schluessel, da.id); continue; }

    const [art] = k.nachweisArt === null ? [undefined] : await sql<{ id: string }[]>`
      select id from nachweis_art where schluessel = ${k.nachweisArt} limit 1`;

    const [neu] = await sql<{ id: string }[]>`
      insert into qualifikation
        (mandant_id, schluessel, nachweis_art_id, bezeichnung, bezeichnung_i18n,
         kategorie, rechtsgrundlage, laeuft_ab, standard_gueltigkeit_monate,
         blockiert_einsatz, erfordert_dokument)
      values (null, ${k.schluessel}, ${art?.id ?? null}, ${k.bezeichnung},
              ${sql.json(k.i18n as unknown as Record<string, string>)},
              ${k.kategorie}::qualifikation_kategorie, ${k.rechtsgrundlage},
              ${k.laeuftAb}, ${k.gueltigkeitMonate}, ${k.blockiert},
              ${k.erfordertDokument})
      returning id`;
    katalogIds.set(k.schluessel, neu!.id);
    qualifikationen += 1;
  }

  let nachweise = 0;
  for (const n of NACHWEISE) {
    const qualifikationId = katalogIds.get(n.qualifikation);
    if (qualifikationId === undefined) continue;

    const [mensch] = await sql<{ id: string }[]>`
      select id from person where nachname = ${n.nachname} limit 1`;
    if (mensch === undefined) continue;

    const [da] = await sql<{ id: string }[]>`
      select id from nachweis
       where person_id = ${mensch.id} and qualifikation_id = ${qualifikationId}
         and widerrufen_am is null limit 1`;
    if (da !== undefined) continue;

    /**
     * `gueltig_ab` liegt bewusst in der Vergangenheit und `gueltig_bis`
     * relativ zum Berliner Heute — die Datumsarithmetik macht die Datenbank,
     * damit der Seed nicht die Uhr des Rechners befragt, auf dem er laeuft
     * (Invariante 5).
     */
    await sql`
      insert into nachweis
        (person_id, qualifikation_id, nummer, ausstellende_stelle, ausgestellt_am,
         gueltig_ab, gueltig_bis, status, erfasst_von_mandant_id)
      select ${mensch.id}, ${qualifikationId},
             ${`DEMO-${n.qualifikation.toUpperCase()}-${n.nachname.toUpperCase()}`},
             ${n.stelle},
             ((now() at time zone 'Europe/Berlin')::date - 400),
             ((now() at time zone 'Europe/Berlin')::date - 400),
             ${n.tageBisAblauf === null ? null
               : sql`((now() at time zone 'Europe/Berlin')::date
                       + ${n.tageBisAblauf}::int)`},
             ${status(n, dokumentpflicht.has(n.qualifikation))}::nachweis_status,
             ${erfasser}`;
    nachweise += 1;
  }

  return { qualifikationen, nachweise };
}

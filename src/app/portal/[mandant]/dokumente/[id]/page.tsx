import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import { waehleSpeicher } from '@/server/storage/waehle';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { formatiereBytes, KATEGORIE } from '../darstellung';
import { kennungOder404 } from '../../../kennung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { DOKUMENT_BLATT_TEXTE } from '@/lib/i18n/verwaltung/dokument-blatt';
import { internSprache } from '@/lib/i18n/intern';
import { dokumentKategorieText } from '@/lib/i18n/texte';

/**
 * `/portal/[mandant]/dokumente/[id]` — die Metadaten eines Dokuments
 * (DOC-05, DOC-07): Kategorie, Bezug, Pruefstand der Datei, Aufbewahrung.
 *
 * Kein Vorschaubild und kein Download, solange der Speicher nicht verbunden
 * ist: die Datei wird nur ueber eine signierte Adresse ausgegeben (DOC-03),
 * und eine Adresse, die niemand signieren kann, gibt es nicht. Das
 * Zugriffsprotokoll (SEC-A9) kommt mit der Ausgabe — es protokolliert
 * Zugriffe, die es geben kann.
 *
 * **Und hier wird gelöscht** (V-026). `services/dokument/loeschung.ts` ist
 * der EINE Weg, auf dem ein Dokument samt Datei verschwindet — gebaut,
 * geprüft, mit zwei Auslösern dahinter, und aufgerufen von genau einem:
 * dem Nachtlauf. Ein Mensch konnte nichts löschen, auch nicht die Datei, die
 * vor zwei Minuten beim falschen Kunden landete.
 *
 * Das Formular steht unten und nicht oben, es trägt kein `primary`, und es
 * verlangt einen Grund. Was bleiben MUSS, entscheidet die Datenbank:
 * `kern.dokument_loeschsperre` (0009) und `fin.dokument_haengt_an_buchung`
 * (0132). Die Seite zeigt beide Gründe an, bevor jemand drückt.
 */
export const dynamic = 'force-dynamic';

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  grund: 'Ein Löschgrund gehört dazu — mindestens fünf Zeichen. Er steht später '
    + 'allein da, wenn jemand fragt, wohin dieses Dokument verschwunden ist.',
  gesperrt: 'Dieses Dokument bleibt. Entweder steht es unter Aufbewahrungspflicht '
    + '(DOC-07, LEG-01), oder eine Buchungszeile beruft sich darauf (ACC-03, § 147 AO) '
    + '— eine Buchung wird durch Gegenbuchung korrigiert, nie der Beleg durch Löschen. '
    + 'Oder der Dateispeicher ist nicht verbunden: eine Zeile ohne ihre Datei wäre ein '
    + 'Dokument, das als gelöscht gilt und im Bucket liegt.',
  nicht_gefunden: 'Das Dokument ist nicht erreichbar oder schon gelöscht.',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Dokument {
  readonly id: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly kategorie: string;
  readonly kunde: string | null;
  readonly kunde_id: string | null;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly tags: readonly string[] | null;
  readonly bucket: string;
  readonly mime_typ: string | null;
  readonly mime_verifiziert: boolean;
  readonly exif_entfernt: boolean;
  readonly groesse: string | null;
  readonly sichtbar_fuer_kunde: boolean;
  readonly sichtbar_fuer_mitarbeiter: boolean;
  readonly aufbewahrung_bis: string | null;
  readonly loeschsperre: boolean;
  /** Läuft die Frist heute noch? Gerechnet von der DATENBANK (Invariante 5). */
  readonly frist_laeuft: boolean;
  /** Beruft sich eine Buchungszeile darauf? Dann bleibt es (ACC-03). */
  readonly an_buchung: boolean;
  readonly erstellt: string;
  readonly erstellt_von: string | null;
}

function Feld({ label, wert }: { readonly label: string; readonly wert: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}

export default async function Dokumentblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  /*
   * **Welches Formular die Abweisung meint** (V-219). Löschen und die
   * Freigabe für die Belegschaft schicken ihren Grund beide als `?fehler=`
   * zurück; `vorgang` sagt, zu welchem Abschnitt er gehört — sonst stünde
   * über einer abgewiesenen Rücknahme „Nicht gelöscht.".
   */
  const vorgang = typeof suche['vorgang'] === 'string' ? suche['vorgang'] : null;
  const mfErfolg = suche['mitarbeiterfreigabe'] === 'gesetzt'
    || suche['mitarbeiterfreigabe'] === 'zurueckgenommen'
    ? suche['mitarbeiterfreigabe'] : null;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/dokumente/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: `…/crm/kunden/[id]` verlangt laut Manifest `crm.lesen`,
     `…/objekte/[id]` verlangt `objekt.lesen` — diese Seite verlangt keins
     von beiden. Wer das Dokument lesen, aber Kunde oder Objekt nicht oeffnen
     darf, bekam hinter dem Bezug ein 404; ein Verweis auf 404 verraet, was er
     nicht zeigen darf. Der Name bleibt als Text (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(
    zugang.sitzung, 'crm.lesen', 'objekt.lesen', 'dokument.kunde_freigeben',
    /*
     * **`dokument.archivieren` und nicht `dokument.schreiben`** (V-026): wer
     * ablegen darf, räumt damit nicht auf. Das eine legt hinzu, das andere
     * nimmt fort, und in einem Archiv ist das nicht dieselbe Handlung.
     */
    'dokument.archivieren',
    /* V-219: die Freigabe für die Belegschaft — dasselbe Recht wie beim Ablegen. */
    'dokument.schreiben');

  const [d] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Dokument>(
      `select d.id, d.titel, d.beschreibung, d.kategorie::text as kategorie,
              k.name as kunde, d.kunde_id, o.bezeichnung as objekt, d.objekt_id, d.tags,
              d.bucket, d.mime_typ, d.mime_verifiziert, d.exif_entfernt, d.groesse_bytes::text as groesse,
              d.sichtbar_fuer_kunde, d.sichtbar_fuer_mitarbeiter,
              to_char(d.aufbewahrung_bis, 'DD.MM.YYYY') as aufbewahrung_bis, d.loeschsperre,
              (d.aufbewahrung_bis is not null
               and d.aufbewahrung_bis > app.berlin_heute()) as frist_laeuft,
              -- Derselbe Grund, den fin.dokument_haengt_an_buchung (0132)
              -- prueft — hier gelesen, damit die Seite ihn NENNT, statt den
              -- Menschen gegen einen Ausloeser laufen zu lassen. Entschieden
              -- wird er dort, nicht hier. (Keine Backticks in diesem
              -- Kommentar: er steht in einem JS-Templateliteral, und ein
              -- Backtick darin beendet es.)
              exists (select 1 from beleg bl
                       join buchungssatz bs on bs.beleg_id = bl.id
                                           and bs.mandant_id = bl.mandant_id
                      where bl.dokument_id = d.id and bl.mandant_id = d.mandant_id)
                as an_buchung,
              to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as erstellt,
              b.name as erstellt_von
         from dokument d
         left join kunde k on k.id = d.kunde_id
         left join objekt o on o.id = d.objekt_id
         left join benutzer b on b.id = d.erstellt_von
        where d.id = $1 and d.geloescht_am is null`, [id]))) as Promise<readonly Dokument[]>);
  if (d === undefined) notFound();
  const speicher = waehleSpeicher();
  const sprache = internSprache(zugang.sprache);
  const t = nachSprache(DOKUMENT_BLATT_TEXTE, sprache);
  const mfFehler = vorgang === 'mitarbeiterfreigabe' ? fehler : null;

  return (
    <PortalRahmen
      titel={d.titel}
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      /* Mit `dokument.archivieren` ist dieses Blatt schreibend (V-026), mit
         `dokument.schreiben` seit V-219 ebenso (Freigabe für die Belegschaft). */
      nurLesen={darf['dokument.archivieren'] !== true && darf['dokument.schreiben'] !== true}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dokumente"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{d.titel}</h1>
      {d.beschreibung === null ? null : <p className="mb-s5 max-w-[72ch] text-base text-text-muted">{d.beschreibung}</p>}

      {fehler !== null && vorgang === null ? (
        <Hinweis art="warnung" cse="dokument-loeschfehler" className="mb-s5 max-w-prose">
          <strong>Nicht gelöscht.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Löschung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s4 text-h3 text-text">Einordnung</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Kategorie" wert={KATEGORIE[d.kategorie] ?? d.kategorie} />
            <Feld label="Kunde" wert={d.kunde === null || d.kunde_id === null ? '—' : darf['crm.lesen'] === true ? (
              <Link href={`/portal/${mandant}/crm/kunden/${d.kunde_id}`} className="underline-offset-2 hover:underline">{d.kunde}</Link>) : d.kunde} />
            <Feld label="Objekt" wert={d.objekt === null || d.objekt_id === null ? '—' : darf['objekt.lesen'] === true ? (
              <Link href={`/portal/${mandant}/objekte/${d.objekt_id}`} className="underline-offset-2 hover:underline">{d.objekt}</Link>) : d.objekt} />
            <Feld label="Schlagworte" wert={d.tags === null || d.tags.length === 0 ? '—' : d.tags.join(', ')} />
            <Feld label="Sichtbar für" wert={(
              <>
                {[d.sichtbar_fuer_kunde ? 'Kunde' : null,
                  d.sichtbar_fuer_mitarbeiter ? 'Beschäftigte' : null]
                  .filter((t) => t !== null).join(', ') || 'nur intern'}
                {/*
                  * Der Weg zur Kundenfreigabe — sie ist ein eigener Vorgang mit
                  * eigenem Recht (`dokument.kunde_freigeben`), und nicht
                  * dasselbe wie `dokument.schreiben`. Ohne die Rechtepruefung
                  * fuehrte der Verweis fuer eine Beschaeftigtenrolle auf 404
                  * und verriete damit, was er nicht zeigen darf (AUT-06).
                  */}
                {darf['dokument.kunde_freigeben'] === true && (
                  <Link
                    href={`/portal/${mandant}/dokumente/${d.id}/kundenfreigabe`}
                    data-cse="zur-kundenfreigabe"
                    className="ml-s3 text-text underline underline-offset-2 hover:text-brand"
                  >
                    Kundenfreigabe →
                  </Link>
                )}
              </>
            )} />
            <Feld label="Abgelegt" wert={`${d.erstellt}${d.erstellt_von === null ? '' : ` von ${d.erstellt_von}`}`} />
          </dl>
        </section>
        <section className="rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s4 text-h3 text-text">Datei und Aufbewahrung</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Typ" wert={d.mime_typ ?? '—'} />
            <Feld label="Typ geprüft" wert={d.mime_verifiziert ? 'aus den Bytes bestätigt' : 'nicht geprüft'} />
            <Feld label="EXIF" wert={d.exif_entfernt ? 'entfernt' : 'nicht entfernt'} />
            <Feld label="Größe" wert={formatiereBytes(d.groesse)} />
            <Feld label="Ablage" wert={<code className="text-xs">{d.bucket}</code>} />
            <Feld label="Aufbewahren bis" wert={d.aufbewahrung_bis ?? 'keine Frist hinterlegt'} />
            <Feld label="Löschsperre" wert={d.loeschsperre ? 'ja — kein Löschen möglich' : 'nein'} />
          </dl>
          {speicher.verbunden ? (
            <p className="mt-s4">
              <a
                href={`/api/dokumente/${d.id}/datei`}
                data-cse="datei-abrufen"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm
                           font-semibold text-white hover:bg-brand-hover"
              >
                Datei abrufen
              </a>
            </p>
          ) : null}
          <p data-cse="download-hinweis" className="mt-s4 text-sm text-text-subtle">
            {speicher.verbunden
              ? 'Der Abruf führt auf eine signierte Adresse, die nach 15 Minuten verfällt (DOC-03), und wird im Zugriffsprotokoll des Dokuments vermerkt.'
              : 'Der Dateispeicher ist nicht verbunden — es gibt keine Adresse, die ausgegeben werden könnte (Einstellungen › Integrationen).'}
          </p>
        </section>
      </div>

      {/* ------------------------------ Freigabe für die Belegschaft (V-219) */}
      {/*
        * **Der Rückweg, den es nicht gab.** Das Kästchen beim Ablegen setzte
        * `sichtbar_fuer_mitarbeiter`, und danach führte kein Weg zurück —
        * bei den Kategorien mit Löschsperre auch nicht über das Löschen.
        * Der Schalter steht hier in BEIDE Richtungen, mit Pflichtgrund, unter
        * demselben Recht wie beim Ablegen (D-712).
        */}
      <section aria-labelledby="mitarbeiterfreigabe" className="mt-s7 max-w-prose"
               data-cse="mitarbeiterfreigabe">
        <h2 id="mitarbeiterfreigabe" className="mb-s3 text-h3 text-text">{t.mfTitel}</h2>
        {mfErfolg !== null ? (
          <Hinweis art="erfolg" cse="mitarbeiterfreigabe-erfolg" className="mb-s4">
            {mfErfolg === 'gesetzt' ? t.mfGesetzt : t.mfZurueckgenommen}
          </Hinweis>
        ) : null}
        {mfFehler !== null ? (
          <Hinweis art="warnung" cse="mitarbeiterfreigabe-fehler" className="mb-s4">
            <strong>{t.mfNichtGeaendert}</strong>{' '}
            {eigenerEintrag(t.mfFehler, mfFehler) ?? t.mfFehlerSonst}
          </Hinweis>
        ) : null}
        <p className="m-0 text-sm text-text" data-cse="mitarbeiterfreigabe-stand"
           data-frei={d.sichtbar_fuer_mitarbeiter ? 'ja' : 'nein'}>
          {d.sichtbar_fuer_mitarbeiter ? t.mfIstFrei : t.mfIstNichtFrei}
        </p>
        <p className="mt-s3 text-sm text-text">
          <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            {t.mfKategorie}
          </span>{' '}
          <strong data-cse="mitarbeiterfreigabe-kategorie">
            {dokumentKategorieText(sprache, d.kategorie)}
          </strong>
        </p>
        <p className="mt-s2 text-xs text-text-muted">{t.mfKategorieHinweis}</p>
        {darf['dokument.schreiben'] !== true ? (
          <p className="mt-s4 text-sm text-text-muted" data-cse="mitarbeiterfreigabe-ohne-recht">
            {t.mfOhneRecht}{' '}
            <Recht schluessel="dokument.schreiben" sprache={sprache} />.
          </p>
        ) : (
          <form method="post" action={`/api/dokumente/${d.id}/mitarbeiterfreigabe`}
                data-cse="mitarbeiterfreigabe-formular"
                className="mt-s4 flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="sichtbar"
                   value={d.sichtbar_fuer_mitarbeiter ? 'nein' : 'ja'} />
            <input type="hidden" name="zurueck"
                   value={`/portal/${mandant}/dokumente/${d.id}?vorgang=mitarbeiterfreigabe`} />
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.mfGrund}
              <textarea name="grund" rows={2} required
                        data-cse="mitarbeiterfreigabe-grund"
                        placeholder={d.sichtbar_fuer_mitarbeiter
                          ? t.mfGrundBeispielZuruecknehmen : t.mfGrundBeispielFreigeben}
                        className="w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
            </label>
            <div>
              <Button type="submit"
                      variante={d.sichtbar_fuer_mitarbeiter ? 'danger' : 'secondary'}
                      data-cse="mitarbeiterfreigabe-abschicken">
                {d.sichtbar_fuer_mitarbeiter ? t.mfZuruecknehmen : t.mfFreigeben}
              </Button>
            </div>
            <p className="m-0 text-xs text-text-muted">
              {d.sichtbar_fuer_mitarbeiter ? t.mfRuecknahmeGrenze : t.mfFreigabeFolge}
            </p>
          </form>
        )}
      </section>

      {/* --------------------------------------------------- Löschen (V-026) */}
      <section aria-labelledby="loeschen" className="mt-s7 max-w-prose">
        <h2 id="loeschen" className="mb-s3 text-h3 text-text">Dokument löschen</h2>
        {darf['dokument.archivieren'] !== true ? (
          <p className="text-sm text-text-muted" data-cse="loeschen-ohne-recht">
            Gelöscht wird von einer Sitzung mit{' '}
            <Recht schluessel="dokument.archivieren" />. Wer ablegen darf, räumt damit
            nicht auf — das eine legt hinzu, das andere nimmt fort.
          </p>
        ) : d.an_buchung ? (
          <p className="text-sm text-text-muted" data-cse="loeschen-buchung">
            <strong>Es bleibt.</strong> Eine Buchungszeile beruft sich auf dieses
            Dokument (ACC-03, § 147 AO). Korrigiert wird die BUCHUNG durch
            Gegenbuchung, nie der Beleg durch Löschen.
          </p>
        ) : d.loeschsperre ? (
          <p className="text-sm text-text-muted" data-cse="loeschen-gesperrt">
            <strong>Es bleibt.</strong> Dieses Dokument steht unter
            Aufbewahrungspflicht (DOC-07, LEG-01). Die Sperre folgt aus der
            Aufbewahrungsregel seiner Kategorie und lässt sich nicht lösen — das ist
            der Zweck einer Aufbewahrungspflicht.
          </p>
        ) : !speicher.verbunden ? (
          <p className="text-sm text-text-muted" data-cse="loeschen-ohne-speicher">
            <strong>Nicht möglich, solange der Dateispeicher nicht verbunden ist.</strong>{' '}
            Gelöscht wird die Zeile UND die Datei; eine Zeile ohne ihre Datei wäre ein
            Dokument, das als gelöscht gilt und im Bucket liegt.
          </p>
        ) : (
          <form method="post" action="/api/dokumente/loeschen"
                data-cse="dokument-loeschen"
                className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="dokument" value={d.id} />
            {d.frist_laeuft ? (
              <p className="m-0 text-sm text-warning" data-cse="loeschen-frist-laeuft">
                <strong>Die Aufbewahrungsfrist läuft noch</strong> (bis{' '}
                {d.aufbewahrung_bis}). Gesperrt ist dieses Dokument nicht — die Frist
                steuert den Nachtlauf, gesperrt wird über die Löschsperre. Ein
                versehentlich abgelegtes Dokument jahrelang stehen lassen zu müssen
                wäre keine Aufbewahrung, sondern ein fehlender Weg. Der Grund unten ist
                das, was davon bleibt.
              </p>
            ) : null}
            <label className="flex flex-col gap-s2 text-sm text-text">
              Warum wird es gelöscht?
              <textarea name="grund" rows={3} required minLength={5}
                        data-cse="loeschgrund"
                        placeholder="z. B. Versehentlich beim falschen Kunden abgelegt; Ersatz liegt unter …"
                        className="w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
            </label>
            <div>
              <Button type="submit" variante="danger" data-cse="loeschen-abschicken">
                Endgültig löschen
              </Button>
            </div>
            <p className="m-0 text-xs text-text-muted">
              Gelöscht werden die Zeile und die Datei — in dieser Reihenfolge, damit im
              Bucket nichts liegen bleibt, worauf keine Zeile mehr zeigt. Die Zeile bleibt
              mit Zeitpunkt, Person und Grund erhalten (kein hartes Löschen, Invariante 8);
              die Datei ist danach fort und kommt nicht zurück.{' '}
              <strong>Die Datenbank kann trotzdem ablehnen:</strong> ob sich eine
              Buchungszeile auf dieses Dokument beruft, ist ohne{' '}
              <Recht schluessel="buchhaltung.lesen" /> von hier aus nicht zu sehen — die
              Prüfung steht vor der Zeile und gilt für jeden Weg (ACC-03, § 147 AO).
            </p>
          </form>
        )}
      </section>
    </PortalRahmen>
  );
}

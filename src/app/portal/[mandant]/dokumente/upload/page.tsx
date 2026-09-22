import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable } from '@/components/ui/DataTable';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import { ERLAUBTE_MIME, MAX_BYTES } from '@/server/storage/mime';
import { TAG_HOECHSTZAHL } from '@/server/services/dokument/ablage';
import { liesAufbewahrung, type AufbewahrungZeile }
  from '@/server/services/dokument/aufbewahrung';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { KATEGORIE, KATEGORIEN } from '../darstellung';

/**
 * `/portal/[mandant]/dokumente/upload` — eine Datei ablegen (DOC-01, DOC-03,
 * DOC-06, TIM-10, SEC-A6, `04-SEITENKARTE.md` §5.16).
 *
 * **Drei Zusagen, und keine davon ist Gestaltung.**
 *
 *  - Der Typ kommt aus den **BYTES**, nie aus dem Dateinamen und nie aus dem,
 *    was der Browser behauptet (`storage/mime.ts`). Eine `.exe`, die
 *    `rechnung.pdf` heisst und sich als `application/pdf` ausgibt, ist genau
 *    der Fall, für den die Prüfung existiert — und sie wird abgelehnt, nicht
 *    „richtig erkannt und dann gespeichert".
 *  - Die **Grössengrenze** greift, bevor irgendetwas gelesen wird.
 *  - **EXIF wird entfernt**, und zwar auf den Bytes, die gespeichert werden.
 *    Ein Schichtfoto trägt GPS-Koordinaten und eine Gerätekennung; ein PDF
 *    trägt Autor und Pfad des Rechners, auf dem es entstand. Beides gehört
 *    nicht in einen Bucket, aus dem irgendwann jemand ein Prüfbündel zieht.
 *
 * **Kundensichtbarkeit steht hier nicht.** Das Umlegen von
 * `sichtbar_fuer_kunde` ist eine eigene Handlung mit eigenem Recht
 * (`dokument.kunde_freigeben`, DOC-04) auf `…/[id]/kundenfreigabe`. Ein
 * Häkchen hier hätte den schwächeren Weg zum selben Ergebnis geöffnet.
 *
 * **Ohne verbundenen Speicher wird nichts angelegt** und die Seite sagt es,
 * statt einen Knopf zu zeigen, der eine Zeile ohne Datei erzeugt.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }

function wort(
  p: Record<string, string | string[] | undefined>, name: string, max = 200,
): string {
  const roh = p[name];
  return typeof roh === 'string' ? roh.trim().slice(0, max) : '';
}

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  speicher: 'Der Dateispeicher ist nicht verbunden.',
  datei: 'Die Datei wurde abgelehnt.',
  eingabe: 'Die Angaben sind unvollständig.',
};

export default async function DokumentHochladen({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dokumente/upload`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: „Zur Ablage" verlangt `dokument.lesen`, diese Seite
     `dokument.schreiben` — der Formular-Eingang hält das eine ohne das andere.
     Ein Verweis, der auf 404 führt, verrät, was er nicht zeigen darf (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung, 'dokument.lesen', 'dokument.aufbewahrung_verwalten');

  const suche = await searchParams;
  const fehler = wort(suche, 'fehler', 30);
  const meldung = wort(suche, 'meldung', 500);
  const vorgabeKategorie = wort(suche, 'kategorie', 30);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      /* Die Bezugslisten laufen unter RLS: angeboten wird nur, was diese
         Sitzung ohnehin sieht — sonst wäre die Auswahlliste selbst eine
         Auskunft über fremde Zeilen (AUT-06). */
      kunden: await kontext.abfrage<Auswahl>(
        `select id, name from kunde where archiviert_am is null order by name limit 500`),
      objekte: await kontext.abfrage<Auswahl>(
        `select id, bezeichnung as name from objekt
          where archiviert_am is null order by bezeichnung limit 500`),
      regeln: await liesAufbewahrung(kontext),
    })))) as {
      kunden: readonly Auswahl[]; objekte: readonly Auswahl[];
      regeln: readonly AufbewahrungZeile[];
    };

  const speicher = new SupabaseSpeicher();
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
    + 'text-sm text-text';
  const grenzeMb = Math.trunc(MAX_BYTES / (1024 * 1024));

  return (
    <PortalRahmen
      titel="Dokument ablegen"
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dokumente"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dokument ablegen</h1>
        <p className="m-0 flex flex-wrap gap-s3 text-sm">
          {darf['dokument.lesen'] === true && (
            <Link href={`/portal/${mandant}/dokumente`}
                  className="text-text underline underline-offset-2">
              Zur Ablage
            </Link>
          )}
          {darf['dokument.aufbewahrung_verwalten'] === true && (
            <Link href={`/portal/${mandant}/dokumente/aufbewahrung`}
                  className="text-text underline underline-offset-2">
              Aufbewahrungsregeln
            </Link>
          )}
        </p>
      </div>

      {fehler !== '' && (
        <Hinweis art="warnung" cse="upload-fehler" className="mb-s5 max-w-prose">
          <strong>Nichts abgelegt.</strong>{' '}
          {meldung !== '' ? meldung : FEHLER_TEXT[fehler] ?? 'Die Ablage ist nicht erfolgt.'}
        </Hinweis>
      )}

      {!speicher.verbunden && (
        <Hinweis art="warnung" cse="speicher-nicht-verbunden" className="mb-s5 max-w-prose">
          <strong>Der Dateispeicher ist nicht verbunden.</strong> Ohne Zugangsdaten
          (Einstellungen › Integrationen) wird nichts abgelegt und nichts angelegt —
          eine Zeile ohne ihre Datei wäre kein Dokument, sondern eine Behauptung.
          Das Formular bleibt bedienbar und antwortet mit genau diesem Satz.
        </Hinweis>
      )}

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Der Dateityp wird aus den <strong className="text-text">Bytes</strong> bestimmt
        und nicht aus dem Namen; ein Widerspruch zwischen Inhalt und Deklaration wird
        abgelehnt statt stillschweigend korrigiert (DOC-06, SEC-A6). Aus Bildern, Videos
        und PDF werden Metadaten entfernt, bevor sie gespeichert werden — GPS-Punkt,
        Gerätekennung, Autor. Die Datei liegt danach in einem privaten Bucket und ist
        ausschliesslich über eine 15 Minuten gültige, signierte Adresse abrufbar
        (DOC-03).
      </p>

      <form
        method="post"
        action="/api/dokumente/upload"
        encType="multipart/form-data"
        data-cse="upload-formular"
        className="mb-s6 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="zurueck" value={pfad} />

        <label className="flex flex-col gap-s2 text-sm text-text">
          Datei
          <input
            id="datei" name="datei" type="file" required
            accept={ERLAUBTE_MIME.join(',')}
            className={feld} data-cse="upload-datei"
          />
          <span className="text-xs text-text-subtle">
            Höchstens {grenzeMb} MB. Zugelassen sind PDF, XML, JPEG, PNG, GIF, WebP,
            TIFF, Word, Excel, MP4 und QuickTime — die Liste ist geschlossen: was nicht
            darauf steht, wird abgelehnt und nicht durchgereicht, weil es harmlos
            aussieht. HEIC ist bewusst nicht dabei (O-346).
          </span>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Titel
          <input name="titel" required maxLength={200} className={feld} data-cse="upload-titel" />
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Kategorie
          <select name="kategorie" required defaultValue={vorgabeKategorie}
                  className={feld} data-cse="upload-kategorie">
            <option value="">— wählen —</option>
            {KATEGORIEN.map((k) => (
              <option key={k} value={k}>{KATEGORIE[k] ?? k}</option>
            ))}
          </select>
          <span className="text-xs text-text-subtle">
            DOC-01 nennt genau neun. An der Kategorie hängt die
            Aufbewahrungsfrist — sie steht unten in der Tabelle, damit niemand sie
            erst aus einer Fehlermeldung erfährt.
          </span>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Beschreibung (optional)
          <textarea name="beschreibung" rows={3} maxLength={2000}
                    className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                    data-cse="upload-beschreibung" />
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Schlagworte (optional, mit Komma getrennt)
          <input name="tags" maxLength={400} className={feld} data-cse="upload-tags" />
          <span className="text-xs text-text-subtle">
            Höchstens {TAG_HOECHSTZAHL}. Doppelte werden zusammengefasst; die
            Schreibweise bleibt, wie sie getippt wurde.
          </span>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Kunde (optional)
          <select name="kunde" defaultValue="" className={feld} data-cse="upload-kunde">
            <option value="">— kein Bezug —</option>
            {daten.kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Objekt (optional)
          <select name="objekt" defaultValue="" className={feld} data-cse="upload-objekt">
            <option value="">— kein Bezug —</option>
            {daten.objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-s3 text-sm text-text">
          <input type="checkbox" name="fuer_mitarbeiter" value="1"
                 className="mt-s1 size-4 rounded border-line" data-cse="upload-fuer-mitarbeiter" />
          <span>
            Für Beschäftigte im Arbeiterportal sichtbar
            <span className="mt-s1 block text-xs text-text-subtle">
              Aus, bis jemand es anhakt (DOC-04). Für <strong className="text-text">Kunden</strong>{' '}
              wird hier nichts freigegeben: das ist eine eigene Handlung mit eigenem
              Recht auf der Seite des Dokuments.
            </span>
          </span>
        </label>

        <div>
          <Button type="submit" variante="primary" data-cse="upload-absenden">
            Ablegen
          </Button>
        </div>

        <p className="m-0 text-xs text-text-subtle">
          Nach dem Ablegen führt die Zeile eine erste Version mit ihrem SHA-256 — die
          Grundlage der GoBD-Integrität (DOC-05). Gelöscht wird nichts: was unter
          Aufbewahrungspflicht steht, lässt sich auch nicht als gelöscht markieren
          (DOC-07, Invariante 8).
        </p>
      </form>

      <h2 className="mb-s3 text-h2 text-text">Was die Kategorie bedeutet</h2>
      <DataTable
        beschriftung="Aufbewahrung je Kategorie"
        zeilen={daten.regeln}
        schluessel={(r) => r.kategorie}
        spalten={[
          { schluessel: 'kategorie', kopf: 'Kategorie',
            zelle: (r) => KATEGORIE[r.kategorie] ?? r.kategorie },
          { schluessel: 'frist', kopf: 'Frist', numerisch: true,
            zelle: (r) => (r.jahre === null
              ? <span className="text-text-muted">offen</span>
              : `${String(r.jahre)} Jahre`) },
          { schluessel: 'sperre', kopf: 'Löschsperre',
            zelle: (r) => (r.loeschsperre ? 'ja' : 'nein') },
          { schluessel: 'grundlage', kopf: 'Grundlage',
            zelle: (r) => (
              <span className="flex flex-col gap-s1">
                <span>{r.grundlage}</span>
                {r.istPlatzhalter && (
                  <span className="text-xs text-warning">
                    Platzhalter — die Dauer ist nicht bestätigt (O-25); bis dahin gilt
                    die Sperre.
                  </span>
                )}
                <span className="text-xs text-text-subtle">
                  {r.quelle === 'gesellschaft'
                    ? 'Regel dieser Gesellschaft'
                    : 'Vorgabe der Plattform'}
                </span>
              </span>
            ) },
        ]}
      />
      <p className="mt-s3 max-w-prose text-xs text-text-subtle">
        Die Frist beginnt mit dem Schluss des Kalenderjahres, in dem das Dokument
        entsteht (§ 147 Abs. 4 AO). Das Entstehungsjahr kommt aus der Datenbank und
        nicht aus der Uhr des Servers (Invariante 5).
      </p>
    </PortalRahmen>
  );
}

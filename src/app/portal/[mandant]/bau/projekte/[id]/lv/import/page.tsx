import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import {
  AKTION_TEXT, findeLvImport, ladeLvImportZeilen, listeLvImporte, MAX_IMPORT_ZEILEN,
  type LvImportAktion, type LvImportKopf, type LvImportZeileAnzeige,
} from '@/server/services/bau/lv-import';
import { LV_FORMATE, LV_FORMAT_TEXT } from '@/server/services/bau/lv-quelle';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { haeltRechte } from '@/app/portal/rechte';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../../kennung';

/**
 * `/portal/[mandant]/bau/projekte/[id]/lv/import` — hochladen und VORSCHAU
 * (BAU-01, REQ-04, Muster OPS-04).
 *
 * **Eine Adresse, zwei Zustände und kein dritter:** ohne `?import=` das
 * Formular, mit `?import=` die Vorschau samt Übernahmeknopf. Beides an einer
 * Adresse, weil es ein Vorgang ist — und weil ein Formular, das direkt
 * übernimmt, die Zusage dieser Phase nicht hätte: ein LV-Import, der sofort
 * schreibt, macht aus einer verrutschten Spalte tausend falsche
 * Einheitspreise, und die fallen erst in der Schlussrechnung auf.
 *
 * **Übernommen wird in eine NEUE FASSUNG.** Die alte bleibt: sie ist der
 * Beleg dessen, was ursprünglich vereinbart wurde — das Dokument, um das ein
 * Streit nach § 2 Abs. 6 VOB/B geht. Die Aktionspille sagt deshalb, was sich
 * ÄNDERT, und nicht, ob die Zeile mitkommt; mitkommen tun alle gültigen.
 *
 * **Das Austauschformat ist offen (O-41).** Die Auswahl nennt alle Formate,
 * damit sichtbar ist, was fehlt, und weist jedes nicht implementierte
 * ausdrücklich ab, statt einen Erfolg vorzutäuschen.
 */
export const dynamic = 'force-dynamic';

const AKTIONSPILLE: Readonly<Record<LvImportAktion, PillZustand>> = {
  anlegen: 'Bereit',
  aktualisieren: 'In Prüfung',
  unveraendert: 'Abgeschlossen',
  ignorieren: 'Fehler',
};

const STATUSPILLE: Readonly<Record<string, PillZustand>> = {
  hochgeladen: 'Entwurf',
  geprueft: 'Wartet',
  uebernommen: 'Abgeschlossen',
  verworfen: 'Archiviert',
  fehler: 'Fehler',
};

const ART_TEXT: Readonly<Record<string, string>> = {
  los: 'Los', titel: 'Titel', untertitel: 'Untertitel',
  position: 'Position', hinweistext: 'Hinweis',
};

export default async function LvImportSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const importId = typeof suche['import'] === 'string' ? suche['import'] : null;

  const pfad = `/portal/${mandant}/bau/projekte/${id}/lv/import`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  /**
   * Diese Seite trägt `bau.schreiben` (Route-Register). Der Weg zurück ins
   * Leistungsverzeichnis braucht `bau.lesen` — ohne das erste Recht führte
   * „← Leistungsverzeichnis" auf 404 und verriete damit, was es nicht zeigen
   * darf (AUT-06, dasselbe Muster wie beim Raumbuch-Import).
   */
  const darf = await haeltRechte(sitzung, 'bau.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      const kopf = importId === null ? null : await findeLvImport(kontext, importId);
      // Ein Import eines ANDEREN Projekts gehört nicht auf diese Seite.
      const eigener = kopf !== null && kopf.projekt_id === id ? kopf : null;
      return {
        projekt,
        kopf: eigener,
        zeilen: eigener === null
          ? ([] as readonly LvImportZeileAnzeige[])
          : await ladeLvImportZeilen(kontext, eigener.id),
        verlauf: await listeLvImporte(kontext, id),
      };
    }),
  ) as Promise<{
    projekt: ProjektZeile;
    kopf: LvImportKopf | null;
    zeilen: readonly LvImportZeileAnzeige[];
    verlauf: readonly LvImportKopf[];
  } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();
  const { kopf } = daten;
  const schonUebernommen = kopf?.status === 'uebernommen';
  const uebernehmbar = kopf !== null && kopf.status === 'geprueft' && kopf.zeilen_gueltig > 0;

  return (
    <PortalRahmen
      titel={`LV-Import · ${daten.projekt.bezeichnung}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['bau.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/bau/projekte/${id}/lv`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← Leistungsverzeichnis
          </Link>
        </nav>
      )}

      <h1 className="mb-s2 text-h1 text-text">Leistungsverzeichnis importieren</h1>
      <p className="mb-s5 text-sm text-text-muted">
        {daten.projekt.nummer} · {daten.projekt.bezeichnung} · {daten.projekt.kunde}
      </p>

      {kopf === null ? (
        <>
          <form
            method="post"
            action="/api/bau/lv-import"
            encType="multipart/form-data"
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
            data-cse="lv-import-formular"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="projekt" value={id} />

            <p className="mt-0 text-sm text-text-muted">
              Erwartete Spalten: <strong className="text-text">OZ</strong> und{' '}
              <strong className="text-text">Kurztext</strong> (Pflicht), dazu Art,
              Positionsart, Langtext, Einheit, Menge, Einheitspreis. Die Zuordnung
              wird vorgeschlagen und in der Vorschau gezeigt; Dezimalkomma wird
              deutsch gelesen („12,5" ist 12,5).
            </p>
            <p className="text-sm text-text-muted">
              <strong className="text-text">Es passiert noch nichts.</strong> Der
              nächste Schritt ist die Vorschau; erst danach gibt es einen Knopf, der
              eine neue Fassung des Leistungsverzeichnisses anlegt.
            </p>

            <label className="mt-s4 block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Bezeichnung der Fassung
              </span>
              <input
                name="bezeichnung"
                placeholder="z. B. LV Rohbau, Stand 09/2026"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>

            <label className="mt-s4 block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Format
              </span>
              <select
                name="format"
                defaultValue="csv_semikolon"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              >
                {LV_FORMATE.map((f) => (
                  <option key={f} value={f}>{LV_FORMAT_TEXT[f]}</option>
                ))}
              </select>
            </label>
            <p className="mt-s2 max-w-prose text-xs text-warning" data-cse="format-offen">
              {/*
                * Regel 3: keine vorgetäuschte Integration. Die Auswahl nennt
                * alle Formate, damit sichtbar ist, was fehlt — und der Versuch
                * endet in einer Auskunft statt in einem halb gelesenen LV.
                */}
              <strong>Offen (O-41):</strong> in welchem Format die
              Leistungsverzeichnisse ankommen — GAEB DA XML (X83/X84), GAEB D8x,
              Excel oder PDF — ist nicht entschieden. Verarbeitet wird bis zur
              Antwort <strong>nur CSV mit Semikolon</strong>; jedes andere Format
              wird abgewiesen und nicht halb gelesen.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="datei">
              Datei
            </label>
            <input
              id="datei"
              type="file"
              name="datei"
              accept=".csv,text/csv,text/plain"
              required
              className="mt-s2 block min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />
            <p className="mt-s2 text-xs text-text-subtle">
              Höchstens 5 MB und {String(MAX_IMPORT_ZEILEN)} Zeilen.
            </p>

            <div className="mt-s4">
              <Button type="submit" variante="primary">Datei prüfen</Button>
            </div>
          </form>

          {daten.verlauf.length > 0 && (
            <section className="mt-s6" data-cse="import-verlauf">
              <h2 className="mb-s3 text-h3 text-text">Frühere Importe</h2>
              <p className="mb-s3 max-w-prose text-sm text-text-muted">
                Jeder Lauf bleibt aufgezeichnet — auch der verworfene. Wie das
                heutige Leistungsverzeichnis entstanden ist, ist eine
                GoBD-Frage und keine Frage des Geschmacks.
              </p>
              <DataTable
                beschriftung="Frühere LV-Importe dieses Projekts"
                zeilen={daten.verlauf}
                schluessel={(z) => z.id}
                spalten={[
                  { schluessel: 'angelegt', kopf: 'Angelegt', zelle: (z) => z.angelegt_lokal },
                  { schluessel: 'datei', kopf: 'Datei', zelle: (z) => z.dateiname },
                  {
                    schluessel: 'format',
                    kopf: 'Format',
                    zelle: (z) => LV_FORMAT_TEXT[z.format] ?? z.format,
                  },
                  {
                    schluessel: 'zeilen',
                    kopf: 'Zeilen',
                    numerisch: true,
                    zelle: (z) => `${String(z.zeilen_gueltig)} / ${String(z.zeilen_gesamt)}`,
                  },
                  {
                    schluessel: 'fassung',
                    kopf: 'Fassung',
                    numerisch: true,
                    zelle: (z) => (z.lv_fassung === null ? '—' : String(z.lv_fassung)),
                  },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (z) => <StatusPill zustand={STATUSPILLE[z.status] ?? 'Entwurf'} />,
                  },
                ]}
              />
            </section>
          )}
        </>
      ) : (
        <>
          <dl className="m-0 mb-s5 grid grid-cols-2 gap-s4 sm:grid-cols-6">
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Datei</dt>
              <dd className="m-0 mt-s1 text-sm text-text">{kopf.dateiname}</dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Format</dt>
              <dd className="m-0 mt-s1 text-sm text-text">
                {LV_FORMAT_TEXT[kopf.format] ?? kopf.format}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Zeilen</dt>
              <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
                {String(kopf.zeilen_gesamt)}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Gültig</dt>
              <dd className="m-0 mt-s1 cse-zahl text-sm text-text" data-cse="gueltigzahl">
                {String(kopf.zeilen_gueltig)}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Mit Fehler
              </dt>
              <dd className="m-0 mt-s1 cse-zahl text-sm text-text" data-cse="fehlerzahl">
                {String(kopf.zeilen_fehler)}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Fehlen in der Datei
              </dt>
              <dd
                className={`m-0 mt-s1 cse-zahl text-sm ${kopf.fehlende_oz.length > 0 ? 'text-warning' : 'text-text'}`}
                data-cse="fehlendezahl"
              >
                {String(kopf.fehlende_oz.length)}
              </dd>
            </div>
          </dl>

          {kopf.fehlende_oz.length > 0 && (
            /*
             * **Die Streichungen gehören in die Vorschau.** Die neue Fassung
             * entsteht ausschliesslich aus den Zeilen der Datei — eine
             * Position der aktuellen Fassung, die hier nicht vorkommt, ist
             * damit weg. Das stand nirgends, und der Begleittext behauptete
             * sogar das Gegenteil („In die neue Fassung gehen alle gültigen
             * Zeilen"): das gilt für die Zeilen DIESER DATEI, nicht für den
             * Bestand.
             */
            <section
              className="mb-s5 rounded-lg border border-line bg-surface p-s5"
              data-cse="fehlende-positionen"
            >
              <h2 className="m-0 mb-s2 text-base font-semibold text-warning">
                {String(kopf.fehlende_oz.length)} Positionen der aktuellen Fassung
                fehlen in dieser Datei
              </h2>
              <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
                Übernommen wird, was in der Datei steht. Diese Ordnungszahlen stehen
                nicht darin und wären in der neuen Fassung nicht mehr enthalten — die
                bisherige Fassung bleibt als Beleg lesbar, aber gebucht wird künftig
                auf der neuen. Ob eine Teildatei das Leistungsverzeichnis{' '}
                <em>fortschreibt</em> (die fehlenden Positionen kommen mit) oder{' '}
                <em>ersetzt</em> (sie fallen weg), ist eine Frage an die
                Auftraggeberin und <strong>offen (O-633)</strong>; heute wird
                ersetzt, und diese Liste sagt, was das kostet.
              </p>
              <p className="m-0 font-mono text-xs text-text" data-cse="fehlende-oz">
                {kopf.fehlende_oz.join(' · ')}
              </p>
            </section>
          )}

          {!kopf.preis_verglichen && (
            <p className="mb-s4 max-w-prose text-sm text-warning" data-cse="preis-nicht-verglichen">
              Die Einheitspreise konnten beim Vergleich nicht beurteilt werden
              (Recht <code>bau.preis_lesen</code> fehlte beim Hochladen). „Unverändert"
              heisst hier deshalb: Text, Einheit und Menge sind gleich — über den
              Preis sagt die Vorschau nichts.
            </p>
          )}

          <DataTable
            beschriftung="Vorschau: was die Übernahme in der neuen Fassung anlegen würde"
            zeilen={daten.zeilen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'nr', kopf: 'Zeile', numerisch: true,
                zelle: (z) => String(z.zeilennummer),
              },
              { schluessel: 'oz', kopf: 'OZ', zelle: (z) => z.oz ?? '—' },
              {
                schluessel: 'art',
                kopf: 'Art',
                zelle: (z) => (z.art === null ? '—' : ART_TEXT[z.art] ?? z.art),
              },
              { schluessel: 'kurztext', kopf: 'Kurztext', zelle: (z) => z.kurztext ?? '—' },
              {
                schluessel: 'menge', kopf: 'Menge', numerisch: true,
                zelle: (z) => (z.menge === null
                  ? <span className="text-text-subtle">—</span>
                  : `${formatiereMenge(mengeAusPostgresOderNull(z.menge))} ${z.einheit ?? ''}`),
              },
              {
                schluessel: 'preis', kopf: 'Einheitspreis', numerisch: true,
                zelle: (z) => (z.einheitspreis_cent === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(cent(BigInt(z.einheitspreis_cent)))),
              },
              {
                schluessel: 'aktion',
                kopf: 'Übernahme',
                zelle: (z) => (
                  <span className="inline-flex flex-col gap-s1">
                    <span className="inline-flex items-center gap-s2">
                      <StatusPill zustand={AKTIONSPILLE[z.aktion] ?? 'Fehler'} />
                      <span className="text-xs text-text-muted">
                        {AKTION_TEXT[z.aktion] ?? z.aktion}
                      </span>
                    </span>
                    {z.fehler.length === 0 ? null : (
                      <span className="text-xs text-warning">{z.fehler.join(' · ')}</span>
                    )}
                    {/*
                      * Hinweis ≠ Fehler: die Zeile kommt mit, und etwas an ihr
                      * wurde angepasst — heute der Preis auf einer Zeile, die
                      * keine Position ist (Titelsumme). Ihn stillschweigend
                      * fallen zu lassen wäre eine verschwundene Zahl.
                      */}
                    {z.hinweise.length === 0 ? null : (
                      <span className="text-xs text-text-muted" data-cse="zeilenhinweis">
                        {z.hinweise.join(' · ')}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />

          <p className="mt-s3 max-w-prose text-xs text-text-subtle">
            Die Pille sagt, was sich gegenüber der aktuellen Fassung ÄNDERT — nicht,
            ob die Zeile mitkommt. In die neue Fassung gehen alle gültigen Zeilen{' '}
            <strong>dieser Datei</strong>, auch die unveränderten; fehlerhafte Zeilen
            bleiben zurück. Was in der Datei gar nicht vorkommt, kommt auch nicht in
            die neue Fassung — deshalb steht die Zahl „Fehlen in der Datei" oben
            neben den anderen.
          </p>
          <p className="mt-s2 max-w-prose text-xs text-text-subtle">
            Die Einheitspreise wandern in die neue Fassung — aber nur durch den
            geprüften Leser: wer <code>bau.preis_lesen</code> nicht hält, überträgt
            sie nicht, und die Fassung bleibt in Mengen und Texten vollständig und
            ohne Preise. Einen Preis zu schreiben, den niemand gesehen hat, wäre
            eine Kalkulation aus zweiter Hand (K-05). Ob die Preise des
            Auftraggebers überhaupt als <em>Vertragspreise</em> gelten oder nach der
            Übernahme kalkuliert werden, ist offen <strong>(O-631)</strong>.
          </p>

          {schonUebernommen ? (
            <p
              data-cse="import-uebernommen"
              className="mt-s5 rounded-md border border-line bg-surface p-s4 text-sm text-text-muted"
            >
              Dieser Import ist übernommen{kopf.uebernommen_lokal === null
                ? ''
                : ` (${kopf.uebernommen_lokal})`}
              {kopf.lv_fassung === null ? '' : ` — Fassung ${String(kopf.lv_fassung)}`}.
              Ein zweiter Lauf derselben Datei legte eine weitere Fassung an, die sich
              von dieser nicht unterscheidet.
              {darf['bau.lesen'] === true && (
                <>
                  {' '}
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${id}/lv`}
                    className="text-brand underline-offset-2 hover:underline"
                  >
                    Zum Leistungsverzeichnis
                  </Link>
                </>
              )}
            </p>
          ) : (
            <div className="mt-s5 flex flex-wrap items-start gap-s4">
              {uebernehmbar ? (
                <form method="post" action="/api/bau/lv-import">
                  <input type="hidden" name="aktion" value="uebernehmen" />
                  <input type="hidden" name="import" value={kopf.id} />
                  <input type="hidden" name="mandant" value={mandant} />
                  <input type="hidden" name="projekt" value={id} />
                  <Button type="submit" variante="primary">
                    Übernehmen — neue Fassung anlegen
                  </Button>
                </form>
              ) : (
                <p
                  className="rounded-md border border-line bg-surface p-s4 text-sm text-warning"
                  data-cse="nicht-uebernehmbar"
                >
                  {kopf.status === 'verworfen'
                    ? 'Dieser Import ist verworfen.'
                    : 'Keine Zeile ist übernehmbar. Eine leere Fassung anzulegen wäre '
                      + 'eine Fassung, die nichts belegt.'}
                </p>
              )}

              {kopf.status === 'geprueft' && (
                <form method="post" action="/api/bau/lv-import">
                  <input type="hidden" name="aktion" value="verwerfen" />
                  <input type="hidden" name="import" value={kopf.id} />
                  <input type="hidden" name="mandant" value={mandant} />
                  <input type="hidden" name="projekt" value={id} />
                  <input type="hidden" name="zurueck" value={pfad} />
                  <Button type="submit" variante="secondary">Verwerfen</Button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </PortalRahmen>
  );
}

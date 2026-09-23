import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { kennungOder404 } from '../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/angebote/[id]` — ein Angebot, seine Positionen und die
 * beiden Uebergaenge, die es hat.
 *
 * **Die Knoepfe sind Formulare, keine Links.** Versenden und Wandeln sind
 * POST auf `/api/angebot`: ein GET, das etwas aus dem Haus laesst, waere eine
 * Handlung, die ein weitergeleiteter Link ausloest — und Invariante 7 verlangt
 * eine Handlung, die jemand entschieden hat.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Rückmeldungen der Berichtigung (V-130, D-562).
 *
 * Der Schlüssel kommt als `?fehler=` zurück, weil der Weg ein FORMULAR ist:
 * eine JSON-Antwort wäre eine weisse Seite mit einem Fehlerobjekt darauf, und
 * der getippte Text wäre weg.
 */
const FEHLER_TEXT: Readonly<Record<string, string>> = {
  nicht_gefunden: 'Diese Position gibt es nicht — oder sie ist bereits entfernt.',
  schon_versendet: 'Dieses Angebot ist versendet und damit unveränderlich. '
    + 'Eine Änderung ist eine neue Version mit Rückverweis auf diese.',
  schon_zurueckgezogen: 'Dieser Entwurf ist bereits zurückgezogen.',
  letzte_position: 'Das ist die letzte Leistungsposition. Ein Angebot ohne Leistung '
    + 'ist keines — entweder eine andere Position anlegen oder den ganzen Entwurf '
    + 'zurückziehen.',
  kein_text: 'Eine Position ohne Kurztext ist keine Position.',
  keine_menge: 'Das ist keine Menge. Höchstens drei Nachkommastellen, kein '
    + 'Tausenderpunkt — „10,5" oder „10.5".',
  kein_betrag: 'Das ist kein Betrag in deutscher Schreibweise. Punkt trennt die '
    + 'Tausender, Komma die Cent — „1.250,00".',
  abgewiesen: 'Die Änderung wurde abgewiesen.',
};

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', in_pruefung: 'In Prüfung', versendet: 'Angebot',
  angenommen: 'Aktiv', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Archiviert',
  abgelaufen: 'Überfällig',
};

interface Kopf {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly einleitungstext: string | null;
  readonly status: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
  readonly versendet_am: string | null;
  /**
   * Seit der Auftrennung ein EIGENER Zustand zwischen Entwurf und Versand.
   *
   * `versendeAngebot` setzte `freigegeben_*` und `versendet_*` in einem
   * UPDATE; der Rechtekatalog fuehrt `angebot.preis_freigeben` (super_admin,
   * leitung) und `angebot.versenden` (zusaetzlich admin) getrennt. Der Knopf
   * unten bleibt deshalb gesperrt, solange den Preis niemand verantwortet hat.
   */
  readonly freigegeben_am: string | null;
  readonly archiviert_am: string | null;
  readonly freigegeben_von: string | null;
  readonly auftragsnummer: string | null;
  readonly kalkulation_offen: boolean;
  /**
   * Zwei Rechte, die das Tor dieser Seite NICHT verlangt.
   *
   * Die Seite steht hinter `angebot.lesen`, liest aber zwei Tabellen mit
   * eigenen Policies: `auftrag` verlangt `auftrag.lesen`, die Sicht
   * `kalkulation_platzhalter` (security_invoker) verlangt
   * `kalkulation.lesen`. Wem eines davon fehlt, dem antwortet die Datenbank
   * korrekt mit NICHTS — und ohne diese beiden Merker haette die Seite daraus
   * „es gibt keinen Auftrag“ und „die Kalkulation ist bestaetigt“ gemacht.
   * Beides waere eine Aussage ueber die DATEN gewesen statt ueber die
   * Berechtigung, und die zweite haette den Versandknopf freigegeben.
   */
  readonly darf_auftrag_lesen: boolean;
  readonly darf_kalkulation_lesen: boolean;
}

interface PositionZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly typ: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly gesamtpreis_cent: string;
  readonly steuersatz_bp: number;
}

interface SteuerZeile {
  readonly steuersatz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

export default async function AngebotDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = suche['gespeichert'] === '1';
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/angebote/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  /**
   * Die Rechte der drei neuen Nachbarseiten — Preisfreigabe, Versand, Annahme.
   *
   * Jede oeffnet mit ihrem eigenen Schluessel (Manifest). Ein Verweis ohne
   * diese Pruefung fuehrte fuer manche Rollen auf 404 und verriete damit, was
   * er nicht zeigen darf (AUT-06, D-581).
   */
  const darfNachbar = await haeltRechte(
    sitzung, 'angebot.preis_freigeben', 'angebot.versenden', 'angebot.annahme_erfassen',
    /* V-130: die Berichtigung eines Entwurfs — dasselbe Recht wie das Anlegen. */
    'angebot.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.angebotsnummer, a.titel, a.einleitungstext, a.status::text as status,
                k.name as kunde, a.kunde_id, o.bezeichnung as objekt,
                a.netto_cent::text,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.versendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as versendet_am,
                to_char(a.freigegeben_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as freigegeben_am,
                to_char(a.archiviert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as archiviert_am,
                fb.name as freigegeben_von,
                (select t.auftragsnummer from auftrag t where t.angebot_id = a.id)
                  as auftragsnummer,
                exists (select 1 from kalkulation_platzhalter kp where kp.angebot_id = a.id)
                  as kalkulation_offen,
                (select app.hat_recht('auftrag.lesen', app.aktiver_mandant()))
                  as darf_auftrag_lesen,
                (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant()))
                  as darf_kalkulation_lesen
           from angebot a
           join kunde k on k.id = a.kunde_id
           left join objekt o on o.id = a.objekt_id
           left join benutzer fb on fb.id = a.freigegeben_von
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const positionen = await kontext.abfrage<PositionZeile>(
        `select id, position_nr, typ::text as typ, kurztext, langtext,
                menge::text, einheit, einzelpreis_cent::text, gesamtpreis_cent::text,
                steuersatz_bp
           from angebotsposition
          where angebot_id = $1 and entfernt_am is null
          order by position_nr`, [id]);
      const steuer = await kontext.abfrage<SteuerZeile>(
        `select steuersatz_bp, netto_cent::text, steuer_cent::text
           from angebot_steuer where angebot_id = $1 order by steuersatz_bp`, [id]);
      return { kopf, positionen, steuer };
    })) as Promise<{
      kopf: Kopf; positionen: readonly PositionZeile[]; steuer: readonly SteuerZeile[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, positionen, steuer } = daten;
  const versendet = kopf.versendet_am !== null;
  const steuerSumme = steuer.reduce((s, z) => s + BigInt(z.steuer_cent), 0n);
  /**
   * **Berichtigt wird nur ein ENTWURF, und nur mit dem Schreibrecht**
   * (V-130, D-620).
   *
   * Drei Bedingungen, und jede für sich: nach dem Versand weist
   * `ap_unveraenderlich` (0024) jeden Schreibversuch ab; ein zurückgezogener
   * Entwurf wird nicht wiederbelebt (`angebot_05_rueckzug`); und ohne
   * `angebot.schreiben` fiele die Route in `authorize`. Die Oberfläche zeigt
   * deshalb gar nichts an, statt einen Knopf hinzustellen, der in einen
   * Fehler läuft.
   */
  const bearbeitbar = !versendet && kopf.status !== 'zurueckgezogen'
    && darfNachbar['angebot.schreiben'] === true;
  const pfad = `/portal/${mandant}/angebote/${id}`;
  const feld = 'min-h-11 rounded-md border border-line bg-surface px-s3 py-s2 '
    + 'text-sm text-text';

  return (
    <PortalRahmen
      titel={kopf.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={versendet}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/angebote`, text: 'Alle Angebote' }}
    >
      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.titel}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} />
      </div>

      {fehler !== null && (
        <Hinweis art="warnung" cse="entwurf-fehler" className="mb-s5 max-w-prose">
          {FEHLER_TEXT[fehler] ?? 'Die Änderung wurde abgewiesen.'}
        </Hinweis>
      )}
      {gespeichert && fehler === null && (
        <Hinweis art="erfolg" cse="entwurf-gespeichert" className="mb-s5 max-w-prose">
          Gespeichert.
        </Hinweis>
      )}
      {kopf.status === 'zurueckgezogen' && (
        <Hinweis art="hinweis" cse="entwurf-zurueckgezogen" className="mb-s5 max-w-prose">
          <strong>Dieser Entwurf ist zurückgezogen</strong>
          {kopf.archiviert_am === null ? '' : ` — am ${kopf.archiviert_am}`}. Er steht
          nicht mehr in der Arbeitsliste und geht nicht mehr hinaus. Gelöscht ist er
          nicht: was einmal dastand, bleibt nachlesbar (Invariante 8).
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.angebotsnummer ?? (
              <span className="text-text-subtle">entsteht beim Versand</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Objekt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.objekt ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Versendet</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.versendet_am ?? <span className="text-text-subtle">noch nicht</span>}
          </dd>
        </div>
      </dl>

      {kopf.kalkulation_offen ? (
        <p
          data-cse="kalkulation-offen"
          className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>Die Kalkulation steht auf unbestätigten Werten (O-16).</strong> Solange
          das so ist, lässt sich dieses Angebot nicht versenden — ein
          eingefrorener Preis auf offenen Fragen sieht prüfbar aus und ist es
          nicht.
        </p>
      ) : null}

      {kopf.kalkulation_offen && kopf.darf_kalkulation_lesen ? (
        <p className="mb-s5 text-sm text-text">
          {/*
            * Als Zeichenkette, NICHT als `{ pathname, query }`.
            *
            * Im App Router setzt `Link` die dynamischen Segmente eines
            * Objektziels nicht ein: `/portal/[mandant]/…` bleibt woertlich
            * stehen, und der Klick landet auf einer Adresse mit eckigen
            * Klammern — also auf 404. In den Pages Router war es umgekehrt.
            * Der Build merkt es nicht, weil das Muster gueltig ist.
            */}
          <Link
            href={`/portal/${mandant}/angebote/${id}/kalkulation`}
            data-cse="zur-kalkulation"
            /*
             * `text-text` mit Marke erst beim Hover — wie jeder andere Link
             * im Portal. CSE-Rot auf dem dunklen Grund erreicht den
             * WCAG-AA-Kontrast nicht (DESIGN §9: Farbe ist nie das einzige
             * Signal, und sie muss lesbar sein).
             */
            className="text-text underline underline-offset-2 hover:text-brand"
          >
            Werte bestätigen und den Rechenweg ansehen →
          </Link>
        </p>
      ) : null}

      {kopf.darf_kalkulation_lesen ? null : (
        <p
          data-cse="kalkulation-verdeckt"
          className="mb-s5 rounded-md border border-line bg-surface-2 p-s4 text-sm text-text-muted"
        >
          <strong>Der Kalkulationsstand ist Ihnen nicht sichtbar.</strong> Ihnen
          fehlt <Recht schluessel="kalkulation.lesen" />; die
          Datenbank antwortet deshalb mit nichts, und das heißt hier
          ausdrücklich nicht „alles bestätigt“. Der Versand bleibt gesperrt,
          weil sich seine Voraussetzung von hier aus nicht prüfen lässt.
        </p>
      )}

      {!versendet && kopf.freigegeben_am === null ? (
        <p
          data-cse="freigabe-fehlt"
          className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>Der Preis ist nicht freigegeben.</strong> Das ist ein eigener
          Vorgang mit eigenem Recht (
          <Recht schluessel="angebot.preis_freigeben" />) und
          deshalb nicht derselbe Klick wie der Versand: der Vertrieb schickt
          hinaus, die Leitung verantwortet den Preis.{' '}
          {darfNachbar['angebot.preis_freigeben'] === true ? (
            <Link
              href={`/portal/${mandant}/angebote/${id}/freigabe`}
              data-cse="zur-freigabe"
              className="text-text underline underline-offset-2 hover:text-brand"
            >
              Zur Preisfreigabe →
            </Link>
          ) : (
            <>Ihnen fehlt dieses Recht; die Freigabe erklärt die Leitung.</>
          )}
        </p>
      ) : null}

      {!versendet && kopf.freigegeben_am !== null ? (
        <p data-cse="freigabe-erteilt" className="mb-s5 text-sm text-text">
          <strong>Preis freigegeben</strong> am {kopf.freigegeben_am}
          {kopf.freigegeben_von === null ? '' : ` von ${kopf.freigegeben_von}`}.
          Der Versand ist damit frei.
        </p>
      ) : null}

      <DataTable
        beschriftung="Positionen dieses Angebots"
        zeilen={positionen}
        schluessel={(z) => z.id}
        spalten={[
          { schluessel: 'nr', kopf: 'Pos.', numerisch: true, zelle: (z) => String(z.position_nr) },
          {
            schluessel: 'text',
            kopf: 'Leistung',
            zelle: (z) => (
              <span>
                {z.kurztext}
                {z.langtext === null ? null : (
                  <span className="block text-xs text-text-muted">{z.langtext}</span>
                )}
              </span>
            ),
          },
          {
            schluessel: 'menge',
            kopf: 'Menge',
            numerisch: true,
            zelle: (z) => (z.menge === null
              ? <span className="text-text-subtle">—</span>
              : `${formatiereMenge(mengeAusPostgresOderNull(z.menge))} ${z.einheit ?? ''}`),
          },
          {
            schluessel: 'einzel',
            kopf: 'Einzelpreis',
            numerisch: true,
            zelle: (z) => (z.einzelpreis_cent === null
              ? <span className="text-text-subtle">—</span>
              : formatiereGeld(cent(BigInt(z.einzelpreis_cent)))),
          },
          {
            schluessel: 'gesamt',
            kopf: 'Gesamt',
            numerisch: true,
            zelle: (z) => formatiereGeld(cent(BigInt(z.gesamtpreis_cent))),
          },
          {
            schluessel: 'steuer',
            kopf: 'USt.',
            numerisch: true,
            zelle: (z) => `${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`,
          },
          /*
           * **Die Bearbeiten-Spalte gibt es nur am ENTWURF** (V-130, D-620).
           *
           * Nach dem Versand weist `ap_unveraenderlich` (0024) jeden
           * Schreibversuch ab; eine Spalte, deren Knöpfe immer in einen
           * Fehler laufen, ist schlechter als keine. Und ohne
           * `angebot.schreiben` steht sie ebenfalls nicht da — ein
           * abgeblendeter Knopf verrät dasselbe wie ein offener, er ist nur
           * höflicher dabei (AUT-06).
           */
          ...(bearbeitbar ? [{
            schluessel: 'handlung',
            kopf: '',
            zelle: (z: PositionZeile) => (
              <details data-cse="position-bearbeiten" data-position={z.id}>
                <summary className="cursor-pointer text-sm text-brand">Berichtigen</summary>
                <form method="post" action="/api/angebot/entwurf"
                      className="mt-s3 flex w-72 flex-col gap-s2">
                  <input type="hidden" name="was" value="berichtigen" />
                  <input type="hidden" name="position" value={z.id} />
                  <input type="hidden" name="zurueck" value={pfad} />
                  <label className="text-xs text-text-muted" htmlFor={`kt-${z.id}`}>
                    Kurztext
                  </label>
                  <input id={`kt-${z.id}`} name="kurztext" type="text" required
                         defaultValue={z.kurztext} className={feld} />
                  <label className="text-xs text-text-muted" htmlFor={`lt-${z.id}`}>
                    Langtext
                  </label>
                  <textarea id={`lt-${z.id}`} name="langtext" rows={2}
                            defaultValue={z.langtext ?? ''} className={feld} />
                  {/*
                    * Menge, Einheit und Preis nur bei einer Position, die
                    * welche HAT: `ap_text_ohne_preis` weist eine Textzeile
                    * mit Preis ab, und ein Feld, das die Datenbank ohnehin
                    * zurückweist, ist eine Einladung zu einem Fehler.
                    */}
                  {z.typ === 'text' || z.typ === 'zwischensumme' ? null : (
                    <>
                      <label className="text-xs text-text-muted" htmlFor={`mg-${z.id}`}>
                        Menge (leer = unverändert)
                      </label>
                      <input id={`mg-${z.id}`} name="menge" type="text" inputMode="decimal"
                             placeholder={z.menge === null ? '' : z.menge} className={feld} />
                      <label className="text-xs text-text-muted" htmlFor={`eh-${z.id}`}>
                        Einheit
                      </label>
                      <input id={`eh-${z.id}`} name="einheit" type="text"
                             defaultValue={z.einheit ?? ''} className={feld} />
                      <label className="text-xs text-text-muted" htmlFor={`pr-${z.id}`}>
                        Einzelpreis in Euro (leer = unverändert)
                      </label>
                      <input id={`pr-${z.id}`} name="preis" type="text" inputMode="decimal"
                             placeholder="1.250,00" className={feld} />
                    </>
                  )}
                  <button type="submit" data-cse="position-speichern"
                          className="min-h-11 rounded-md bg-brand px-s4 py-s2 text-sm
                                     font-semibold text-white hover:bg-brand-hover">
                    Speichern
                  </button>
                </form>
                {/*
                  * Ein EIGENES Formular: „Entfernen" ist keine Variante des
                  * Speicherns, und ein zweiter Knopf im selben Formular
                  * schickte die halb getippten Felder mit.
                  */}
                <form method="post" action="/api/angebot/entwurf" className="mt-s2">
                  <input type="hidden" name="was" value="entfernen" />
                  <input type="hidden" name="position" value={z.id} />
                  <input type="hidden" name="zurueck" value={pfad} />
                  <button type="submit" data-cse="position-entfernen"
                          className="min-h-11 text-sm text-danger underline underline-offset-2">
                    Position entfernen
                  </button>
                </form>
              </details>
            ),
          }] : []),
        ]}
      />

      <dl
        data-cse="angebot-summe"
        className="m-0 mt-s5 grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
      >
        <dt className="text-sm text-text-muted">Netto</dt>
        <dd data-cse="netto" className="m-0 cse-zahl text-sm text-text">
          {formatiereGeld(cent(BigInt(kopf.netto_cent)))}
        </dd>
        {steuer.map((z) => (
          <div key={z.steuersatz_bp} className="contents">
            <dt className="text-sm text-text-muted">
              {`Umsatzsteuer ${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`}
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {formatiereGeld(cent(BigInt(z.steuer_cent)))}
            </dd>
          </div>
        ))}
        {versendet ? (
          <>
            <dt className="text-h3 text-text">Brutto</dt>
            <dd className="m-0 cse-zahl text-h3 text-text">
              {formatiereGeld(cent(BigInt(kopf.netto_cent) + steuerSumme))}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-sm text-text-muted">Brutto</dt>
            <dd className="m-0 text-sm text-text-subtle">
              entsteht beim Versand, je Steuersatzgruppe
            </dd>
          </>
        )}
      </dl>

      <div className="mt-s6 flex flex-wrap items-center gap-s4">
        {versendet ? (
          <Link
            href={`/portal/${mandant}/angebote/${id}/pdf`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            Angebotsdokument
          </Link>
        ) : (
          <form method="post" action={`/api/angebot?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="versenden" />
            <input type="hidden" name="angebotId" value={id} />
            <button
              type="submit"
              data-cse="versenden"
              /*
                * Die Freigabe steht MIT in der Bedingung. Ohne sie weist der
                * Dienst ab („Ohne Preisfreigabe kein Versand") — und ein
                * Knopf, dessen Route abweist, ist ein Fehlerbericht mit
                * Verzoegerung.
                */
              disabled={kopf.kalkulation_offen || !kopf.darf_kalkulation_lesen
                || kopf.freigegeben_am === null}
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Angebot versenden
            </button>
          </form>
        )}

        {/*
          * Die Versandseite als LANGER Weg daneben: sie zeigt Empfaenger,
          * Dokument, die drei Sperren und den Versandkanal. Der Knopf hier ist
          * der kurze Weg fuer den Fall, dass alles steht — beide laufen durch
          * denselben Dienst.
          */}
        {!versendet && kopf.status !== 'zurueckgezogen'
          && darfNachbar['angebot.versenden'] === true ? (
            <Link
              href={`/portal/${mandant}/angebote/${id}/versand`}
              data-cse="zum-versand"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
            >
              Versand vorbereiten
            </Link>
          ) : null}

        {/*
          * **Den ganzen Entwurf zurückziehen** (V-130, D-620).
          *
          * Er verlässt die Arbeitsliste, nicht die Datenbank: `status` sagt
          * WARUM er weg ist, `archiviert_am` nimmt ihn aus den Listen, die
          * darauf filtern. Gelöscht wird nichts (Invariante 8).
          *
          * Kein zweites Augenpaar davor, und das ist kein Versehen: ein
          * Entwurf ohne Nummer hat das Haus nie verlassen, es gibt keinen
          * Empfänger, der sich darauf verlassen hätte, und der Vermerk bleibt
          * für jeden Prüfer stehen. Das VERSENDETE Angebot ist der andere
          * Fall — dort verlangt `angebot_rueckzug_ehrlich` eine Freigabe.
          */}
        {bearbeitbar ? (
          <form method="post" action="/api/angebot/entwurf">
            <input type="hidden" name="was" value="zurueckziehen" />
            <input type="hidden" name="angebot" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <button
              type="submit"
              data-cse="entwurf-zurueckziehen"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-danger hover:bg-surface-2"
            >
              Entwurf zurückziehen
            </button>
          </form>
        ) : null}

        {versendet && kopf.auftragsnummer === null
          && darfNachbar['angebot.annahme_erfassen'] === true ? (
            <Link
              href={`/portal/${mandant}/angebote/${id}/annahme`}
              data-cse="zur-annahme"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
            >
              Entscheidung des Kunden erfassen
            </Link>
          ) : null}

        {versendet && kopf.auftragsnummer === null && kopf.darf_auftrag_lesen ? (
          <form method="post" action={`/api/angebot?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="in_auftrag" />
            <input type="hidden" name="angebotId" value={id} />
            <input type="hidden" name="art" value="rahmenvertrag" />
            <input
              type="hidden"
              name="startDatum"
              /**
               * Der BERLINER Kalendertag, nicht der von UTC. In den ersten
               * Stunden eines Berliner Tages liegt `toISOString()` noch auf
               * dem Vortag — und der Auftrag begaenne einen Tag zu frueh.
               */
              value={berlinKalendertag(new Date())}
            />
            <button
              type="submit"
              data-cse="in-auftrag"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Angenommen — Auftrag anlegen
            </button>
          </form>
        ) : null}

        {kopf.auftragsnummer === null ? null : (
          <p className="m-0 text-sm text-text-muted">
            {`Auftrag ${kopf.auftragsnummer} entstanden.`}
          </p>
        )}

        {kopf.darf_auftrag_lesen ? null : (
          <p data-cse="auftrag-verdeckt" className="m-0 text-sm text-text-muted">
            Ob aus diesem Angebot bereits ein Auftrag entstanden ist, ist Ihnen
            nicht sichtbar — dafür fehlt <Recht schluessel="auftrag.lesen" />.
            Deshalb steht hier auch kein Knopf, der einen zweiten anlegen würde.
          </p>
        )}
      </div>
    </PortalRahmen>
  );
}

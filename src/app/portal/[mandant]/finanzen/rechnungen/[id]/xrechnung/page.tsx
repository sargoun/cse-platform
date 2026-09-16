import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import {
  KeinSnapshotFehler, ublZurRechnung,
} from '@/server/services/finanz/xrechnung/dienst';
import { SnapshotZuAltFehler } from '@/server/services/finanz/xrechnung/aus-snapshot';
import {
  XRechnungUnvollstaendigFehler, type FehlendesFeld,
} from '@/server/services/finanz/xrechnung/index';
import { pruefstand } from '@/server/services/finanz/xrechnung/pruefstand';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/xrechnung` — Vorschau und
 * Prüfstand (04-SEITENKARTE.md §5.14.3, FIN-11, LEG-05).
 *
 * **Die Seite behauptet NIE, das Dokument sei gültig.** §5.14.3 nennt genau
 * drei Zustände und verbietet einen vierten, der wie ein Bestehen aussieht:
 * „In CI validiert" mit der Fassung des Regelwerks, „Prüfung ausstehend" oder
 * „Prüfer nicht verbunden" — und die XRechnung bleibt in jedem Fall
 * herunterladbar. Eine erfundene Freigabe entdeckt der Empfänger, indem er
 * die Rechnung ablehnt.
 *
 * **Fehlt eine Pflichtangabe, steht hier die ganze Liste** — mit BT-Nummer,
 * Regel und dem Feld, in dem sie gepflegt wird. Nicht das erste fehlende
 * Feld: wer fünfmal hintereinander in dieselbe Maske geschickt wird, gibt
 * beim dritten Mal auf.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly kunde: string;
  readonly leitweg_id: string | null;
  readonly ist_pflicht: boolean;
}

type Lage =
  | { readonly art: 'ok'; readonly xml: string }
  | { readonly art: 'unvollstaendig'; readonly fehlend: readonly FehlendesFeld[] }
  | { readonly art: 'nicht_moeglich'; readonly meldung: string };

function Zustand({ art, text, regelwerk }: ReturnType<typeof pruefstand>) {
  /*
   * Drei Zustände, drei Töne — und „in CI validiert" ist NICHT grün im Sinne
   * von „diese Rechnung ist geprüft". Der Satz daneben sagt, worauf sich die
   * Aussage bezieht, weil eine Farbe allein sie zu einer Freigabe macht.
   */
  const ton = art === 'in_ci_validiert' ? 'text-text' : 'text-warning';
  return (
    <section
      className="mb-s5 rounded-lg border border-line bg-surface p-s5"
      data-cse="xrechnung-pruefstand"
      data-art={art}
    >
      <h2 className="mb-s2 text-h3 text-text">Prüfstand</h2>
      <p className={`m-0 max-w-prose text-sm ${ton}`}>{text}</p>
      {regelwerk === null ? null : (
        <p className="m-0 mt-s2 text-xs text-text-muted">Regelwerk: {regelwerk}</p>
      )}
    </section>
  );
}

export default async function XRechnungBlatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(
    `/portal/${mandant}/finanzen/rechnungen/${id}/xrechnung`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status, k.name as kunde,
                k.leitweg_id,
                (k.xrechnung_pflicht or k.ist_oeffentlicher_auftraggeber) as ist_pflicht
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
          where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, lage: null };

      let lage: Lage;
      try {
        const ergebnis = await ublZurRechnung(kontext, id);
        lage = ergebnis === null
          ? { art: 'nicht_moeglich', meldung: 'Diese Rechnung ist nicht lesbar.' }
          : { art: 'ok', xml: ergebnis.xml };
      } catch (fehler) {
        if (fehler instanceof XRechnungUnvollstaendigFehler) {
          lage = { art: 'unvollstaendig', fehlend: fehler.fehlend };
        } else if (fehler instanceof SnapshotZuAltFehler
          || fehler instanceof KeinSnapshotFehler) {
          lage = { art: 'nicht_moeglich', meldung: fehler.message };
        } else {
          throw fehler;
        }
      }
      return { kopf, lage };
    })) as Promise<{ kopf: Kopf | null; lage: Lage | null }>);

  const k = daten.kopf;
  const lage = daten.lage;
  if (k === null || lage === null) notFound();

  const stand = pruefstand();

  return (
    <PortalRahmen
      titel="XRechnung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {k.nummer ?? 'Entwurf ohne Nummer'}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">XRechnung (UBL, EN 16931)</h1>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">Empfänger</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">XRechnung verlangt</dt>
          <dd className="text-sm text-text">{k.ist_pflicht ? 'ja' : 'nein'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Leitweg-ID (BT-10)</dt>
          <dd className="cse-zahl text-sm text-text" data-cse="leitweg-id">
            {k.leitweg_id ?? '—'}
          </dd>
        </div>
      </dl>

      <Zustand {...stand} />

      {lage.art === 'unvollstaendig' ? (
        <section className="mb-s5" data-cse="xrechnung-fehlend">
          <h2 className="mb-s3 text-h3 text-text">
            Es entsteht kein Dokument — {String(lage.fehlend.length)} Pflichtangabe(n) fehlen
          </h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            Ein Dokument mit Lücken sieht aus wie ein vollständiges und wird beim
            Empfänger abgewiesen. Es entsteht deshalb gar nicht erst.
          </p>
          <ul className="m-0 list-none space-y-s3 p-0">
            {lage.fehlend.map((f) => (
              <li key={f.bt} className="rounded-lg border border-line bg-surface p-s5">
                <p className="m-0 flex flex-wrap items-baseline gap-s3">
                  <span className="text-sm font-semibold text-danger">{f.bt}</span>
                  <span className="text-xs text-text-muted">{f.regel}</span>
                </p>
                <p className="m-0 mt-s2 max-w-prose text-sm text-text">{f.text}</p>
                <p className="m-0 mt-s2 text-xs text-text-muted">Zu pflegen unter {f.feld}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : lage.art === 'nicht_moeglich' ? (
        <section
          className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5"
          data-cse="xrechnung-nicht-moeglich"
        >
          <p className="m-0 max-w-prose text-sm text-warning">{lage.meldung}</p>
        </section>
      ) : (
        <>
          <p className="mb-s3">
            <a
              href={`/api/finanzen/rechnungen/${id}/xrechnung.xml`}
              className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-s4 text-base text-white"
              data-cse="xrechnung-herunterladen"
            >
              XRechnung herunterladen
            </a>
          </p>
          <h2 className="mb-s3 text-h3 text-text" id="vorschau-titel">Vorschau</h2>
          {/*
            * **`tabIndex` und `role` sind hier kein Beiwerk** (DESIGN §9,
            * BFSG/LEG-07). Ein Kasten, der rollt, muss mit der Tastatur
            * erreichbar sein — sonst kommt eine Person ohne Maus an die
            * Zeilen unterhalb der ersten vierzig gar nicht heran. axe nennt
            * das `scrollable-region-focusable`, und genau daran ist diese
            * Seite beim ersten Browserlauf gescheitert.
            *
            * Mit `tabIndex` braucht der Bereich einen NAMEN, sonst kündigt
            * ein Screenreader „Gruppe" an und sagt nichts über den Inhalt.
            */}
          <pre
            className="max-h-quelltext overflow-auto rounded-lg border border-line bg-surface p-s5 text-xs text-text"
            data-cse="xrechnung-vorschau"
            tabIndex={0}
            role="region"
            aria-labelledby="vorschau-titel"
          >
            {lage.xml}
          </pre>
        </>
      )}
    </PortalRahmen>
  );
}

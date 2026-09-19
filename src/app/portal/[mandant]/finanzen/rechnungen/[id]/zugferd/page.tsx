import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { KeinSnapshotFehler } from '@/server/services/finanz/xrechnung/dienst';
import { SnapshotZuAltFehler } from '@/server/services/finanz/xrechnung/aus-snapshot';
import {
  XRechnungUnvollstaendigFehler, type FehlendesFeld,
} from '@/server/services/finanz/xrechnung/index';
import { pruefstand } from '@/server/services/finanz/xrechnung/pruefstand';
import { CII_DATEINAME, CII_GUIDELINE } from '@/server/services/finanz/zugferd/cii';
import {
  summenprobe, zugferdVorschau, type ZugferdVorschau,
} from '@/server/services/finanz/zugferd/vorschau';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import {
  RECHNUNG_AUSGABE_TEXTE, type RechnungAusgabeTexte,
} from '@/lib/i18n/verwaltung/finanzen/rechnung-ausgabe';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/zugferd` — die PDF/A-3-Vorschau
 * (04-SEITENKARTE.md §5.14.3, FIN-12, LEG-05).
 *
 * **Die Seite behauptet NIE, das Dokument sei gültig.** veraPDF prüft das
 * PDF/A-3 in CI (`pnpm test:compliance`), nicht zur Laufzeit. Es gibt deshalb
 * genau drei erlaubte Zustände — „In CI validiert" mit der Fassung des
 * Regelwerks, „Prüfung ausstehend" oder „Prüfer nicht verbunden" — und keinen
 * vierten, der wie ein Bestehen aussieht. Dieselbe Regel, dieselbe Funktion
 * wie bei der XRechnung: `pruefstand()`.
 *
 * **Das PDF bleibt in jedem Fall herunterladbar.** Ein Dokument
 * zurückzuhalten, weil niemand es prüfen kann, hilft keinem Menschen — der
 * Empfänger wartet dann auf eine Rechnung, die vorhanden ist.
 *
 * **Gerendert wird aus `rechnung_snapshot`, nie aus lebenden Stammdaten**
 * (K-12). Ein Entwurf hat keinen Snapshot; dann gibt es keine Vorschau, und
 * das ist ein ZUSTAND und kein Fehler — die Rechnung entsteht mit der
 * Festschreibung.
 *
 * **Fehlt eine Pflichtangabe, steht die GANZE Liste da** — mit BT-Nummer,
 * Regel und dem Feld, in dem sie gepflegt wird. Wer fünfmal in dieselbe Maske
 * geschickt wird, gibt beim dritten Mal auf.
 *
 * **Die Summenprobe steht oben und nicht im Kleingedruckten.** `ciiSummen()`
 * addiert dieselbe Rechnung, die der PDF-Bauer schreibt; weicht sie von den
 * Kopfsummen des Belegs ab, ist das ein Dokument, das der Empfänger ablehnt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'ZUGFeRD — Rechnung' };

/* Ein Befehl, kein Wort — er lautet in beiden Sprachen gleich. */
const BEFEHL_COMPLIANCE = 'pnpm test:compliance';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly kunde: string;
  readonly rechnungsdatum: string | null;
}

type Lage =
  | { readonly art: 'ok'; readonly v: ZugferdVorschau }
  | { readonly art: 'unvollstaendig'; readonly fehlend: readonly FehlendesFeld[] }
  | { readonly art: 'nicht_moeglich'; readonly meldung: string };

function Zustand(
  /* `t` steht daneben, weil `text` und `regelwerk` aus dem Dienst kommen und
     die Ueberschrift nicht. */
  { art, text, regelwerk, t }:
  ReturnType<typeof pruefstand> & { readonly t: RechnungAusgabeTexte },
) {
  /*
   * Drei Zustände, drei Töne — und „in CI validiert" ist NICHT grün im Sinne
   * von „diese Rechnung ist geprüft". Der Satz daneben sagt, worauf sich die
   * Aussage bezieht, weil eine Farbe allein sie zu einer Freigabe macht.
   */
  const ton = art === 'in_ci_validiert' ? 'text-text' : 'text-warning';
  return (
    <section
      className="mb-s5 rounded-lg border border-line bg-surface p-s5"
      data-cse="zugferd-pruefstand"
      data-art={art}
    >
      <h2 className="mb-s2 text-h3 text-text">{t.pruefstand}</h2>
      <p className={`m-0 max-w-prose text-sm ${ton}`}>{text}</p>
      <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
        {t.veraPdfVor}
        <code>{BEFEHL_COMPLIANCE}</code>
        {t.veraPdfNach}
      </p>
      {regelwerk === null ? null : (
        <p className="m-0 mt-s2 text-xs text-text-muted">{t.regelwerk}: {regelwerk}</p>
      )}
    </section>
  );
}

export default async function ZugferdBlatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/zugferd`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Diese Seite öffnet mit `finanzen.herunterladen`; der Beleg daneben
   * verlangt `finanzen.lesen`. Wer die Datei ziehen darf, darf nicht
   * zwangsläufig den Beleg öffnen (AUT-06, D-581).
   */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AUSGABE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status, k.name as kunde,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
          where r.id = $1`, [id]);
      if (kopf === undefined) return { kopf: null, lage: null };

      let lage: Lage;
      try {
        const v = await zugferdVorschau(kontext, id);
        lage = v === null
          ? { art: 'nicht_moeglich', meldung: t.nichtLesbar }
          : { art: 'ok', v };
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
  const probe = lage.art === 'ok' ? summenprobe(lage.v) : null;

  return (
    <PortalRahmen
      titel="ZUGFeRD"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['finanzen.lesen'] === true ? (
        <nav aria-label={g.zurueck} className="mb-s3">
          <Link
            href={`/portal/${mandant}/finanzen/rechnungen/${id}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← {k.nummer ?? t.entwurfOhneNummer}
          </Link>
        </nav>
      ) : null}

      <h1 className="mb-s3 text-h1 text-text">{t.zugferdH1}</h1>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{t.empfaenger}</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.profil}</dt>
          <dd className="text-sm text-text" data-cse="zugferd-profil">{CII_GUIDELINE}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.eingebetteteDatei}</dt>
          <dd className="text-sm text-text" data-cse="zugferd-dateiname">{CII_DATEINAME}</dd>
        </div>
      </dl>

      <Zustand {...stand} t={t} />

      {probe !== null && !probe.ok ? (
        <Hinweis art="warnung" cse="zugferd-summenprobe" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>{t.summenprobeFehlgeschlagen}</strong>{' '}
            {t.abweichungBei}
            {probe.abweichungen.join(', ')}
            {t.summenprobeErklaerung}
          </p>
        </Hinweis>
      ) : null}

      {lage.art === 'unvollstaendig' ? (
        <section className="mb-s5" data-cse="zugferd-fehlend">
          <h2 className="mb-s3 text-h3 text-text">
            {t.keinDokumentVor}
            {String(lage.fehlend.length)}
            {t.pflichtangabenFehlen}
          </h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            {t.pdfOhneRechnung}
          </p>
          <ul className="m-0 list-none space-y-s3 p-0">
            {lage.fehlend.map((f) => (
              <li key={f.bt} className="rounded-lg border border-line bg-surface p-s5">
                <p className="m-0 flex flex-wrap items-baseline gap-s3">
                  <span className="text-sm font-semibold text-danger">{f.bt}</span>
                  <span className="text-xs text-text-muted">{f.regel}</span>
                </p>
                <p className="m-0 mt-s2 max-w-prose text-sm text-text">{f.text}</p>
                <p className="m-0 mt-s2 text-xs text-text-muted">
                  {t.zuPflegenUnter}
                  {f.feld}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : lage.art === 'nicht_moeglich' ? (
        <section
          className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5"
          data-cse="zugferd-nicht-moeglich"
        >
          <p className="m-0 max-w-prose text-sm text-warning">{lage.meldung}</p>
          <p className="m-0 mt-s2 max-w-prose text-xs text-warning">
            {t.ausSnapshotGerendert}
          </p>
        </section>
      ) : (
        <>
          <p className="mb-s3">
            <a
              href={`/api/finanzen/rechnungen/${id}/zugferd.pdf`}
              className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-s4 text-base text-white"
              data-cse="zugferd-herunterladen"
            >
              {t.zugferdHerunterladen}
            </a>
          </p>

          <h2 className="mb-s3 text-h3 text-text">{t.summenprobe}</h2>
          <dl
            data-cse="zugferd-summen"
            data-ok={String(probe?.ok ?? false)}
            className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
          >
            <div>
              <dt className="text-xs text-text-muted">{t.zeilensumme}</dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.zeilen)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.nachlassZuschlag}</dt>
              <dd className="cse-zahl text-sm text-text">
                −{formatiereGeld(lage.v.summen.nachlass)} / +
                {formatiereGeld(lage.v.summen.zuschlag)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.nettoBeleg}</dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.netto)} ·{' '}
                {formatiereGeld(lage.v.belegNettoCent)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.ustBeleg}</dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.steuer)} ·{' '}
                {formatiereGeld(lage.v.belegSteuerCent)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.bruttoBeleg}</dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.brutto)} ·{' '}
                {formatiereGeld(lage.v.belegBruttoCent)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.zahlbetragBeleg}</dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.zahlbetrag)} ·{' '}
                {formatiereGeld(lage.v.belegZahlbetragCent)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">
                {t.bereitsGezahlt}
              </dt>
              <dd className="cse-zahl text-sm text-text">
                {formatiereGeld(lage.v.summen.gezahlt)}
              </dd>
            </div>
          </dl>

          <p className="mb-s5 max-w-prose text-xs text-text-muted">
            {t.snapshotGestalt}
            {lage.v.schemaVersion}
            {t.festgeschriebenAm}
            {lage.v.festgeschriebenAm}
            {t.byteGleich}
          </p>

          <h2 className="mb-s3 text-h3 text-text" id="cii-titel">
            {t.eingebetteteRechnung} ({CII_DATEINAME})
          </h2>
          {/*
            * `tabIndex` und `role` sind hier kein Beiwerk (DESIGN §9,
            * BFSG/LEG-07): ein Kasten, der rollt, muss mit der Tastatur
            * erreichbar sein — sonst kommt eine Person ohne Maus an die
            * Zeilen unterhalb der ersten vierzig gar nicht heran. Mit
            * `tabIndex` braucht der Bereich einen NAMEN, sonst kündigt ein
            * Screenreader „Gruppe" an und sagt nichts über den Inhalt.
            */}
          <pre
            className="max-h-quelltext overflow-auto rounded-lg border border-line bg-surface p-s5 text-xs text-text"
            data-cse="zugferd-cii"
            tabIndex={0}
            role="region"
            aria-labelledby="cii-titel"
          >
            {lage.v.cii}
          </pre>
        </>
      )}
    </PortalRahmen>
  );
}

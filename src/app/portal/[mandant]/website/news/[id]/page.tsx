import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  NEUIGKEITS_ARTEN, beitragSegment, ladeBeitrag, type BeitragZeile,
} from '@/server/services/social/dienst';
import { STATUS_TEXT, moeglicheSchritte, SCHRITT_TEXT } from '@/server/services/social/weg';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';

/**
 * `/portal/[mandant]/website/news/[id]` — **die Vorschau dessen, was auf
 * `/unternehmen/<bereich>/news/<slug>` steht** (PRO-02, SOC-05).
 *
 * **Und ausdrücklich KEIN zweiter Editor.** Der Plan liess die Frage offen —
 * „zweite Oberfläche oder Weiterleitung"; entschieden ist: weder. Ein zweiter
 * Editor auf `beitrag` wären zwei Oberflächen mit einer Regel
 * (`services/social/weg.ts`), und die eine läuft ihr beim nächsten Umbau
 * hinterher: `/social/posts/[id]` hält die Zustandsknöpfe, die
 * Kanalergebnisse, den Freigabeverweis und die Bedingung „bearbeitet wird nur
 * der Entwurf" auf 422 Zeilen. Eine blosse Weiterleitung wäre andererseits
 * keine Seite: die Seitenkarte führt diese Adresse, weil die
 * Website-Redaktion eine Frage hat, die die Social-Seite nicht beantwortet —
 * **wie sieht das auf unserer Seite aus, und unter welcher Adresse?**
 *
 * Deshalb steht hier der öffentliche Auftritt: Titel, Text, Art, Stand, der
 * Slug und die kanonische Adresse, dazu der Hinweis, dass die englische
 * Newsseite dieselbe Zeile zeigt. Geändert und weitergeschoben wird dort, wo
 * es die Regel gibt — mit einem Verweis, der nur steht, wenn diese Sitzung ihn
 * öffnen darf (AUT-06).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Neuigkeit' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const ART: Readonly<Record<string, string>> = {
  neuigkeit: 'Neuigkeit', aktualisierung: 'Aktualisierung',
  beitrag: 'Beitrag', projektschau: 'Projektschau',
};

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', vorgelegt: 'In Prüfung', freigegeben: 'Bereit',
  geplant: 'Geplant', veroeffentlicht: 'Aktiv', abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
};

export default async function WebsiteNeuigkeit(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const beitragId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/news/${beitragId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(zugang.sitzung, 'social.lesen', 'social.schreiben');

  const b = darf['social.lesen'] === true
    ? await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => ladeBeitrag(kontext, beitragId)),
    ) as Promise<BeitragZeile | null>)
    : null;

  /*
   * 404 und nicht 403 — und der Fall ist hier doppelt: die Kennung kann zu
   * einer anderen Gesellschaft gehören, oder dieser Sitzung fehlt
   * `social.lesen`. Nach aussen ist beides dasselbe Ereignis (AUT-06).
   *
   * **Die Grenze zieht `ladeBeitrag`, nicht die Policy.** Hier stand einmal,
   * `t_beitrag_lesen` gebe zu einer fremden Kennung null Zeilen — das war für
   * einen VERÖFFENTLICHTEN Beitrag falsch: `t_beitrag_oeffentlich` erlaubt ihn
   * ohne Mandantenbedingung, und erlaubende Policies werden ver-ODER-t. Der
   * Dienst filtert seither selbst (Invariante 3: RLS ist die zweite Linie,
   * nie die einzige).
   */
  if (b === null) notFound();

  const istNeuigkeit = NEUIGKEITS_ARTEN.includes(b.art);
  /*
   * **Die kanonische Adresse entscheidet die ART, nicht diese Seite.**
   * `beitragSegment` ist dieselbe Funktion, die `generateMetadata` und die
   * Sitemap fragen; fest verdrahtetes `news` wies bei einer `projektschau` auf
   * die nicht-kanonische Adresse — und verlinkte sie, sobald der Beitrag
   * draussen war.
   */
  const oeffentlich = `/unternehmen/${mandant}/${beitragSegment(b.art)}/${b.slug}`;
  const draussen = b.status === 'veroeffentlicht' && b.zurueckgezogenAm === null;
  const schritte = moeglicheSchritte(
    b.status as Parameters<typeof moeglicheSchritte>[0]);

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/website/news`, text: 'Neuigkeiten' }}
      titel={b.titel}
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="news"
                       sitzung={zugang.sitzung} />

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text hyphens-auto">{b.titel}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2"
              data-cse="beitrag-stand" data-status={b.status}>
          <StatusPill zustand={PILLE[b.status] ?? 'Offen'} />
          <span className="text-xs text-text-muted">
            {STATUS_TEXT[b.status] ?? b.status}
          </span>
        </span>
      </div>

      {!istNeuigkeit && (
        <Hinweis art="warnung" cse="keine-neuigkeit" className="mb-s5 max-w-prose">
          <strong className="block">
            {`Dieser Beitrag ist eine ${ART[b.art] ?? b.art} und steht nicht auf der Newsseite.`}
          </strong>
          Als Neuigkeit zählen {NEUIGKEITS_ARTEN.map((k) => ART[k] ?? k).join(' und ')} —
          eine Projektschau hat mit{' '}
          <code className="font-mono">/unternehmen/{mandant}/projekte</code> ihre eigene
          Liste. Ob sie dazugehören soll, ist redaktionell offen (O-548).
        </Hinweis>
      )}

      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">So steht es öffentlich</h2>
        <dl className="mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-text-muted">Adresse</dt>
            <dd className="m-0" data-cse="kanonische-adresse">
              {draussen ? (
                <a href={oeffentlich}
                   className="font-mono text-sm text-text underline underline-offset-4 hover:text-brand">
                  {oeffentlich}
                </a>
              ) : (
                <span className="font-mono text-sm text-text-muted">{oeffentlich}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Art</dt>
            <dd className="m-0 text-sm text-text">{ART[b.art] ?? b.art}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Geplant für</dt>
            <dd className="m-0 text-sm text-text">
              {b.geplantFuer === null ? '—' : BERLIN.format(new Date(b.geplantFuer))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Öffentlich seit</dt>
            <dd className="m-0 text-sm text-text">
              {b.veroeffentlichtAm === null
                ? '—' : BERLIN.format(new Date(b.veroeffentlichtAm))}
            </dd>
          </div>
        </dl>

        {!draussen && (
          <Hinweis art="hinweis" cse="noch-nicht-oeffentlich" className="mb-s4 max-w-prose">
            {b.zurueckgezogenAm === null
              ? 'Die Adresse antwortet heute mit 404 — ein Entwurf ist für Besucher nicht '
                + 'leer, sondern nicht vorhanden.'
              : `Zurückgezogen am ${BERLIN.format(new Date(b.zurueckgezogenAm))}. `
                + 'Die Adresse antwortet mit 404, und eingehende Verweise brechen.'}
          </Hinweis>
        )}

        <h3 className="mb-s2 mt-0 text-h3 text-text">Text</h3>
        <p className="m-0 max-w-prose whitespace-pre-line text-sm text-text-muted"
           data-cse="beitrag-text">
          {b.text}
        </p>
      </Card>

      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Geändert wird unter Social Media</h2>
        <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
          Ein Beitrag hat EINEN Weg — Entwurf, vorgelegt, freigegeben, geplant,
          veröffentlicht — und der steht in{' '}
          <code className="font-mono">services/social/weg.ts</code>. Ein zweiter Editor
          hier wären zwei Oberflächen auf einer Regel, und die eine liefe ihr
          hinterher. Nichts geht hinaus, ohne dass ein Mensch es freigegeben hat
          (Invariante 7): entschieden wird im Freigabe-Posteingang, nicht auf einem
          Redaktionsbildschirm.
        </p>
        <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
          {schritte.length === 0
            ? 'Von diesem Stand führt kein Schritt weiter.'
            : `Von hier aus möglich: ${schritte
              .map((s) => SCHRITT_TEXT[s]).join(' · ')}.`}
        </p>
        {/*
          * Der Verweis steht nur, wo das Recht ihn öffnet: `/social/posts/[id]`
          * ist mit `social.lesen` bewacht, Bearbeiten mit `social.schreiben`.
          * Ein Verweis auf einen 404 verrät, dass es dort etwas gibt (AUT-06).
          */}
        {darf['social.lesen'] === true && (
          <Link href={`/portal/${mandant}/social/posts/${b.id}`}
                data-cse="zum-editor"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            {darf['social.schreiben'] === true
              ? 'Bearbeiten und weiterschieben' : 'Im Social-Media-Center ansehen'}
          </Link>
        )}
      </Card>

      <p className="max-w-prose text-xs text-text-subtle">
        <strong>Die englische Newsseite zeigt diese Zeile unverändert.</strong>{' '}
        <code className="font-mono">beitrag</code> führt keine Sprachspalte — anders als{' '}
        <code className="font-mono">seite</code> und{' '}
        <code className="font-mono">unternehmensprofil</code>, wo eine englische Fassung
        eine eigene Zeile ist (D-82). Ob Neuigkeiten zweisprachig geführt werden sollen,
        ist offen (O-681).
      </p>
    </PortalRahmen>
  );
}

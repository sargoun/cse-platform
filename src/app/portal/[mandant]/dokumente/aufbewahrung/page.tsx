import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import {
  UNTERGRENZE, liesAufbewahrung, type AufbewahrungZeile,
} from '@/server/services/dokument/aufbewahrung';
import { liesWirtschaftsjahr, type Wirtschaftsjahr } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { KATEGORIE } from '../darstellung';

/**
 * `/portal/[mandant]/dokumente/aufbewahrung` — die Aufbewahrungsregeln je
 * Kategorie: lesen, und fuer diese Gesellschaft setzen (DOC-07, LEG-01,
 * PR 64, D-483).
 *
 * Jede Zeile nennt Frist, Sperre, Rechtsgrundlage und ob die Zahl bestaetigt
 * ist oder ein Platzhalter (K-17). Gesetzt wird ueber den Dienst, unter
 * `dokument.aufbewahrung_verwalten`, nie unter die gesetzliche Untergrenze —
 * die steht in der Zeile, damit niemand sie erst aus dem Fehler erfaehrt.
 */
export const dynamic = 'force-dynamic';

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  untergrenze: 'Die Frist liegt unter der gesetzlichen Mindestfrist.',
  grundlage: 'Die Rechtsgrundlage fehlt.',
  jahre: 'Die Frist ist keine ganze Zahl von Jahren.',
  kategorie: 'Unbekannte Kategorie.',
  nicht_gesetzt: 'Die Regel wurde nicht gespeichert.',
};

export default async function Aufbewahrung(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/dokumente/aufbewahrung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: `…/buchhaltung/archiv` verlangt laut Manifest `buchhaltung.lesen`,
     diese Seite verlangt es nicht. Wer Fristen pflegt, ohne das Archiv oeffnen
     zu duerfen, bekam hinter „Zum GoBD-Archiv" ein 404 — ein Verweis auf 404
     verraet, was er nicht zeigen darf (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'buchhaltung.lesen');
  const suche = await searchParams;
  const gesetzt = typeof suche['gesetzt'] === 'string' ? suche['gesetzt'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      regeln: await liesAufbewahrung(kontext),
      wj: await liesWirtschaftsjahr(kontext),
    }))) as Promise<{ regeln: readonly AufbewahrungZeile[]; wj: Wirtschaftsjahr }>);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Aufbewahrungsregeln"
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Aufbewahrungsregeln</h1>
        {darf['buchhaltung.lesen'] === true ? (
          <Link href={`/portal/${mandant}/buchhaltung/archiv`}
                className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
            Zum GoBD-Archiv
          </Link>
        ) : null}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Je Kategorie gilt die Regel dieser Gesellschaft, sonst die der Plattform. Die Frist
        beginnt mit dem Schluss des Kalenderjahrs, in dem ein Dokument entstand (§ 147 Abs. 4 AO,
        § 257 Abs. 5 HGB). Eine geänderte Regel gilt für Dokumente, die danach entstehen —
        was schon liegt, behält seine Frist, und kürzer wird sie nie.
      </p>

      {gesetzt !== null ? (
        <Hinweis art="erfolg" cse="aufbewahrung-gesetzt" className="mb-s5 max-w-prose">
          <strong>Regel gesetzt</strong> für „{KATEGORIE[gesetzt] ?? gesetzt}" — mit Spur im Protokoll.
        </Hinweis>
      ) : null}
      {fehler !== null ? (
        <Hinweis art="warnung" cse="aufbewahrung-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gesetzt.</strong> {meldung ?? FEHLER_TEXT[fehler] ?? 'Die Regel wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      <Hinweis cse="wirtschaftsjahr" className="mb-s6 max-w-prose">
        <strong>Wirtschaftsjahr:</strong>{' '}
        beginnt am {String(daten.wj.beginnTag)}.{String(daten.wj.beginnMonat)}.
        {daten.wj.istPlatzhalter
          ? ' — angenommen, nicht bestätigt (O-05). Es bestimmt den Jahrgang eines Prüfbündels, nicht den Beginn der Aufbewahrung.'
          : ' — bestätigt. Es bestimmt den Jahrgang eines Prüfbündels, nicht den Beginn der Aufbewahrung.'}
      </Hinweis>

      <ul data-cse="aufbewahrung-regeln" className="flex flex-col gap-s4">
        {daten.regeln.map((r) => {
          const min = UNTERGRENZE[r.kategorie];
          const gesetzlichGesperrt = min !== null && min >= 10;
          return (
            <li key={r.kategorie} data-cse="aufbewahrung-regel" data-kategorie={r.kategorie}
                className="rounded-lg border border-line bg-surface p-s5">
              <div className="mb-s3 flex flex-wrap items-center gap-s3">
                <h2 className="text-h3 text-text">{KATEGORIE[r.kategorie] ?? r.kategorie}</h2>
                <StatusPill zustand={r.istPlatzhalter ? 'Offen' : 'Bereit'} />
                <span className="text-xs text-text-muted">
                  {r.quelle === 'gesellschaft' ? 'Regel dieser Gesellschaft' : 'Plattformvorgabe'}
                  {r.geaendertAm === null ? '' : ` · geändert ${r.geaendertAm}`}
                </span>
              </div>
              <dl className="mb-s4 grid grid-cols-2 gap-s3 text-sm sm:grid-cols-4">
                <div><dt className="text-text-subtle">Frist</dt>
                  <dd className="text-text" data-cse="regel-jahre">{r.jahre === null ? 'offen' : `${String(r.jahre)} Jahre`}</dd></div>
                <div><dt className="text-text-subtle">Löschsperre</dt>
                  <dd className="text-text">{r.loeschsperre ? 'ja' : 'nein'}</dd></div>
                <div><dt className="text-text-subtle">Gesetzliche Untergrenze</dt>
                  <dd className="text-text">{min === null ? 'keine eine Zahl (O-25)' : `${String(min)} Jahre`}</dd></div>
                <div><dt className="text-text-subtle">Grundlage</dt>
                  <dd className="text-text">{r.grundlage}</dd></div>
              </dl>
              <form method="post" action="/api/dokumente/aufbewahrung" data-cse="regel-setzen"
                    className="grid grid-cols-1 items-end gap-s3 sm:grid-cols-[8rem_1fr_auto]">
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="kategorie" value={r.kategorie} />
                <div>
                  <label htmlFor={`jahre-${r.kategorie}`} className="block text-sm text-text">Jahre</label>
                  <input id={`jahre-${r.kategorie}`} name="jahre" type="number" inputMode="numeric"
                         min={min ?? 0} max={30} step={1} defaultValue={r.jahre ?? ''}
                         placeholder="offen" className={feld} />
                </div>
                <div>
                  <label htmlFor={`grundlage-${r.kategorie}`} className="block text-sm text-text">Rechtsgrundlage</label>
                  <input id={`grundlage-${r.kategorie}`} name="grundlage" type="text" required minLength={5}
                         maxLength={200} defaultValue={r.grundlage} className={feld} />
                </div>
                <div className="flex flex-col gap-s2">
                  <label className="flex min-h-11 items-center gap-s2 text-sm text-text">
                    <input type="checkbox" name="loeschsperre" defaultChecked={r.loeschsperre || gesetzlichGesperrt}
                           disabled={gesetzlichGesperrt} />
                    Löschsperre{gesetzlichGesperrt ? ' (gesetzlich)' : ''}
                  </label>
                  {gesetzlichGesperrt ? <input type="hidden" name="loeschsperre" value="on" /> : null}
                  <Button type="submit" variante="secondary">Regel setzen</Button>
                </div>
              </form>
            </li>
          );
        })}
      </ul>
    </PortalRahmen>
  );
}

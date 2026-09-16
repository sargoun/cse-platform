import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  ladeStelle, rangliste, leseVeroeffentlichungen, type StelleStatus,
} from '@/server/services/recruiting/dienst';
import { punkteText } from '@/server/services/recruiting/rangfolge';
import { kennungOder404 } from '../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { KNOPF } from '../../felder';
import { BEWERBUNG_MARKE, berlinZeit } from '../../marken';

/**
 * `/portal/[mandant]/recruiting/stellen/[id]` — eine Ausschreibung (REC-02).
 *
 * **Drei Dinge nebeneinander, und die Trennung ist der Inhalt:** was
 * ausgeschrieben ist (Text und Anforderungen), wohin es gegangen ist
 * (Veröffentlichungen, mit dem Grund bei jedem Misserfolg), und wer sich
 * beworben hat (mit Rang, aber ohne Urteil).
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<StelleStatus, PillZustand>> = {
  entwurf: 'Entwurf', freigegeben: 'Bereit',
  veroeffentlicht: 'Aktiv', geschlossen: 'Abgeschlossen',
};

const ERGEBNIS: Readonly<Record<string, string>> = {
  offen: 'noch nicht versucht',
  veroeffentlicht: 'veröffentlicht',
  nicht_verbunden: 'nicht verbunden',
  fehlgeschlagen: 'fehlgeschlagen',
};

export default async function Stellenblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="stellen"
      titel="Stelle"
      kinder={async (zugang) => {
        const d = await leseImMandanten(zugang, async (kontext) => ({
          stelle: await ladeStelle(kontext, id),
          bewerber: await rangliste(kontext, id),
          wege: await leseVeroeffentlichungen(kontext, id),
        }));
        if (d.stelle === null) notFound();
        const s = d.stelle;

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{s.titel}</h1>
              <StatusPill zustand={STATUS[s.status]} />
            </div>

            <nav className="mb-s5 flex flex-wrap gap-s2">
              <Link href={`/portal/${mandant}/recruiting/stellen`} className={KNOPF}>
                Alle Stellen
              </Link>
              <Link
                href={`/portal/${mandant}/recruiting/stellen/${id}/veroeffentlichung`}
                data-cse="stelle-wege"
                className={KNOPF}
              >
                Veröffentlichung
              </Link>
            </nav>

            {s.entwurfVonArt === 'agent' && (
              <Hinweis art="warnung" cse="stelle-agentenentwurf" className="mb-s5 max-w-prose">
                <strong>Dieser Text stammt von einem Agenten und ist ungeprüft.</strong>{' '}
                Er ist ein Vorschlag; was hinausgeht, gibt ein Mensch frei
                (Invariante 7).
              </Hinweis>
            )}

            <dl className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
              <dt className="text-text-muted">Einsatzort</dt>
              <dd className="m-0 min-w-0 break-words text-text">{s.einsatzort ?? '—'}</dd>
              <dt className="text-text-muted">Wochenstunden</dt>
              <dd className="m-0 min-w-0 text-text">
                {s.wochenstunden === null ? '—' : `${s.wochenstunden.replace('.', ',')} h`}
              </dd>
              <dt className="text-text-muted">Bewerbungsfrist</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {s.bewerbungsfrist ?? 'offen'}
              </dd>
              <dt className="text-text-muted">Veröffentlicht</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {s.veroeffentlichtAm === null ? '—' : berlinZeit(s.veroeffentlichtAm)}
              </dd>
            </dl>

            <h2 className="mb-s3 text-h3 text-text">Beschreibung</h2>
            <p className="mb-s6 max-w-prose whitespace-pre-line text-sm text-text">
              {s.beschreibung}
            </p>

            <h2 className="mb-s3 text-h3 text-text">Anforderungen</h2>
            {s.anforderungen.length === 0 ? (
              <p className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Anforderung erfasst. Eine Bewertung ohne Anforderungen
                hätte nichts, wogegen sie liefe (REC-05).
              </p>
            ) : (
              <ul className="mb-s6 m-0 max-w-prose list-disc pl-s5 text-sm text-text">
                {s.anforderungen.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}

            <h2 className="mb-s3 text-h3 text-text">Wohin sie gegangen ist</h2>
            {d.wege.length === 0 ? (
              <p className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Noch kein Versuch vermerkt. Die Karriereseite dieser Plattform
                trägt jede veröffentlichte Stelle ohne fremden Vertrag; jede
                Jobbörse braucht einen (O-374).
              </p>
            ) : (
              <div className="mb-s6">
                <DataTable
                  beschriftung="Versuche, diese Stelle zu veröffentlichen"
                  zeilen={d.wege}
                  schluessel={(w) => w.id}
                  spalten={[
                    { schluessel: 'boerse', kopf: 'Ziel', zelle: (w) => w.boerse },
                    {
                      schluessel: 'ergebnis',
                      kopf: 'Ergebnis',
                      zelle: (w) => (w.ergebnis === 'veroeffentlicht'
                        ? <span className="text-success">{ERGEBNIS[w.ergebnis]}</span>
                        : <span className="text-warning">{ERGEBNIS[w.ergebnis] ?? w.ergebnis}</span>),
                    },
                    { schluessel: 'meldung', kopf: 'Grund', zelle: (w) => w.meldung ?? '—' },
                  ]}
                />
              </div>
            )}

            <h2 className="mb-s3 text-h3 text-text">
              Bewerbungen — {String(d.bewerber.length)}
            </h2>
            {d.bewerber.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Bewerbung auf diese Stelle.
              </p>
            ) : (
              <DataTable
                beschriftung="Bewerbungen auf diese Stelle, nach Punktzahl"
                zeilen={d.bewerber}
                schluessel={(z) => z.eintrag.id}
                spalten={[
                  { schluessel: 'rang', kopf: 'Rang', numerisch: true, zelle: (z) => String(z.rang) },
                  {
                    schluessel: 'name',
                    kopf: 'Name',
                    zelle: (z) => (
                      <Link
                        href={`/portal/${mandant}/recruiting/kandidaten/${z.eintrag.id}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {z.eintrag.name}
                      </Link>
                    ),
                  },
                  {
                    schluessel: 'punkte',
                    kopf: 'Punkte',
                    numerisch: true,
                    zelle: (z) => (z.kriterien.length === 0
                      ? <span className="text-text-muted">nicht bewertet</span>
                      : punkteText(z.punktzahlZehntel)),
                  },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (z) => <StatusPill zustand={BEWERBUNG_MARKE[z.eintrag.status]} />,
                  },
                ]}
              />
            )}
          </>
        );
      }}
    />
  );
}

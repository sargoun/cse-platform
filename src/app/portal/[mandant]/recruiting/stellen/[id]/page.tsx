import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import {
  ladeStelle, rangliste, leseVeroeffentlichungen, type StelleStatus,
} from '@/server/services/recruiting/dienst';
import { punkteText } from '@/server/services/recruiting/rangfolge';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '../../../../rechte';
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

/** Die Abweisungen der Vorlage-Route — als Satz, nicht als Schlüssel. */
const FEHLER: Readonly<Record<string, string>> = {
  falscher_status: 'Vorgelegt wird ein Entwurf. Was schon freigegeben oder '
    + 'veröffentlicht ist, geht nicht noch einmal durch dieselbe Entscheidung.',
  gleichzeitig: 'Jemand anderes war einen Augenblick schneller. Bitte die Seite neu laden.',
  kein_schreibrecht: 'Die Freigabe wurde nicht angelegt. Fehlt Ihnen das Recht dazu, '
    + 'sagt es Ihnen die Person, die Ihre Rolle vergeben hat.',
  schon_vorgelegt: 'Diese Anzeige liegt schon im Freigabe-Posteingang. Zwei Bitten '
    + 'um dieselbe Entscheidung sind eine zu viel.',
  unbekannt: 'Diese Stelle gibt es nicht.',
};

const ERGEBNIS: Readonly<Record<string, string>> = {
  offen: 'noch nicht versucht',
  veroeffentlicht: 'veröffentlicht',
  nicht_verbunden: 'nicht verbunden',
  fehlgeschlagen: 'fehlgeschlagen',
};

export default async function Stellenblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`stellen/${id}`}
      titel="Stelle"
      kinder={async (zugang) => {
        /*
         * **Der Knopf „Veröffentlichung" nur mit seinem Recht** (AUT-06).
         *
         * `/recruiting/stellen/[id]/veroeffentlichung` verlangt
         * `recruiting.stelle_veroeffentlichen`; eine `leitung` hält
         * `stelle_schreiben` und das andere nicht (0008). Der Knopf stand
         * trotzdem da und führte für sie auf einen 404 — genau der Fall aus
         * D-567: ein Menüpunkt, der auf 404 führt, ist schlechter als keiner,
         * weil er die Existenz dessen verrät, was er nicht zeigen darf.
         */
        /*
         * `freigabe.entscheiden` dazu: `/freigaben/[id]` verlangt es
         * (Manifest, Zeile `freigaben/[id]`), diese Seite nur die
         * Stellenrechte. Wer vorlegen darf, aber nicht entscheiden, bekam
         * einen Verweis „Zur Freigabe" mit einem 404 dahinter — und ein
         * Verweis, der auf 404 führt, verrät, was er nicht zeigen darf
         * (AUT-06). Der Hinweis bleibt; nur der Weg hängt am Recht.
         */
        /*
         * `recruiting.bewerbung_lesen` dazu: `/recruiting/kandidaten/[id]`
         * verlangt es (Manifest), diese Seite nur `stelle_lesen`. Wer die
         * Stelle sehen darf, aber keine Bewerbung, bekam hinter jedem Namen
         * der Rangliste einen 404 — ein Verweis auf 404 verrät, was er nicht
         * zeigen darf (AUT-06, Copilot-Runde auf PR 16 / D-581).
         */
        /*
         * `recruiting.stelle_schreiben` steht dazu, weil das Formular „Zur
         * Freigabe vorlegen" eine SCHREIBENDE Route ruft
         * (`POST /api/recruiting/stellen/[id]/freigabe`). Diese Seite oeffnet
         * mit `recruiting.stelle_lesen`; ein reiner Leser sah den Knopf und
         * erfuhr die Abweisung erst nach dem Druecken (AUT-06, D-581).
         */
        const darf = await haeltRechte(
          zugang.sitzung, 'recruiting.stelle_veroeffentlichen', 'freigabe.entscheiden',
          'recruiting.bewerbung_lesen', 'recruiting.stelle_schreiben');
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
              {darf['recruiting.stelle_veroeffentlichen'] === true && (
                <Link
                  href={`/portal/${mandant}/recruiting/stellen/${id}/veroeffentlichung`}
                  data-cse="stelle-wege"
                  className={KNOPF}
                >
                  Veröffentlichung
                </Link>
              )}
            </nav>

            {/*
              * **Der Weg, der gefehlt hat** (REC-02, Invariante 7).
              *
              * `stelle.status` kannte `freigegeben` seit 0166 — gesetzt hat
              * ihn niemand. Eine Anzeige kam nie aus dem Entwurf, die
              * Veröffentlichungsseite antwortete „nicht freigegeben", und
              * REC-09 war für einen Menschen nicht ausführbar.
              *
              * Der Knopf LEGT VOR, er gibt nicht frei: entschieden wird im
              * Freigabe-Posteingang, wo die Zeile ausdrücklich
              * `recruiting.stelle_veroeffentlichen` verlangt. Zwei Wege zu
              * derselben Entscheidung wären einer zu viel.
              */}
            {s.status === 'entwurf' && s.freigabeId !== null && (
              <Hinweis art="hinweis" cse="stelle-wartet" className="mb-s5 max-w-prose">
                <strong>Sie liegt im Freigabe-Posteingang.</strong> Entschieden wird
                dort, nicht hier — und erst danach darf sie hinausgehen
                (Invariante 7).
                {darf['freigabe.entscheiden'] === true && (
                  <>
                    {' '}
                    <Link href={`/portal/${mandant}/freigaben/${s.freigabeId}`}
                          className="underline underline-offset-4" data-cse="zur-stellenfreigabe">
                      Zur Freigabe
                    </Link>.
                  </>
                )}
              </Hinweis>
            )}

            {s.status === 'entwurf' && s.freigabeId === null
              && darf['recruiting.stelle_schreiben'] === true && (
              <form method="post" action={`/api/recruiting/stellen/${id}/freigabe`}
                    className="mb-s5 flex max-w-prose flex-wrap items-center gap-s3">
                <input type="hidden" name="zurueck"
                       value={`/portal/${mandant}/recruiting/stellen/${id}`} />
                <Button type="submit" variante="primary" data-cse="stelle-vorlegen">
                  Zur Freigabe vorlegen
                </Button>
                <span className="text-sm text-text-muted">
                  Sie bitten um die Freigabe — entschieden wird im
                  Freigabe-Posteingang, von einem Menschen (Invariante 7).
                </span>
              </form>
            )}

            {suche['vorgelegt'] === '1' && (
              <Hinweis art="hinweis" cse="stelle-vorgelegt" className="mb-s5 max-w-prose">
                <strong>Die Anzeige liegt im Freigabe-Posteingang.</strong> Sie geht
                hinaus, nachdem ein Mensch sie freigegeben hat — bis dahin bleibt sie
                ein Entwurf.
              </Hinweis>
            )}

            {abgewiesen !== null && (
              <Hinweis art="warnung" cse="stelle-fehler" className="mb-s5 max-w-prose">
                {FEHLER[abgewiesen] ?? 'Der Vorgang wurde abgewiesen.'}
              </Hinweis>
            )}

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
                    // Ohne `recruiting.bewerbung_lesen` der blosse Name, kein Verweis (AUT-06).
                    zelle: (z) => (darf['recruiting.bewerbung_lesen'] === true ? (
                      <Link
                        href={`/portal/${mandant}/recruiting/kandidaten/${z.eintrag.id}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {z.eintrag.name}
                      </Link>
                    ) : z.eintrag.name),
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

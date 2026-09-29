import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { monatszahlen, type Monatszahlen } from '@/server/services/buchhaltung/monatszahlen';
import { liesWirtschaftsjahr, wirtschaftsjahrVon } from '@/server/services/buchhaltung/wirtschaftsjahr';
import type { BereichSchluessel } from '@/lib/design/theme';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { PERIODEN_RUECKWEG_TEXTE } from '@/lib/i18n/verwaltung/buchhaltung-perioden';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/buchhaltung/perioden` — das Periodenschloss (ACC-01,
 * ACC-08, LEG-01, PR 65, D-484).
 *
 * Je Monat des Wirtschaftsjahrs: Zustand, Zahlen, und die eine Handlung, die
 * als Naechstes geht. Offen → vorlaeufig → geschlossen; vorlaeufig laesst
 * sich wieder oeffnen, geschlossen nicht. Was die Datenbank abweist (Zeilen
 * ohne Konto, Buchungen ohne Ausgleich), steht danach als Satz oben.
 *
 * **Erfolg und Abweisung kommen als Schlüssel zurück** (`?erfolg=`,
 * `?fehler=`, D-769, D-774) und stehen als Satz aus
 * `PERIODEN_RUECKWEG_TEXTE` da, nachgeschlagen als eigener Eintrag. Den Monat
 * (`?monat=`) nennt die Seite nur, wenn er einer IHRER Monate ist, mit dessen
 * Namen. Bis dahin stand ein fertiger Satz aus `?meldung=` im Kasten — der
 * Route, des Dienstes oder der Datenbank, und jeder eines präparierten Links.
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, 'Offen' | 'In Prüfung' | 'Abgeschlossen'>> = {
  offen: 'Offen', vorlaeufig_geschlossen: 'In Prüfung', geschlossen: 'Abgeschlossen',
};
const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'offen', vorlaeufig_geschlossen: 'vorläufig geschlossen', geschlossen: 'geschlossen',
};

export default async function Perioden(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/perioden`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const gewaehlt = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const erfolg = typeof suche['erfolg'] === 'string' ? suche['erfolg'] : null;
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  /* Fest deutsch: die Seite steht auf der Ausnahmeliste der Übersetzungswache. */
  const t = PERIODEN_RUECKWEG_TEXTE.de;
  /* Ein unbekannter Erfolgsschlüssel zeigt nichts: ein allgemeiner Erfolgssatz behauptete einen Erfolg. */
  const erfolgSatz = erfolg === null ? undefined : eigenerEintrag(t.erfolg, erfolg);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const wj = await liesWirtschaftsjahr(kontext);
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const tag = heute?.tag ?? '2026-01-01';
      const jahr = gewaehlt ?? wirtschaftsjahrVon(tag, wj);
      /* Je Monat die Zeilen ohne Konto: die Datenbank weist das Schliessen damit ab (O-05). */
      const ohne = await kontext.abfrage<{ monat: string; n: number }>(
        `select to_char(belegdatum, 'YYYY-MM') as monat, count(*)::int as n
           from buchungssatz where konto is null group by 1`);
      return { z: await monatszahlen(kontext, jahr, wj), heute: tag,
        ohneKonto: new Map(ohne.map((o) => [o.monat, o.n])) as ReadonlyMap<string, number> };
    })) as Promise<{ z: Monatszahlen; heute: string; ohneKonto: ReadonlyMap<string, number> }>);
  const z = daten.z;
  /* Der Monat aus der Adresse zählt nur, wenn er einer der Monate dieser Seite ist. */
  const betroffen = monatRoh === null ? undefined : z.monate.find((m) => m.monat === monatRoh);

  const basis = `/portal/${mandant}/buchhaltung/perioden`;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Periodenschloss"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="buchhaltung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Periodenschloss {z.bezeichnung}</h1>
        <nav aria-label="Wirtschaftsjahr" className="flex gap-s2">
          <a href={`${basis}?jahr=${String(z.jahr - 1)}`} className={knopf}>‹ {String(z.jahr - 1)}</a>
          <a href={`${basis}?jahr=${String(z.jahr + 1)}`} className={knopf}>{String(z.jahr + 1)} ›</a>
        </nav>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Offen → vorläufig geschlossen → geschlossen. In einen vorläufig geschlossenen Monat bucht nur,
        wer festschreiben darf; ein geschlossener Monat nimmt keine Buchung mehr auf und öffnet nicht
        wieder — korrigiert wird im offenen Monat durch Gegenbuchung (GoBD). Beim Schließen werden
        die Monatszahlen eingefroren.
      </p>

      {erfolgSatz !== undefined ? (
        <Hinweis art="erfolg" rolle="status" cse="periode-vermerkt" className="mb-s5 max-w-prose">
          <strong>{t.vermerkt}</strong> {betroffen?.label ?? t.monat} {erfolgSatz}
        </Hinweis>
      ) : null}
      {fehler !== null ? (
        <Hinweis art="warnung" rolle="alert" cse="periode-abgewiesen" className="mb-s5 max-w-prose">
          <strong>{t.nichtGeaendert}</strong>{' '}
          {betroffen === undefined ? null : <>{betroffen.label}: </>}{eigenerEintrag(t.fehler, fehler) ?? t.sonst}
        </Hinweis>
      ) : null}

      <ul data-cse="perioden" className="flex flex-col gap-s3">
        {z.monate.map((m) => {
          const status = m.periode?.status ?? null;
          const vorbei = m.bis < daten.heute;
          return (
            <li key={m.monat} data-cse="periode" data-monat={m.monat} data-status={status ?? 'keine'}
                data-ohne-konto={String(daten.ohneKonto.get(m.monat) ?? 0)}
                className="grid grid-cols-1 items-center gap-s3 rounded-lg border border-line bg-surface p-s4 md:grid-cols-[10rem_1fr_auto]">
              <div>
                <div className="text-base font-semibold text-text">{m.label}</div>
                <div className="mt-s1">
                  {status === null
                    ? <span className="text-xs text-text-subtle">kein Buchungsmonat angelegt</span>
                    : <StatusPill zustand={STATUS[status] ?? 'Offen'} />}
                </div>
              </div>
              <div className="text-sm text-text-muted">
                Erlöse {formatiereGeld(m.erloeseCent)} · Aufwand {formatiereGeld(m.aufwandCent)} · Ergebnis{' '}
                {formatiereGeld(m.ergebnisCent)}
                {m.periode?.eingefroren !== null && m.periode?.eingefroren !== undefined
                  ? ` · eingefroren ${formatiereGeld(m.periode.eingefroren.ergebnisCent)}${m.periode.abweichung ? ' (weicht ab)' : ''}`
                  : ''}
                {m.periode?.geschlossenAm !== null && m.periode?.geschlossenAm !== undefined
                  ? ` · geschlossen ${m.periode.geschlossenAm}` : ''}
              </div>
              <form method="post" action="/api/buchhaltung/perioden" className="flex flex-wrap gap-s2">
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="jahr" value={m.monat.slice(0, 4)} />
                <input type="hidden" name="monat" value={String(Number(m.monat.slice(5, 7)))} />
                {status === 'geschlossen' ? (
                  <span className="text-xs text-text-subtle">{STATUS_TEXT[status]} — endgültig</span>
                ) : status === 'vorlaeufig_geschlossen' ? (
                  <>
                    <Button type="submit" name="art" value="oeffnen" variante="ghost">Wieder öffnen</Button>
                    <Button type="submit" name="art" value="endgueltig" variante="secondary" disabled={!vorbei}
                            title={vorbei ? undefined : 'Der Monat läuft noch'}>
                      Schließen
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="submit" name="art" value="vorlaeufig" variante="secondary">Vorläufig schließen</Button>
                    <Button type="submit" name="art" value="endgueltig" variante="secondary" disabled={!vorbei}
                            title={vorbei ? undefined : 'Der Monat läuft noch'}>
                      Schließen
                    </Button>
                  </>
                )}
              </form>
            </li>
          );
        })}
      </ul>
    </PortalRahmen>
  );
}

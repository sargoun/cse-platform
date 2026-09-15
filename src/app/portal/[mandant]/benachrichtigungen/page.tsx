import type postgres from 'postgres';
import Link from 'next/link';
import { db } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladePosteingang, zaehleJeArt, type Eintrag }
  from '@/server/benachrichtigung/posteingang';
import { modulTitel, modulVon } from '@/server/benachrichtigung/bootstrap';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';

/**
 * `/portal/[mandant]/benachrichtigungen` — der persönliche Posteingang
 * (NOT-01, NOT-03, `04-SEITENKARTE.md` §2).
 *
 * **Sie fehlte, und die Meldungen gab es trotzdem.** Wächter, Lead-SLA,
 * Ablaufwarnungen, Radartreffer und der Agentenbudgetdeckel schreiben seit
 * mehreren PRs in `benachrichtigung` — gelesen hat sie niemand, weil es keinen
 * Bildschirm dafür gab. Eine Warnung, die niemanden erreicht, ist keine.
 *
 * **Jeder Eintrag führt zu seinem Datensatz** (NOT-03). Das Ziel steht in der
 * Zeile und ist beim Erzeugen aufgelöst worden — `erzeuge()` scheitert, wenn
 * es keines gibt. Der Klick geht über `POST`, weil er stempelt: ein Link, den
 * ein Vorauslader anfasst, machte den Posteingang von allein leer.
 *
 * **Kein Rechteschlüssel.** Der Posteingang ist persönlich;
 * `t_benachrichtigung_eigene` bindet ihn an `app.aktueller_benutzer()`. Ein
 * Recht davor hiesse, dass jemand etwas mitgeteilt bekommt, das er nicht
 * ansehen darf.
 */
export const dynamic = 'force-dynamic';

function zeitpunkt(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(d);
}

/** „vor 3 Stunden" — die Angabe, die beim Überfliegen zählt. */
function seit(d: Date, jetzt: Date): string {
  const min = Math.max(0, Math.round((jetzt.getTime() - d.getTime()) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${String(min)} min`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${String(std)} h`;
  return `vor ${String(Math.round(std / 24))} d`;
}

export default async function Benachrichtigungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/benachrichtigungen`;

  const nurOffen = suche['alle'] !== '1';
  const modul = typeof suche['modul'] === 'string' && /^[a-z_]+$/u.test(suche['modul'])
    ? suche['modul'] : null;
  const gelesen = typeof suche['gelesen'] === 'string' ? Number(suche['gelesen']) : null;

  const tor = await mandantTor(pfad, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const jetzt = new Date();
  const { eintraege, jeArt } = await (db().begin(
    async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, zugang.sitzung);
      const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
      const kontext = { abfrage };
      return {
        eintraege: await ladePosteingang(kontext, {
          ...(nurOffen ? { ungelesen: true } : {}),
          ...(modul === null ? {} : { art: modul }),
        }),
        jeArt: await zaehleJeArt(kontext),
      };
    },
  ) as Promise<{ eintraege: readonly Eintrag[]; jeArt: readonly { art: string; offen: number; gesamt: number }[] }>);

  /** Die Filterleiste zählt je MODUL, nicht je Art — sonst wären es zwölf Knöpfe. */
  const jeModul = new Map<string, { offen: number; gesamt: number }>();
  for (const z of jeArt) {
    const m = modulVon(z.art);
    const bisher = jeModul.get(m) ?? { offen: 0, gesamt: 0 };
    jeModul.set(m, { offen: bisher.offen + z.offen, gesamt: bisher.gesamt + z.gesamt });
  }
  const offenGesamt = [...jeModul.values()].reduce((s, z) => s + z.offen, 0);

  /**
   * Der Filterlink — zusammengesetzt, also zur Uebersetzungszeit unbekannt.
   * `alsRoute` ist die eine Stelle im Haus, an der ein Pfad umgedeutet wird
   * (D-504); hier kommt er aus dieser Datei und nie von aussen.
   */
  const filterLink = (m: string | null, alle = !nurOffen) => {
    const q = new URLSearchParams();
    if (alle) q.set('alle', '1');
    if (m !== null) q.set('modul', m);
    const s = q.toString();
    return alsRoute(s === '' ? pfad : `${pfad}?${s}`);
  };

  return (
    <PortalRahmen
      titel="Benachrichtigungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="benachrichtigungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Benachrichtigungen</h1>
        <p className="flex flex-wrap items-center gap-s4 text-sm">
          <span data-cse="offen-gesamt" data-anzahl={String(offenGesamt)}
                className="text-text-muted">
            {offenGesamt === 0 ? 'Nichts Ungelesenes.' : `${String(offenGesamt)} ungelesen`}
          </span>
          <Link href="/portal/konto/benachrichtigungen"
                data-cse="zu-praeferenzen"
                className="text-text underline underline-offset-2">
            Einstellungen
          </Link>
        </p>
      </div>

      {gelesen !== null && (
        <Hinweis art="erfolg" cse="alle-gelesen" className="mb-s5 max-w-prose">
          <strong>{gelesen} als gelesen markiert.</strong>{' '}
          Die Einträge bleiben stehen — gelesen heisst gestempelt, nicht gelöscht.
        </Hinweis>
      )}

      <div className="mb-s5 flex flex-wrap items-center gap-s2">
        <Link href={filterLink(null)} data-cse="filter-alle"
              className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                          ${modul === null
                            ? 'border-line-strong bg-surface-3 text-text'
                            : 'border-line text-text-muted hover:border-line-strong'}`}>
          Alle Module
        </Link>
        {[...jeModul.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, z]) => (
          <Link key={m} href={filterLink(m)} data-cse={`filter-${m}`}
                className={`inline-flex min-h-11 items-center gap-s2 rounded-md border px-s4 text-sm
                            ${modul === m
                              ? 'border-line-strong bg-surface-3 text-text'
                              : 'border-line text-text-muted hover:border-line-strong'}`}>
            {modulTitel(m)}
            <span className="text-xs text-text-subtle">
              {z.offen > 0 ? `${String(z.offen)}/${String(z.gesamt)}` : String(z.gesamt)}
            </span>
          </Link>
        ))}

        <span className="ml-auto flex items-center gap-s3">
          <Link href={filterLink(modul, nurOffen)}
                data-cse="umschalter-gelesen"
                className="inline-flex min-h-11 items-center text-sm text-text-muted
                           underline underline-offset-4 hover:text-text">
            {nurOffen ? 'Auch gelesene zeigen' : 'Nur ungelesene'}
          </Link>
          {offenGesamt > 0 && (
            <form method="post" action="/api/benachrichtigungen/gelesen">
              <input type="hidden" name="zurueck" value={pfad} />
              <Button type="submit" variante="secondary" data-cse="alle-lesen">
                Alle als gelesen
              </Button>
            </form>
          )}
        </span>
      </div>

      {eintraege.length === 0 ? (
        <Hinweis art="hinweis" cse="posteingang-leer">
          <strong>Nichts hier.</strong>{' '}
          {nurOffen
            ? 'Alles gelesen. Ältere Einträge stehen unter „Auch gelesene zeigen".'
            : 'Für diesen Bereich ist noch keine Benachrichtigung entstanden.'}
        </Hinweis>
      ) : (
        <ul data-cse="posteingang" className="flex flex-col gap-s3">
          {eintraege.map((e) => (
            <li key={e.id}
                data-cse="benachrichtigung"
                data-art={e.art}
                data-gelesen={e.gelesenAm === null ? 'nein' : 'ja'}
                className={`rounded-lg border p-s5 transition-colors duration-fast ease-brand
                            ${e.gelesenAm === null
                              ? 'border-line-strong bg-surface'
                              : 'border-line bg-surface opacity-80'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <h2 className="text-base font-semibold text-text">{e.titel}</h2>
                <span className="flex items-center gap-s3 text-xs text-text-subtle">
                  {e.gelesenAm === null && (
                    <StatusPill zustand="Offen" />
                  )}
                  <time dateTime={e.erstelltAm.toISOString()} title={zeitpunkt(e.erstelltAm)}>
                    {seit(e.erstelltAm, jetzt)}
                  </time>
                </span>
              </div>

              <p className="mt-s2 max-w-prose text-sm text-text-muted">{e.text}</p>

              <div className="mt-s4 flex flex-wrap items-center gap-s4">
                {/*
                  * **Ein Formular und kein Verweis.** Der Klick stempelt, und
                  * ein GET, das Zustand ändert, lässt sich von einem
                  * Vorauslader auslösen — der Posteingang wäre von allein leer.
                  * Das Ziel steht in der Zeile, nicht im Formular: ein Feld
                  * dafür wäre eine offene Weiterleitung (D-504).
                  */}
                <form method="post" action={`/api/benachrichtigungen/${e.id}/oeffnen`}>
                  <Button type="submit" variante="primary" data-cse="oeffnen">
                    Ansehen
                  </Button>
                </form>
                <span className="text-xs text-text-subtle">
                  {modulTitel(modulVon(e.art))}
                  {e.mandantName === null ? '' : ` · ${e.mandantName}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalRahmen>
  );
}

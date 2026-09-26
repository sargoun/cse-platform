import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  type BeitragZeile, type KanalZeile, listeBeitraege, listeKanaele,
} from '@/server/services/social/dienst';
import { STATUS_TEXT } from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../unterseite';

/**
 * `/portal/[mandant]/social` — das Social Media Center (SOC-01, SOC-03).
 *
 * **Was diese Seite am Montagmorgen leisten muss.** Nicht „alle Beiträge",
 * sondern zwei Fragen: *wartet etwas auf mich?* und *geht demnächst etwas
 * hinaus, von dem ich wissen sollte?* Deshalb steht oben, was in Prüfung ist
 * und was geplant ist — und daneben, in welchen Zustand die Kanäle sind.
 *
 * **Der Kanalstand steht HIER und nicht erst zwei Klicks weiter.** Wer einen
 * Beitrag für Instagram plant und erst beim Veröffentlichen erfährt, dass dort
 * kein Konto hängt, hat den Termin verpasst, den er geplant hatte.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Social Media Center' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const KNOPF = 'inline-flex min-h-11 items-center rounded-md border border-line '
  + 'px-s4 py-s3 text-sm text-text hover:bg-surface-2';

export default async function SocialCenter(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/social`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      beitraege: await listeBeitraege(kontext),
      kanaele: await listeKanaele(kontext),
      /*
       * **Darf dieser Mensch die Kanalseite ueberhaupt oeffnen?**
       *
       * Sie ist mit `social.kanal_verbinden` bewacht (Seitenkarte), und das
       * Recht ist nur an `super_admin` GEBUNDEN -- an `admin` bloss bindbar.
       * Eine `leitung` mit `social.schreiben` sah hier also einen Link, der
       * hinter sich einen 404 hatte. Das ist genau der Fall, den das
       * Navigationsregister verhindert (AUT-06): ein Menuepunkt, der auf
       * einen 404 fuehrt, verraet die Existenz dessen, was er nicht zeigen
       * darf. `navigationsRechte` hilft hier nicht -- es kennt nur die
       * Rechte der Sidebar-Eintraege, und `social.kanal_verbinden` ist keiner.
       */
      darfKanaele: (await kontext.abfrage<{ ja: boolean }>(
        `select app.hat_recht('social.kanal_verbinden', app.aktiver_mandant()) as ja`)
      )[0]?.ja ?? false,
      /*
       * Dasselbe für `social.schreiben`: `/social/posts/neu` verlangt es
       * (Manifest), diese Übersicht nur `social.lesen`. Wer liest und nicht
       * schreibt, sah zwei Wege zu „Neuer Beitrag" — beide mit 404 dahinter.
       * Gemeldet von der Copilot-Runde auf PR 16.
       */
      darfSchreiben: (await kontext.abfrage<{ ja: boolean }>(
        `select app.hat_recht('social.schreiben', app.aktiver_mandant()) as ja`)
      )[0]?.ja ?? false,
    }))) as Promise<{
      beitraege: readonly BeitragZeile[]; kanaele: readonly KanalZeile[];
      darfKanaele: boolean; darfSchreiben: boolean;
    }>);

  const zahl = (status: string): number =>
    daten.beitraege.filter((b) => b.status === status).length;
  /*
   * **Nach dem AUGENBLICK sortieren, nicht nach seiner Schreibweise.**
   *
   * Hier stand `String(a.geplantFuer).localeCompare(...)`. Die Spalte ist
   * `timestamptz`, und postgres.js gibt daraus ein `Date` — `String(date)`
   * ergibt „Mon Jun 15 2026 …". Verglichen wurde damit ein Wochentagsname:
   * „Fri" vor „Mon" vor „Sat". Die Liste „Demnaechst" stand in einer
   * Reihenfolge, die zufaellig aussah und es auch war.
   */
  const augenblick = (wert: unknown): number => {
    const d = wert instanceof Date ? wert : new Date(String(wert));
    const t = d.getTime();
    // Unlesbares nach hinten, statt die Sortierung mit NaN zu vergiften.
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const geplant = daten.beitraege
    .filter((b) => b.status === 'geplant' && b.geplantFuer !== null)
    .sort((a, b) => augenblick(a.geplantFuer) - augenblick(b.geplantFuer));
  const verbundene = daten.kanaele.filter((k) => k.verbunden).length;

  return (
    <PortalRahmen
      titel="Social Media"
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="social"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Social Media Center</h1>
        <nav aria-label="Social Media" className="flex flex-wrap gap-s2">
          {daten.darfSchreiben ? (
            <Link href={`/portal/${mandant}/social/posts/neu`} className={KNOPF} data-cse="social-neu">
              Neuer Beitrag
            </Link>
          ) : null}
          <Link href={`/portal/${mandant}/social/posts`} className={KNOPF} data-cse="social-posts">
            Alle Beiträge
          </Link>
          {daten.darfKanaele ? (
            <Link href={`/portal/${mandant}/social/kanaele`} className={KNOPF}
                  data-cse="social-kanaele">
              Kanäle
            </Link>
          ) : null}
          <Link href={`/portal/${mandant}/social/statistik`} className={KNOPF} data-cse="social-statistik">
            Statistik
          </Link>
        </nav>
      </div>

      <div data-cse="social-kennzahlen" className="mb-s5 grid grid-cols-2 gap-s3 lg:grid-cols-4">
        <KpiStat label="Entwürfe" wert={String(zahl('entwurf'))} />
        <KpiStat label="In Prüfung" wert={String(zahl('vorgelegt'))} />
        <KpiStat label="Geplant" wert={String(zahl('geplant'))} />
        <KpiStat label="Veröffentlicht" wert={String(zahl('veroeffentlicht'))} />
      </div>

      {verbundene === 0 ? (
        <Hinweis art="warnung" cse="social-kein-kanal" className="mb-s5 max-w-prose">
          <strong>Kein fremder Kanal ist verbunden.</strong> Ein Beitrag erscheint damit auf
          der eigenen Gesellschaftsseite — und nirgendwo sonst. Das ist kein Fehler, sondern
          der Stand: welche Plattformkonten es gibt und wem sie gehören, ist offen (O-10).
          {daten.darfKanaele ? (
            <>
              {' '}
              <Link href={`/portal/${mandant}/social/kanaele`}
                    className="underline underline-offset-4">
                Kanäle ansehen
              </Link>.
            </>
          ) : null}
        </Hinweis>
      ) : null}

      <section className="mb-s6">
        <h2 className="mb-s3 text-h2 text-text">Demnächst</h2>
        {geplant.length === 0 ? (
          <Hinweis art="hinweis" cse="social-nichts-geplant" className="max-w-prose">
            Es ist nichts geplant. Ein Beitrag wird geplant, nachdem ein Mensch ihn
            freigegeben hat — vorher gibt es keinen Zeitpunkt, zu dem etwas hinausginge
            (SOC-08).
          </Hinweis>
        ) : (
          <ul data-cse="social-plan" className="flex flex-col gap-s3">
            {geplant.map((b) => (
              <li key={b.id} data-cse="social-plan-zeile"
                  className="grid grid-cols-1 gap-s2 rounded-lg border border-line bg-surface p-s4 md:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <Link href={`/portal/${mandant}/social/posts/${b.id}`}
                        className="text-text underline underline-offset-4 hover:text-brand">
                    {b.titel}
                  </Link>
                  <div className="mt-s1 text-xs text-text-subtle">
                    {b.geplantFuer === null ? '' : BERLIN.format(new Date(b.geplantFuer))}
                  </div>
                </div>
                <StatusPill zustand="Wartet" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-s3 text-h2 text-text">Zuletzt geändert</h2>
        {daten.beitraege.length === 0 ? (
          <Hinweis art="hinweis" cse="social-leer" className="max-w-prose">
            Noch kein Beitrag.
            {daten.darfSchreiben ? (
              <>
                {' '}<Link href={`/portal/${mandant}/social/posts/neu`}
                  className="underline underline-offset-4">Einen Entwurf anlegen</Link> — er geht
                von dort durch Prüfung und Freigabe, nicht direkt hinaus.
              </>
            ) : null}
          </Hinweis>
        ) : (
          <ul data-cse="social-letzte" className="flex flex-col gap-s2">
            {daten.beitraege.slice(0, 8).map((b) => (
              <li key={b.id} data-cse="social-zeile" data-status={b.status}
                  className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s2">
                <Link href={`/portal/${mandant}/social/posts/${b.id}`}
                      className="min-w-0 text-sm text-text underline underline-offset-4 hover:text-brand">
                  {b.titel}
                </Link>
                <span className="text-xs text-text-subtle">
                  {STATUS_TEXT[b.status] ?? b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalRahmen>
  );
}

import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  ladeEmpfaengerziele, listeFaeden, versandwege,
  type Fadenkopf, type Richtung,
} from '@/server/services/kern/nachricht';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/nachrichten` — der Fadenposteingang (EMP-11, CRM-03,
 * `04-SEITENKARTE.md` §5.17).
 *
 * **Fäden, keine Zettel.** Ein Kopf je Vorgang mit der letzten Aktivität und
 * der Zahl der eigenen ungelesenen Zeilen. Flach nach Datum gelistet stünde
 * die Antwort neben der Frage.
 *
 * **Nicht zu verwechseln mit `/portal/mein/nachrichten`**: das ist der
 * Meldungs-Posteingang über `benachrichtigung` (NOT-01). Hier geht es um
 * `nachricht` — den Schriftverkehr in einem Vorgang.
 *
 * **Nach draussen geht nichts.** Kein Versender ist verbunden (O-36), und das
 * steht auf dem Bildschirm, statt einen Erfolg zu behaupten. Interne Fäden
 * funktionieren vollständig — das ist der Unterschied zwischen einer
 * fehlenden Anbindung und einer leeren Seite.
 */
export const dynamic = 'force-dynamic';

const RICHTUNG_TEXT: Readonly<Record<string, string>> = {
  intern: 'intern', eingehend: 'eingehend', ausgehend: 'ausgehend',
};

const KANAL_TEXT: Readonly<Record<string, string>> = {
  portal: 'Portal', email: 'E-Mail', sms: 'SMS',
};

const ZUSTELL_TEXT: Readonly<Record<string, string>> = {
  ausstehend: 'noch nicht hinaus', gesendet: 'gesendet', zugestellt: 'zugestellt',
  fehlgeschlagen: 'fehlgeschlagen', unterdrueckt: 'unterdrückt',
};

const RICHTUNGEN: readonly Richtung[] = ['intern', 'eingehend', 'ausgehend'];

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

export default async function Nachrichtenliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/nachrichten`;

  const nurUngelesen = suche['ungelesen'] === '1';
  const richtungRoh = typeof suche['richtung'] === 'string' ? suche['richtung'] : null;
  const richtung = RICHTUNGEN.find((r) => r === richtungRoh);

  const tor = await mandantTor(pfad, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const jetzt = new Date();
  const { faeden, ziele, darfVersenden } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => {
        /*
         * `nachricht.versenden` in DERSELBEN gebundenen Transaktion: die
         * Route trägt nur `nachricht.lesen`, ein reines Lesekonto erreicht
         * diese Seite also. Ohne die Frage stünde hier ein Formular, dessen
         * „Absenden" von `/api/nachrichten` mit einer nackten 404 beantwortet
         * wird — richtig nach AUT-06 und unerklärt. Dieselbe Frage stellt die
         * Detailseite für das Antwortfeld.
         */
        const [recht] = await kontext.abfrage<{ versenden: boolean }>(
          `select app.hat_recht('nachricht.versenden', app.aktiver_mandant()) as versenden`);
        return {
          faeden: await listeFaeden(kontext, {
            ...(nurUngelesen ? { nurUngelesen: true } : {}),
            ...(richtung === undefined ? {} : { richtung }),
          }),
          ziele: await ladeEmpfaengerziele(kontext),
          darfVersenden: recht?.versenden === true,
        };
      }),
  ) as Promise<{
    faeden: readonly Fadenkopf[];
    ziele: readonly { id: string; name: string }[];
    darfVersenden: boolean;
  }>);

  const ungelesenGesamt = faeden.reduce((s, f) => s + f.ungelesen, 0);
  const wege = versandwege();
  const ohneVersand = wege.filter((w) => !w.verbunden);

  const filterLink = (
    aenderung: { ungelesen?: boolean; richtung?: Richtung | null },
  ) => {
    const q = new URLSearchParams();
    const u = aenderung.ungelesen ?? nurUngelesen;
    const r = aenderung.richtung === undefined ? richtung : aenderung.richtung;
    if (u) q.set('ungelesen', '1');
    if (r !== null && r !== undefined) q.set('richtung', r);
    const s = q.toString();
    return alsRoute(s === '' ? pfad : `${pfad}?${s}`);
  };

  return (
    <PortalRahmen
      titel="Nachrichten"
      wurzelTitel="Portal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="nachrichten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Nachrichten</h1>
        <p className="m-0 text-sm text-text-muted"
           data-cse="ungelesen-gesamt" data-anzahl={String(ungelesenGesamt)}>
          {ungelesenGesamt === 0
            ? `${String(faeden.length)} Fäden, nichts Ungelesenes.`
            : `${String(ungelesenGesamt)} ungelesen in ${String(faeden.length)} Fäden`}
        </p>
      </div>

      {/*
        * **Der wahre Zustand der Anbindung, nicht ein Versprechen** (D-02).
        * Ein Posteingang, der aussieht, als könnte er mailen, verleitet dazu,
        * eine Antwort dort zu tippen und sie für gesendet zu halten.
        */}
      {ohneVersand.length > 0 && (
        <Hinweis art="warnung" cse="versand-nicht-verbunden" className="mb-s5 max-w-prose">
          <strong>Nach draussen geht nichts.</strong>{' '}
          {/*
            * **Die offene Frage steht JE KANAL.** Vorher stand nur die des
            * ersten unverbundenen Kanals am Satzende — E-Mail und SMS wurden
            * beide aufgezählt, nachgelesen werden konnte nur O-36, und die
            * SMS-Frage (O-82) fiel weg, obwohl das Register sie führt.
            */}
          {ohneVersand.map((w) => `${KANAL_TEXT[w.kanal] ?? w.kanal}: nicht verbunden`
            + (w.offen === null ? '' : ` (offen ${w.offen})`)).join(' · ')}
          {'. '}
          Interne Fäden im Portal funktionieren. Was den Kunden erreichen soll,
          geht erst hinaus, wenn ein Versender eingerichtet ist.
        </Hinweis>
      )}

      <div className="mb-s5 flex flex-wrap items-center gap-s2">
        <Link href={filterLink({ richtung: null })} data-cse="filter-alle"
              className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                          ${richtung === undefined
                            ? 'border-line-strong bg-surface-3 text-text'
                            : 'border-line text-text-muted hover:border-line-strong'}`}>
          Alle Richtungen
        </Link>
        {RICHTUNGEN.map((r) => (
          <Link key={r} href={filterLink({ richtung: richtung === r ? null : r })}
                data-cse={`filter-${r}`}
                className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                            ${richtung === r
                              ? 'border-line-strong bg-surface-3 text-text'
                              : 'border-line text-text-muted hover:border-line-strong'}`}>
            {RICHTUNG_TEXT[r]}
          </Link>
        ))}
        <Link href={filterLink({ ungelesen: !nurUngelesen })}
              data-cse="umschalter-ungelesen"
              className="ml-auto inline-flex min-h-11 items-center text-sm text-text-muted
                         underline underline-offset-4 hover:text-text">
          {nurUngelesen ? 'Alle Fäden zeigen' : 'Nur ungelesene'}
        </Link>
      </div>

      <section aria-labelledby="neuer-faden" className="mb-s6">
        <h2 id="neuer-faden" className="text-h2 text-text">Neuer interner Faden</h2>
        {!darfVersenden ? (
          <p data-cse="eroeffnen-fehlt" className="mt-s3 max-w-prose text-sm text-text-muted">
            Zum Eröffnen eines Fadens fehlt das Recht{' '}
            <Recht schluessel="nachricht.versenden" />. Mitlesen bleibt möglich — wer in
            einem Vorgang steht, soll den Schriftverkehr kennen.
          </p>
        ) : (
        <form
          method="post"
          action={`/api/nachrichten?mandant=${mandant}`}
          className="mt-s3 max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="was" value="eroeffnen" />

          <label className="block text-sm text-text" htmlFor="betreff">Betreff</label>
          <input
            id="betreff" name="betreff" type="text" maxLength={200}
            className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="empfaenger">
            An (Konto dieser Gesellschaft)
          </label>
          <select
            id="empfaenger" name="empfaenger" required
            className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          >
            <option value="">— bitte wählen —</option>
            {ziele.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="koerper">Text</label>
          <textarea
            id="koerper" name="koerper" rows={3} required
            className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <Button type="submit" variante="primary" data-cse="faden-eroeffnen"
                  className="mt-s4">
            Absenden
          </Button>
          <p className="m-0 mt-s3 text-xs text-text-subtle">
            Intern, Kanal Portal. Der Empfänger liest es angemeldet — es
            verlässt das System nicht.
          </p>
        </form>
        )}
      </section>

      {faeden.length === 0 ? (
        <Hinweis art="hinweis" cse="faeden-leer">
          <strong>Kein Faden.</strong>{' '}
          {nurUngelesen
            ? 'Alles gelesen. Ältere Fäden stehen unter „Alle Fäden zeigen".'
            : 'Hier stehen Vorgänge mit Schriftverkehr — intern, eingehend oder ausgehend.'}
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Nachrichtenfäden, letzte Aktivität zuerst"
          zeilen={faeden}
          schluessel={(f) => f.threadId}
          spalten={[
            {
              schluessel: 'betreff',
              kopf: 'Vorgang',
              zelle: (f) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/nachrichten/${f.threadId}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {f.betreff ?? 'Ohne Betreff'}
                  </Link>
                  <span className="block text-xs text-text-muted">{f.auszug}</span>
                </span>
              ),
            },
            {
              schluessel: 'gegenueber',
              kopf: 'Letzte von',
              zelle: (f) => f.absender ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'richtung',
              kopf: 'Richtung',
              zelle: (f) => (
                <span>
                  {RICHTUNG_TEXT[f.richtung] ?? f.richtung}
                  <span className="block text-xs text-text-subtle">
                    {KANAL_TEXT[f.kanal] ?? f.kanal}
                    {f.richtung === 'ausgehend'
                      ? ` · ${ZUSTELL_TEXT[f.zustellStatus] ?? f.zustellStatus}` : ''}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'anzahl',
              kopf: 'Zeilen',
              numerisch: true,
              zelle: (f) => String(f.anzahl),
            },
            {
              schluessel: 'aktivitaet',
              kopf: 'Zuletzt',
              zelle: (f) => (
                <time dateTime={f.letzteAktivitaet.toISOString()}
                      title={zeitpunkt(f.letzteAktivitaet)}>
                  {seit(f.letzteAktivitaet, jetzt)}
                </time>
              ),
            },
            {
              schluessel: 'stand',
              kopf: 'Stand',
              zelle: (f) => (f.geschlossenAm !== null
                ? <StatusPill zustand="Abgeschlossen" />
                : f.ungelesen > 0
                  ? (
                    <span data-cse="ungelesen" data-anzahl={String(f.ungelesen)}>
                      <StatusPill zustand="Offen" />
                    </span>
                  )
                  : <span className="text-text-subtle">gelesen</span>),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}

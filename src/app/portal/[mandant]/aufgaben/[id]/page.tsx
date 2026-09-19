import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  fristlage, istOffen, ladeAufgabe, ladeZuweisungsziele,
  type AufgabeDetail, type Zuweisungsziele,
} from '@/server/services/kern/aufgabe';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../../unterseite';
import { kennungOder404 } from '../../../kennung';

/**
 * `/portal/[mandant]/aufgaben/[id]` — eine Aufgabe, ihre Herkunft und ihr
 * Abschluss (OPS-11, SPEC §14).
 *
 * **Die Herkunft steht oben, nicht im Kleingedruckten.** `quelle`,
 * `quelle_job` und `job_lauf_id` sagen, ob ein Mensch die Aufgabe gestellt hat
 * oder welcher Nachtlauf sie schrieb. Ohne das ist eine Wächteraufgabe eine
 * anonyme Forderung, und anonyme Forderungen werden nicht erledigt.
 *
 * **Erledigen und Abbrechen sind POST-Formulare.** Der Zeitpunkt und der
 * Mensch kommen aus der Serveruhr und der Sitzung (Invariante 5); ein GET, das
 * stempelt, löst ein Vorauslader aus.
 *
 * **Eine fremde oder unbekannte Kennung gibt 404, nie 403** (AUT-06). Die
 * RLS liefert null Zeilen, und der Dienst gibt `null` zurück — die Seite kann
 * gar nicht unterscheiden, und genau das ist gewollt.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen', in_arbeit: 'In Arbeit', wartend: 'Wartet',
  erledigt: 'Abgeschlossen', abgebrochen: 'Archiviert',
};

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  mensch: 'von einem Menschen angelegt',
  zeitplan: 'von einem Wächter gemeldet',
  ereignis: 'aus einem Ereignis entstanden',
  agent: 'von einem Agenten vorgeschlagen',
};

const BEZUG_TEXT: Readonly<Record<string, string>> = {
  auftrag: 'Auftrag', objekt: 'Objekt', lead: 'Lead', kunde: 'Kunde',
  rechnung: 'Rechnung', angebot: 'Angebot', projekt: 'Projekt',
  ausschreibung: 'Ausschreibung', bewerbung: 'Bewerbung', stelle: 'Stelle',
  freigabe: 'Freigabe', dokument: 'Dokument', einsatz: 'Einsatz',
  zeiteintrag: 'Zeiteintrag', nachtrag: 'Nachtrag', referenz: 'Referenz',
  seite: 'Seite', person: 'Person', anstellung: 'Anstellung',
  agent_aufgabe: 'Agentenlauf', eingangsrechnung: 'Eingangsrechnung',
  social_post: 'Beitrag', kandidat: 'Kandidat', gespraech: 'Gespräch',
  ausschreibung_vorgang: 'Vergabevorgang', vergabemappe: 'Vergabemappe',
};

function zeitpunkt(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(d);
}

function tagAnzeige(tag: string): string {
  const [jahr, monat, t] = tag.split('-');
  return `${String(t)}.${String(monat)}.${String(jahr)}`;
}

export default async function AufgabeSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id: roh } = await params;
  const id = kennungOder404(roh);
  const suche = await searchParams;
  const getan = typeof suche['getan'] === 'string' ? suche['getan'] : null;

  const tor = await mandantTor(`/portal/${mandant}/aufgaben/${id}`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => {
        const aufgabe = await ladeAufgabe(kontext, id);
        if (aufgabe === null) return null;
        /*
         * `aufgabe.zuweisen` ist ein EIGENES Recht: wer eine Aufgabe ansehen
         * und bearbeiten darf, darf sie nicht schon deswegen jemand anderem
         * aufhalsen. Gefragt wird in derselben gebundenen Transaktion wie
         * gelesen wird — ein zweiter Aufruf läse mit einer anderen Sitzung.
         */
        const [recht] = await kontext.abfrage<{ zuweisen: boolean }>(
          `select app.hat_recht('aufgabe.zuweisen', app.aktiver_mandant()) as zuweisen`);
        return {
          aufgabe,
          ziele: await ladeZuweisungsziele(kontext),
          darfZuweisen: recht?.zuweisen === true,
        };
      }),
  ) as Promise<{
    aufgabe: AufgabeDetail; ziele: Zuweisungsziele; darfZuweisen: boolean;
  } | null>);

  if (daten === null) notFound();
  const { aufgabe, ziele, darfZuweisen } = daten;
  const jetzt = new Date();
  const lage = fristlage(aufgabe, jetzt);

  const fristText = aufgabe.faelligAm !== null
    ? zeitpunkt(aufgabe.faelligAm)
    : aufgabe.faelligDatum !== null ? tagAnzeige(aufgabe.faelligDatum) : null;

  return (
    <PortalRahmen
      titel={aufgabe.titel}
      wurzelTitel="Portal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/aufgaben`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Aufgaben
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{aufgabe.titel}</h1>
        <StatusPill zustand={STATUS_PILLE[aufgabe.status] ?? 'Offen'} />
        {lage === 'ueberfaellig' && istOffen(aufgabe.status) && (
          <StatusPill zustand="Überfällig" />
        )}
      </div>

      {getan !== null && (
        <Hinweis art="erfolg" cse="getan" className="mb-s5 max-w-prose">
          <strong>Gespeichert.</strong>{' '}
          {getan === 'erledigt'
            ? 'Die Aufgabe bleibt stehen — erledigt heisst gestempelt, nicht gelöscht.'
            : getan === 'abgebrochen'
              ? 'Die Aufgabe bleibt mit ihrem Grund stehen.'
              : 'Die Änderung ist gespeichert.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Frist</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {fristText === null ? <span className="text-text-subtle">ohne Frist</span> : (
              <span data-cse="frist" data-lage={lage}
                    className={lage === 'ueberfaellig' ? 'text-danger'
                      : lage === 'heute' ? 'text-warning' : 'text-text'}>
                {fristText}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Priorität
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">{aufgabe.prioritaet}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Zuständig
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {aufgabe.zugewiesenAn ?? aufgabe.team ?? (
              <span className="text-warning">niemand</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Bezug</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {aufgabe.bezug === null ? <span className="text-text-subtle">—</span>
              : aufgabe.bezug.pfad === null ? (
                <span data-cse="bezug-ohne-ziel" className="text-text-muted">
                  {BEZUG_TEXT[aufgabe.bezug.typ] ?? aufgabe.bezug.typ}
                </span>
              ) : (
                <Link href={`/portal/${mandant}/${aufgabe.bezug.pfad}`}
                      data-cse="bezug"
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  <span className="block text-xs text-text-subtle">
                    {BEZUG_TEXT[aufgabe.bezug.typ] ?? aufgabe.bezug.typ}
                  </span>
                  {aufgabe.bezug.titel}
                </Link>
              )}
          </dd>
        </div>
      </dl>

      {aufgabe.beschreibung === null ? null : (
        <p className="mb-s6 max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
          {aufgabe.beschreibung}
        </p>
      )}

      <section aria-labelledby="herkunft" className="mb-s7">
        <h2 id="herkunft" className="text-h2 text-text">Herkunft</h2>
        <p data-cse="herkunft" className="m-0 max-w-prose text-sm text-text-muted">
          {QUELLE_TEXT[aufgabe.quelle] ?? aufgabe.quelle}
          {aufgabe.erstelltVon === null ? '' : ` · ${aufgabe.erstelltVon}`}
          {` · ${zeitpunkt(aufgabe.erstelltAm)}`}
        </p>
        {aufgabe.quelleJob === null ? null : (
          <p className="m-0 mt-s1 max-w-prose text-xs text-text-subtle">
            {`Job: ${aufgabe.quelleJob}`}
            {aufgabe.jobLaufId === null ? '' : ` · Lauf ${aufgabe.jobLaufId}`}
          </p>
        )}
        {aufgabe.erledigtAm === null ? null : (
          <p data-cse="erledigt" className="m-0 mt-s2 max-w-prose text-sm text-text">
            {`Erledigt ${zeitpunkt(aufgabe.erledigtAm)}`}
            {aufgabe.erledigtVon === null ? '' : ` von ${aufgabe.erledigtVon}`}
          </p>
        )}
        {aufgabe.abgebrochenGrund === null ? null : (
          <p data-cse="abgebrochen" className="m-0 mt-s2 max-w-prose text-sm text-text">
            {`Abgebrochen: ${aufgabe.abgebrochenGrund}`}
          </p>
        )}
      </section>

      {!istOffen(aufgabe.status) ? (
        <Hinweis art="hinweis" cse="abgeschlossen">
          <strong>Diese Aufgabe ist abgeschlossen.</strong>{' '}
          Erledigt und abgebrochen sind Zustände, keine Löschung — die Zeile
          bleibt mit ihrem Verlauf stehen (Invariante 8).
        </Hinweis>
      ) : (
        <div className="grid grid-cols-1 gap-s5 lg:grid-cols-2">
          <section aria-labelledby="stand" className="rounded-lg border border-line bg-surface p-s5">
            <h2 id="stand" className="mt-0 text-h2 text-text">Stand</h2>
            <form method="post" action={`/api/aufgaben?mandant=${mandant}`}>
              <input type="hidden" name="was" value="status" />
              <input type="hidden" name="id" value={aufgabe.id} />
              <label className="block text-sm text-text" htmlFor="status">Status</label>
              <select
                id="status" name="status" defaultValue={aufgabe.status}
                className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
              >
                <option value="offen">offen</option>
                <option value="in_arbeit">in Arbeit</option>
                <option value="wartend">wartend</option>
              </select>
              <Button type="submit" variante="secondary" data-cse="status-setzen"
                      className="mt-s4">
                Übernehmen
              </Button>
            </form>

            <form method="post" action={`/api/aufgaben?mandant=${mandant}`} className="mt-s5">
              <input type="hidden" name="was" value="erledigen" />
              <input type="hidden" name="id" value={aufgabe.id} />
              <Button type="submit" variante="primary" data-cse="erledigen">
                Erledigt
              </Button>
            </form>
          </section>

          <section aria-labelledby="zuweisen"
                   className="rounded-lg border border-line bg-surface p-s5">
            <h2 id="zuweisen" className="mt-0 text-h2 text-text">Zuweisen</h2>
            {darfZuweisen ? (
              <form method="post" action={`/api/aufgaben?mandant=${mandant}`}>
                <input type="hidden" name="was" value="zuweisen" />
                <input type="hidden" name="id" value={aufgabe.id} />
                <label className="block text-sm text-text" htmlFor="benutzerId">Person</label>
                <select
                  id="benutzerId" name="benutzerId"
                  defaultValue={aufgabe.zugewiesenAnId ?? ''}
                  className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
                >
                  <option value="">— niemand —</option>
                  {ziele.benutzer.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>

                <label className="mt-s4 block text-sm text-text" htmlFor="teamId">Team</label>
                <select
                  id="teamId" name="teamId" defaultValue={aufgabe.zugewiesenTeamId ?? ''}
                  className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
                >
                  <option value="">— kein Team —</option>
                  {ziele.teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>

                <Button type="submit" variante="secondary" data-cse="zuweisen"
                        className="mt-s4">
                  Zuweisen
                </Button>
              </form>
            ) : (
              <p data-cse="zuweisen-fehlt" className="m-0 text-sm text-text-muted">
                Zum Zuweisen fehlt das Recht <code>aufgabe.zuweisen</code>.
                Angezeigt wird der Stand trotzdem — wer eine Aufgabe sieht, soll
                wissen, wer sie hält.
              </p>
            )}

            <form method="post" action={`/api/aufgaben?mandant=${mandant}`} className="mt-s5">
              <input type="hidden" name="was" value="abbrechen" />
              <input type="hidden" name="id" value={aufgabe.id} />
              <label className="block text-sm text-text" htmlFor="grund">
                Abbrechen — Grund (Pflicht)
              </label>
              <input
                id="grund" name="grund" type="text" required maxLength={400}
                className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
              />
              <Button type="submit" variante="danger" data-cse="abbrechen" className="mt-s4">
                Abbrechen
              </Button>
            </form>
          </section>
        </div>
      )}
    </PortalRahmen>
  );
}

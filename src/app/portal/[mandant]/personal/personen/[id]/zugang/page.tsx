import type postgres from 'postgres';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { smsDienst } from '@/server/auth/sms';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { GRUND_TEXT, ZUGANGSCODE_COOKIE, type ZugangscodeGrund } from '@/server/services/personal/zugangscode';
import type { BereichSchluessel } from '@/lib/design/theme';
import { lesePerson, type PersonZeile } from '../../daten';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';

/**
 * `/portal/[mandant]/personal/personen/[id]/zugang` — der Zugang einer
 * Mitarbeiterin: Mobilnummer, SMS-Stand, und der Anmeldecode aus der Hand
 * der Einsatzleitung, solange kein Gateway verbunden ist (EMP-01, O-82,
 * D-487).
 *
 * Der Code wird einmal gezeigt — aus einem kurzlebigen Keks, den die Route
 * setzt; nie aus der Adresse. Wer ihn sieht, nennt ihn der Person; die
 * Person gibt ihn unter /auth/mitarbeiter mit ihrer Nummer ein.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function maskiert(telefon: string | null): string {
  if (telefon === null || telefon.length < 4) return '—';
  return `${telefon.slice(0, 4)} … ${telefon.slice(-3)}`;
}

export default async function Zugang(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/personal/personen/${id}/zugang`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const grundRoh = typeof suche['grund'] === 'string' ? suche['grund'] : null;
  const grund = (['keine_anstellung', 'kein_zugang', 'gesperrt', 'bremse'] as const)
    .find((g) => g === grundRoh) ?? null;

  const heute = await berlinHeute();
  const person = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => lesePerson(kontext, heute, id))) as Promise<PersonZeile | null>);
  if (person === null) notFound();

  const sms = smsDienst(devFlaechenAn());
  const code = (await cookies()).get(ZUGANGSCODE_COOKIE)?.value ?? null;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel="Zugang"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Zugang — {person.name}</h1>
        <Link href={`/portal/${mandant}/personal/personen/${id}`} className={knopf}>Zur Person</Link>
      </div>

      <dl data-cse="zugang-stand" className="mb-s5 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Mobilnummer</dt>
        <dd className="text-text tabular-nums">{maskiert(person.telefon)}</dd>
        <dt className="text-text-muted">Anmeldung</dt>
        <dd className="text-text">Mobilnummer + sechsstelliger Einmalcode, zehn Minuten gültig — kein Kennwort (EMP-01)</dd>
        <dt className="text-text-muted">SMS-Versand</dt>
        <dd className="text-text" data-cse="zugang-sms">{sms.verbunden ? sms.name : 'nicht verbunden (O-82)'}</dd>
      </dl>

      {person.telefon === null ? (
        <Hinweis art="warnung" cse="zugang-ohne-nummer" className="mb-s5 max-w-prose">
          <strong>Keine Mobilnummer hinterlegt.</strong> Ohne Nummer gibt es keinen Zugang und keinen Code.
        </Hinweis>
      ) : null}

      {code !== null ? (
        <Hinweis art="erfolg" cse="zugang-code" className="mb-s5 max-w-prose">
          <strong>Anmeldecode ausgestellt.</strong> Nennen Sie der Person diesen Code — er gilt zehn Minuten
          und genau einmal:{' '}
          <code data-cse="zugang-code-wert" className="rounded-md bg-surface-3 px-s2 py-s1 font-mono text-base tracking-widest">{code}</code>
          <span className="mt-s2 block text-xs">
            Die Person meldet sich unter <span className="font-mono">/auth/mitarbeiter</span> mit ihrer
            Mobilnummer an und gibt den Code ein. Die Ausstellung steht im Protokoll.
          </span>
        </Hinweis>
      ) : null}
      {grund !== null ? (
        <Hinweis art="warnung" cse="zugang-abgewiesen" className="mb-s5 max-w-prose">
          <strong>Kein Code ausgestellt.</strong> {GRUND_TEXT[grund as ZugangscodeGrund]}
        </Hinweis>
      ) : null}

      <form method="post" action="/api/personal/zugang-code" data-cse="zugang-formular"
            className="mb-s6 flex max-w-prose flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="person" value={id} />
        <p className="text-sm text-text">
          {sms.verbunden
            ? 'Der Code geht normalerweise per SMS. Hier stellen Sie ihn zusätzlich aus, wenn die SMS nicht ankommt.'
            : 'Solange kein SMS-Gateway verbunden ist (O-82), stellt die Einsatzleitung den Code hier aus und nennt ihn der Person — derselbe Code, dieselbe Frist, dieselbe Bremse (drei offene Codes).'}
        </p>
        <div>
          <Button type="submit" variante="primary" data-cse="zugang-code-ausstellen" disabled={person.telefon === null}>
            Anmeldecode ausstellen
          </Button>
        </div>
      </form>

      <p className="max-w-prose text-xs text-text-muted">
        Ein Ersetzen der Mobilnummer und das Sperren des Zugangs (Vier-Augen, O-86) sind hier noch nicht
        gebaut; bis dahin ändert die Super-Administration die Nummer an der Person.
      </p>
    </PortalRahmen>
  );
}

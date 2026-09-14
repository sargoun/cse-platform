import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { sichererRueckweg } from '@/server/auth/kennwort-anmeldung';
import { bindeAnfrage } from '@/server/kontext';
import { db } from '@/server/db/pool';
import { AuthSchale } from '../AuthSchale';

/**
 * `/auth/kein-zugriff` — angemeldet, aber das Recht fehlt.
 *
 * **Der Unterschied zu AUT-06 ist der Gegenstand.** Fuer eine fremde ZEILE
 * gibt die Plattform 404: dass es sie gibt, ist selbst schon eine Auskunft.
 * Fuer ein fehlendes RECHT im eigenen Mandanten gilt das nicht — dass es das
 * Modul gibt, steht im Menue, und ein 404 hiesse hier nur „suchen Sie
 * weiter". Wer nicht darf, soll wissen, dass er nicht darf, und wen er fragen
 * kann.
 *
 * Deshalb steht hier, WAS fehlt und WER es vergeben kann — nicht als
 * Entschuldigung, sondern damit der naechste Schritt ohne Rueckfrage im
 * Support klar ist.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Kein Zugriff — CSE Gruppe' };

interface Zeile { name: string; mandant: string | null; rolle: string | null }

export default async function KeinZugriff({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const recht = typeof p['recht'] === 'string' && /^[a-z][a-z0-9_.]{2,60}$/u.test(p['recht'])
    ? p['recht'] : null;
  const wohin = sichererRueckweg(p['pfad']);

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) redirect('/auth/login');

  const wer = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const zeilen = (await tx.unsafe(
      `select b.name,
              m.name as mandant,
              r.bezeichnung as rolle
         from benutzer b
         left join benutzer_mandant bm
                on bm.benutzer_id = b.id and bm.entzogen_am is null
               and bm.mandant_id is not distinct from $2::uuid
         left join rolle r on r.id = bm.rolle_id
         left join mandant m on m.id = bm.mandant_id
        where b.id = $1::uuid`,
      [sitzung.benutzerId, sitzung.aktiverMandantId],
    )) as Zeile[];
    return zeilen[0] ?? null;
  }) as Promise<Zeile | null>);

  return (
    <AuthSchale
      titel="Dafür fehlt Ihnen das Recht"
      unterzeile="Sie sind angemeldet — für diesen Bereich ist Ihre Rolle nur nicht
                  freigeschaltet."
      fuss={
        <p>
          <a href="/portal" data-cse="zurueck-portal"
             className="inline-flex min-h-11 items-center underline underline-offset-4
                        hover:text-text">
            Zurück ins Portal
          </a>
        </p>
      }
    >
      <Card className="flex flex-col gap-s3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s2 text-sm">
          <dt className="text-text-subtle">Angemeldet als</dt>
          <dd data-cse="kz-benutzer" className="text-text">{wer?.name ?? '—'}</dd>
          <dt className="text-text-subtle">Gesellschaft</dt>
          <dd data-cse="kz-mandant" className="text-text">
            {wer?.mandant ?? (sitzung.ansicht === 'gruppe' ? 'Gruppenansicht' : '—')}
          </dd>
          <dt className="text-text-subtle">Rolle</dt>
          <dd data-cse="kz-rolle" className="text-text">{wer?.rolle ?? '—'}</dd>
          {recht !== null && (
            <>
              <dt className="text-text-subtle">Benötigtes Recht</dt>
              <dd data-cse="kz-recht" className="font-mono text-text">{recht}</dd>
            </>
          )}
          {wohin !== null && (
            <>
              <dt className="text-text-subtle">Aufgerufen</dt>
              <dd data-cse="kz-pfad" className="break-all font-mono text-text">{wohin}</dd>
            </>
          )}
        </dl>
      </Card>

      <Hinweis art="hinweis" cse="kz-weg">
        <strong>So kommen Sie weiter.</strong> Eine Administration Ihrer Gesellschaft vergibt
        das Recht unter Einstellungen → Rollen und Rechte. Nennen Sie ihr die drei Angaben
        oben — damit ist die Vergabe eine Minute Arbeit statt einer Suche.
      </Hinweis>

      {sitzung.aal === 'aal1' && (
        <Hinweis art="warnung" cse="kz-aal1">
          <strong>Möglicherweise fehlt nur die zweite Stufe.</strong> Manche Rechte verlangen
          einen zweiten Faktor <em>in dieser Anmeldung</em> (AUT-02). Ihre Sitzung ist auf
          Stufe eins.{' '}
          <a href="/auth/zwei-faktor/pruefen" data-cse="kz-zu-faktor"
             className="underline underline-offset-4">Zweiten Faktor jetzt vorzeigen</a>.
        </Hinweis>
      )}
    </AuthSchale>
  );
}

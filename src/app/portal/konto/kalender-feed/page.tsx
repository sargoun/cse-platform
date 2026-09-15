import type postgres from 'postgres';
import Link from 'next/link';
import { db } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { leisteFuer } from '@/server/registry/tableiste';
import { eigeneFeeds, type FeedStand } from '@/server/kalender/feed';
import { AnmeldungNoetig } from '../../Anmeldung';
import { leseKonto } from '../konto';

/**
 * `/portal/konto/kalender-feed` — der lesende iCal-Zugang (CAL-03).
 *
 * **Die Adresse gibt es genau einmal.** Sie steht nach dem Anlegen auf dieser
 * Seite und danach nie wieder: gespeichert ist der SHA-256 des Tokens, nicht
 * der Token. Wer sie verliert, legt einen neuen Zugang an und widerruft den
 * alten — das ist billiger als ein Geheimnis, das man nachschlagen kann.
 *
 * **Unter „Konto" und nicht unter „Einstellungen".** Der Feed hängt an
 * `benutzer_id` und zeigt die Termine DIESES MENSCHEN über alle
 * Gesellschaften, in denen er Mitglied ist. Unter „Einstellungen" stünde er
 * neben denen der Gesellschaft, und die nächste Administration nähme an, für
 * alle zu entscheiden.
 *
 * **Und die Seite sagt, was der Zugang kann.** Wer eine Adresse weitergibt,
 * die „nur ein Kalender" heisst, soll wissen, dass sie ohne Anmeldung gilt,
 * bis jemand sie widerruft.
 */
export const dynamic = 'force-dynamic';


function zeitpunkt(roh: string | null): string {
  if (roh === null) return 'noch nie';
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(new Date(roh));
}

export default async function KalenderFeed({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const suche = await searchParams;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const k = await leseKonto(sitzung);

  /*
   * **Der frische Token kommt aus der Adresse und wird nicht gespeichert.**
   * Die Route legt ihn an und leitet hierher; danach ist er weg. Das ist der
   * Preis dafuer, dass er nirgends nachschlagbar ist -- und genau der Punkt.
   */
  const frisch = typeof suche['neu'] === 'string' ? suche['neu'] : null;
  const widerrufen = suche['widerrufen'] === '1';

  const feeds = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return eigeneFeeds({ abfrage });
  }) as Promise<readonly FeedStand[]>);

  const wurzel = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : sitzung.portal === 'mitarbeiter' ? '/portal/mein'
    : sitzung.portal === 'kunde' ? '/portal/kunde'
    : k.slug === null ? '/auth/bereich' : `/portal/${k.slug}`;

  return (
    <PortalRahmen
      titel="Kalender abonnieren"
      wurzelTitel="Konto"
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Kalender abonnieren</h1>
        {k.slug === null ? null : (
          <Link href={`/portal/${k.slug}/kalender`} data-cse="zum-kalender"
                className="text-sm text-text underline underline-offset-2">
            Zum Kalender
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein <strong className="text-text">lesender</strong> Zugang für Ihr Kalenderprogramm —
        Apple Kalender, Outlook, Thunderbird. Er zeigt Ihre Termine, Ihre Schichten und Ihre
        Fristen aus allen Bereichen, in denen Sie Mitglied sind. Ändern lässt sich darüber
        nichts.
      </p>

      {frisch !== null && (
        <Hinweis art="erfolg" cse="feed-neu" className="mb-s5 max-w-prose">
          <strong>Diese Adresse sehen Sie genau einmal.</strong> Kopieren Sie sie jetzt in Ihr
          Kalenderprogramm. Gespeichert ist nur ihre Prüfsumme — wir können sie Ihnen später
          nicht noch einmal zeigen, und niemand kann sie aus der Datenbank lesen.
          <code data-cse="feed-adresse"
                className="mt-s3 block overflow-x-auto rounded-md bg-surface-3 p-s3
                           text-xs text-text">
            /api/kalender/{frisch}
          </code>
        </Hinweis>
      )}

      {widerrufen && (
        <Hinweis art="hinweis" cse="feed-widerrufen-bestaetigt" className="mb-s5 max-w-prose">
          <strong>Widerrufen.</strong> Der nächste Abruf mit dieser Adresse bekommt nichts
          mehr — sofort, nicht beim nächsten Abgleich.
          {' '}
          <span className="text-text-muted">
            Sollte der Zugang unten noch stehen, ist das eine veraltete Anzeige und kein
            offener Zugang (O-510): ein Neuladen der Seite zeigt den richtigen Stand.
          </span>
        </Hinweis>
      )}

      <Hinweis art="warnung" cse="feed-warnung" className="mb-s6 max-w-prose">
        <strong>Die Adresse IST der Zugang.</strong> Wer sie hat, sieht Ihre Termine — ohne
        Anmeldung und ohne zweiten Faktor, bis Sie widerrufen. Ein Kalenderprogramm kann sich
        nicht anmelden; das ist der Grund, und es ist auch die Grenze. Geben Sie die Adresse
        nicht weiter, und widerrufen Sie sie, wenn ein Gerät abhandenkommt.
      </Hinweis>

      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Ihre Zugänge</h2>
        {feeds.length === 0 ? (
          <Hinweis art="hinweis" cse="feed-leer" className="max-w-prose">
            Sie haben noch keinen Zugang. Ohne einen holt kein Kalenderprogramm etwas ab —
            und das ist der Ruhezustand, nicht ein fehlender Schritt.
          </Hinweis>
        ) : (
          <ul className="flex list-none flex-col gap-s3 p-0">
            {feeds.map((f) => (
              <li key={f.id}>
                <Card className="flex flex-wrap items-center justify-between gap-s3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text" data-cse="feed-name">
                      {f.bezeichnung}
                    </p>
                    <p className="mt-s1 text-xs text-text-muted">
                      Angelegt {zeitpunkt(f.erstelltAm)} · zuletzt abgerufen{' '}
                      {zeitpunkt(f.letzterAbrufAm)}
                      {f.abrufe > 0 && ` · ${String(f.abrufe)}×`}
                    </p>
                  </div>
                  <form method="post" action="/api/kalender-feed/widerrufen">
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit" variante="secondary" data-cse="feed-widerrufen">
                      Widerrufen
                    </Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form method="post" action="/api/kalender-feed/anlegen">
        <Button type="submit" variante="primary" data-cse="feed-anlegen">
          Neuen Zugang anlegen
        </Button>
      </form>
      <p className="mt-s2 max-w-prose text-xs text-text-subtle">
        Ein zweiter Zugang ist sinnvoll, wenn Sie zwei Geräte getrennt widerrufen können
        wollen. Der alte bleibt gültig, bis Sie ihn widerrufen.
      </p>
    </PortalRahmen>
  );
}

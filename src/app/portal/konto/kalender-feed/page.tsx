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
import {
  eigeneFeeds, FEED_STANDARD_BEZEICHNUNG, type FeedStand,
} from '@/server/kalender/feed';
import {
  meinBeschriftungen, meinTexte, PORTAL_BCP47, PORTAL_RICHTUNG, type PortalSprache,
} from '@/lib/i18n/texte';
import { KALENDER_FEED_TEXTE } from '@/lib/i18n/konto';
import { setzeEin } from '@/lib/i18n/vorlage';
import { zeitpunktInSprache } from '@/lib/datum/zeitpunkt';
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
 *
 * **In der Sprache der Person, wo die Hülle die der Beschäftigten ist**
 * (SEITENKARTE §12, D-694 Nr. 7, D-750): die übersetzte Kontowurzel
 * verweist jede Kraft hierher, und genau die Warnung unten muss sie lesen
 * können. Die Verwaltung liest Deutsch wie Kontowurzel und
 * Benachrichtigungen; Zeitpunkte stehen in Berliner Zeit in der gesetzlichen
 * Form (`zeitpunktInSprache`, V-201).
 */
export const dynamic = 'force-dynamic';


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

  const arbeiter = sitzung.portal === 'mitarbeiter';
  const sprache: PortalSprache = arbeiter ? (k.sprache ?? 'de') : 'de';
  const t = KALENDER_FEED_TEXTE[sprache];
  const meine = arbeiter ? meinTexte(sprache) : null;
  /* Fliesstext der Beschäftigten nie unter 16 px (DESIGN §8, D-738). */
  const klein = arbeiter ? 'text-base' : 'text-sm';
  const kleiner = arbeiter ? 'text-base' : 'text-xs';
  const groesse = arbeiter ? 'base' : 'sm';
  const zeitpunkt = (roh: string | null): string =>
    roh === null ? t.nochNie : zeitpunktInSprache(roh, sprache);
  const name = (f: FeedStand): string =>
    f.bezeichnung === FEED_STANDARD_BEZEICHNUNG ? t.standardName : f.bezeichnung;

  return (
    <div lang={PORTAL_BCP47[sprache]} dir={PORTAL_RICHTUNG[sprache]} data-sprache={sprache}>
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.konto}
      bereich={null}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
      wurzel={wurzel}
      sichtbareTabs={k.sichtbareTabs}
      navigationsRechte={k.navigationsRechte}
      {...(meine === null ? {} : { beschriftungen: meinBeschriftungen(meine) })}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.titel}</h1>
        {/* Der Kalender eines Bereichs ist Verwaltung — die Hülle der
            Beschäftigten betritt `/portal/<bereich>` nicht (K-04-Decke). */}
        {k.slug === null || arbeiter ? null : (
          <Link href={`/portal/${k.slug}/kalender`} data-cse="zum-kalender"
                className={`${klein} text-text underline underline-offset-2`}>
            {t.zumKalender}
          </Link>
        )}
      </div>

      <p className={`mb-s5 max-w-prose ${klein} text-text-muted`}>
        <strong className="text-text">{t.nurLesend}</strong>{' '}
        {t.einleitung}
      </p>

      {frisch !== null && (
        <Hinweis art="erfolg" cse="feed-neu" groesse={groesse} className="mb-s5 max-w-prose">
          <strong>{t.neuTitel}</strong>{' '}
          {t.neuText}
          <code data-cse="feed-adresse" dir="ltr"
                className={`mt-s3 block overflow-x-auto rounded-md bg-surface-3 p-s3
                           ${kleiner} text-text`}>
            {`/api/kalender/${frisch}`}
          </code>
        </Hinweis>
      )}

      {widerrufen && (
        <Hinweis art="hinweis" cse="feed-widerrufen-bestaetigt" groesse={groesse}
                 className="mb-s5 max-w-prose">
          <strong>{t.widerrufenTitel}</strong>{' '}
          {t.widerrufenText}
          {' '}
          <span className="text-text-muted">{t.widerrufenVeraltet}</span>
        </Hinweis>
      )}

      <Hinweis art="warnung" cse="feed-warnung" groesse={groesse} className="mb-s6 max-w-prose">
        <strong>{t.warnungTitel}</strong>{' '}
        {t.warnungText}
      </Hinweis>

      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">{t.zugaenge}</h2>
        {feeds.length === 0 ? (
          <Hinweis art="hinweis" cse="feed-leer" groesse={groesse} className="max-w-prose">
            {t.leer}
          </Hinweis>
        ) : (
          <ul className="flex list-none flex-col gap-s3 p-0">
            {feeds.map((f) => (
              <li key={f.id}>
                <Card className="flex flex-wrap items-center justify-between gap-s3">
                  <div className="min-w-0">
                    <p className={`${klein} font-medium text-text`} data-cse="feed-name">
                      {name(f)}
                    </p>
                    <p className={`mt-s1 ${kleiner} text-text-muted`}>
                      {t.angelegt}{' '}
                      <span className="cse-zahl">{zeitpunkt(f.erstelltAm)}</span>
                      {' · '}
                      {t.zuletztAbgerufen}{' '}
                      <span className="cse-zahl">{zeitpunkt(f.letzterAbrufAm)}</span>
                      {f.abrufe > 0 && (
                        <>
                          {' · '}
                          <span className="cse-zahl">
                            {setzeEin(t.abrufe, { anzahl: String(f.abrufe) })}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <form method="post" action="/api/kalender-feed/widerrufen">
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit" variante="secondary" data-cse="feed-widerrufen">
                      {t.widerrufen}
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
          {t.anlegen}
        </Button>
      </form>
      <p className={`mt-s2 max-w-prose ${kleiner} text-text-subtle`}>
        {t.zweiterZugang}
      </p>
    </PortalRahmen>
    </div>
  );
}

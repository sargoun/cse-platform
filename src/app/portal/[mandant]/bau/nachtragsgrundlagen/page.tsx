import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { NACHTRAGSGRUNDLAGEN_TEXTE } from '@/lib/i18n/verwaltung/nachtragsgrundlagen';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  leseGrundlagenKatalog, type GrundlageKatalogZeile,
} from '@/server/services/bau/nachtrag-grundlage';

/**
 * `/portal/[mandant]/bau/nachtragsgrundlagen` — die Anspruchsgrundlagen der
 * Nachträge: bestätigen, archivieren, wieder aufnehmen (BAU-04, K-17, V-384,
 * O-23, D-842).
 *
 * **Was hier entschieden wird und was nicht.** Der Text jeder Grundlage ist
 * das Gesetz und wird hier nicht geändert; entschieden wird, welche dieser
 * Grundlagen die Gesellschaft verwendet (O-23). Eine eigene Grundlage legt
 * niemand an — ein Nachtrag wählt aus dem Katalog, nie Freitext (K-17).
 *
 * **Archiviert, nie gelöscht.** Die Zahl der Nachträge auf einer Grundlage
 * steht an jeder Zeile: sie behalten ihre Grundlage, und wer archiviert, soll
 * das vorher sehen.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'bau.schreiben';

export default async function Nachtragsgrundlagen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/nachtragsgrundlagen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(NACHTRAGSGRUNDLAGEN_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const schreiben = darf[RECHT] === true && zugang.sitzung.ansicht !== 'gruppe';

  const suche = await searchParams;
  /* D-599/D-728: Grund und Ergebnis nur als EIGENER Eintrag der Tabelle. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(t.fehler, suche['fehler']) ?? t.fehlerUnbekannt) : null;
  const erfolg = typeof suche['grundlage'] === 'string'
    ? eigenerEintrag(t.erfolg, suche['grundlage']) ?? null : null;

  const katalog = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => leseGrundlagenKatalog(kontext))) as Promise<
      readonly GrundlageKatalogZeile[]>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={!schreiben}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      {fehler !== null && (
        <Hinweis art="warnung" cse="grundlage-abgewiesen" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{t.abgewiesen}</strong>{' '}
          {fehler}
        </Hinweis>
      )}
      {erfolg !== null && (
        <Hinweis art="erfolg" cse="grundlage-gespeichert" rolle="status" className="mb-s5 max-w-prose">
          {erfolg}
        </Hinweis>
      )}

      <Hinweis art="warnung" cse="grundlage-voreinstellung" className="mb-s6 max-w-prose">
        {t.voreinstellung}
      </Hinweis>

      {!schreiben && (
        <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="grundlage-kein-recht">
          {t.keinSchreibrechtVor}{' '}<Recht schluessel={RECHT} sprache={zugang.sprache} />{' '}{t.keinSchreibrechtNach}
        </p>
      )}

      <section data-cse="grundlage-katalog" className="mb-s7">
        {katalog.length === 0 ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.leer}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-s3 p-0">
            {katalog.map((g) => (
              <li key={g.id} data-cse="grundlage" data-schluessel={g.schluessel}
                  data-stand={g.archiviert ? 'archiviert' : g.istPlatzhalter ? 'unbestaetigt' : 'bestaetigt'}
                  className="rounded-lg border border-line bg-surface p-s4">
                <p className="m-0 text-base text-text">
                  <span className="text-text-muted">{g.fundstelle}</span>
                  {' · '}
                  <span className={g.archiviert ? 'line-through' : undefined}>{g.bezeichnung}</span>
                  <span className={g.archiviert || !g.istPlatzhalter
                    ? 'ml-s2 text-sm text-text-muted' : 'ml-s2 text-sm text-warning'}>
                    ({g.archiviert ? t.archiviert : g.istPlatzhalter ? t.unbestaetigt : t.bestaetigt})
                  </span>
                </p>
                <p className="m-0 mt-s1 max-w-prose text-sm text-text-muted">{g.beschreibung}</p>
                <p className="m-0 mt-s1 text-sm text-text-muted">
                  {g.ankuendigungErforderlich && <>{t.ankuendigung}{' · '}</>}
                  {t.nachtraege(g.nachtraege)}
                </p>

                {schreiben && (
                  <div className="mt-s3 flex flex-wrap items-start gap-s3">
                    {!g.archiviert && g.istPlatzhalter && (
                      <form method="post" action="/api/bau/nachtragsgrundlagen">
                        <input type="hidden" name="aktion" value="bestaetigen" />
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="zurueck" value={pfad} />
                        <Button type="submit" variante="secondary" data-cse="grundlage-bestaetigen">
                          {t.bestaetigen}
                        </Button>
                      </form>
                    )}
                    {!g.archiviert && (
                      <form method="post" action="/api/bau/nachtragsgrundlagen">
                        <input type="hidden" name="aktion" value="archivieren" />
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="zurueck" value={pfad} />
                        <Button type="submit" variante="ghost" data-cse="grundlage-archivieren">
                          {t.archivieren}
                        </Button>
                        <p className="m-0 mt-s1 max-w-prose text-xs text-text-subtle">
                          {t.archivierenHinweis(g.nachtraege)}
                        </p>
                      </form>
                    )}
                    {g.archiviert && (
                      <form method="post" action="/api/bau/nachtragsgrundlagen">
                        <input type="hidden" name="aktion" value="wiederaufnehmen" />
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="zurueck" value={pfad} />
                        <Button type="submit" variante="secondary" data-cse="grundlage-wiederaufnehmen">
                          {t.wiederaufnehmen}
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="m-0 text-sm">
        <Link href={`/portal/${mandant}/bau/nachtraege`}
              className="text-text-muted underline-offset-2 hover:text-text hover:underline">
          {t.zuDenNachtraegen}
        </Link>
      </p>
    </PortalRahmen>
  );
}

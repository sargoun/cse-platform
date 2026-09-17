import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { leseKonflikt, type KonfliktBlatt } from '@/server/services/dienstplan/konflikt';
import { ArbzgBlock, KonfliktKopf } from '../Bausteine';

/**
 * `/portal/[mandant]/dienstplan/konflikte/[id]/quittung` — ein Konflikt in
 * voll, samt Quittungsbeleg (TIM-05).
 *
 * **Die Seite hat genau zwei Zustaende und keinen dritten.**
 *
 *  - **Offen und nicht blockiert.** Dann steht hier das Formular mit
 *    Pflichtbegruendung — gegen `POST /api/konflikt`, denselben Weg, den die
 *    Eingangsliste inline benutzt. Ein zweiter, abweichender Schreibweg waere
 *    zwei Wahrheiten darueber, was eine Quittierung ist.
 *  - **Blockiert.** Dann steht statt des Formulars der Satz, dass § 34a GewO
 *    keinen Uebergehen-Knopf kennt. Das Formular fehlt nicht aus Versehen: es
 *    gibt nichts zu entscheiden.
 *
 * Ist er bereits quittiert, zeigt die Seite **die Quittung selbst** — wer,
 * wann (Serveruhr), mit welcher Begruendung. Das ist der Beleg, der im Streit
 * zaehlt, und der Grund, warum diese Seite mehr ist als eine schoenere
 * Kartenansicht.
 *
 * **Drei Rechte, nicht eines.** Das Manifest tort diese Route auf
 * `dienstplan.konflikt_quittieren` — das OEFFNET sie, macht sie aber nicht
 * lesbar: `planungs_konflikt` ist fuer `cse_app` nur mit `dienstplan.lesen`
 * lesbar, der ArbZG-Block nur mit `dienstplan.arbzg_lesen`. Die Schwesterroute
 * `/dienstplan/konflikte` deklariert beide, diese Detailroute nur eines. Eine
 * Sitzung ohne `dienstplan.lesen` bekaeme sonst notFound() ohne Grund, und
 * ohne `dienstplan.arbzg_lesen` bliebe der ArbZG-Kasten still leer. Beides
 * ist hier benannt.
 *
 * **O-166 wird hier nicht beantwortet.** Welche Konflikte blockieren statt
 * nur zu warnen, ist offen (`planungs_konflikt.blockiert`, gespeist aus
 * `app.einstellung('zeit.konflikt_blockiert')`). Diese Seite zeigt den
 * GESPEICHERTEN Wert und leitet nichts daraus ab.
 */
export const dynamic = 'force-dynamic';

export default async function Konfliktquittung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/dienstplan/konflikte/${id}/quittung`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  // Invariante 10: kein Schreibweg ohne genau einen aktiven Mandanten.
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(
    sitzung, 'dienstplan.lesen', 'dienstplan.arbzg_lesen', 'dienstplan.arbzg_uebersteuern',
  );
  /* Ohne `dienstplan.lesen` traefe die Policy null Zeilen — dann ist 404 die
     ehrliche Antwort und nicht ein leeres Blatt (AUT-06). */
  if (darf['dienstplan.lesen'] !== true) notFound();

  const k = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => leseKonflikt(kontext, id)),
  ) as Promise<KonfliktBlatt | null>);
  // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
  if (k === null) notFound();

  const quittiert = k.status === 'quittiert';
  const quittierbar = k.status === 'offen' && !k.blockiert && !k.hinfaellig;

  return (
    <PortalRahmen
      titel="Quittung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Quittung</h1>
        <Link
          href={`/portal/${mandant}/dienstplan/konflikte`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zum Konflikteingang
        </Link>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Quittieren heißt nicht wegräumen. Der Konflikt bleibt stehen und bekommt
        Zeitpunkt, Urheber und Begründung — genau das ist die Spur, die im Streit
        zählt: jemand hat die Warnung gesehen und trotzdem so geplant, und hier
        steht, warum.
      </p>

      {k.hinfaellig && (
        <p
          data-cse="hinfaellig"
          className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
        >
          Dieser Konflikt ist hinfällig geworden — die Einteilung, auf die er
          sich bezog, gibt es so nicht mehr. Er bleibt lesbar (Invariante 8) und
          ist nicht mehr zu quittieren.
        </p>
      )}

      <KonfliktKopf k={k} mandant={mandant} />

      <ArbzgBlock
        verstoss={k.verstoss}
        sichtbar={darf['dienstplan.arbzg_lesen'] === true && k.arbzgSichtbar}
        artIstArbzg={k.art === 'arbzg'}
      />

      <section data-cse="quittungsblock">
        <h2 className="mb-s2 mt-0 text-h3 text-text">
          {quittiert ? 'Die Quittung' : 'Quittieren'}
        </h2>

        {quittiert ? (
          <div
            data-cse="quittung"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                  Quittiert am (Serveruhr)
                </dt>
                <dd className="m-0 mt-s1 text-sm tabular-nums text-text">
                  {k.quittiertAmLokal ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                  Von
                </dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {k.quittiertVon ?? 'Konto nicht einsehbar'}
                </dd>
              </div>
            </dl>
            <p className="m-0 mt-s4 max-w-prose text-sm text-text">
              {k.quittierungBegruendung ?? 'Ohne Begründung — das sollte nicht vorkommen.'}
            </p>
            <p className="m-0 mt-s3 max-w-prose text-sm text-text-muted">
              Der Zeitpunkt kommt aus der Serveruhr und nicht vom Gerät
              (Invariante 5); der Auslöser in der Datenbank setzt ihn und prüft
              dabei dasselbe Recht noch einmal.
            </p>
          </div>
        ) : k.blockiert ? (
          <p
            data-cse="nicht-quittierbar"
            className="max-w-prose rounded-lg border border-danger bg-danger-soft p-s5 text-sm text-danger"
          >
            <strong>Nicht quittierbar.</strong> § 34a GewO kennt keine
            Begründung, die einen fehlenden Sachkundenachweis ersetzt — es gibt
            hier keinen Übergehen-Knopf, und er fehlt nicht aus Versehen. Die
            Einteilung muss geändert werden.
          </p>
        ) : quittierbar ? (
          <form
            action="/api/konflikt"
            method="post"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="konflikt" value={k.id} />
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck" value={pfad} />
            <label className="block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Begründung (mindestens 10 Zeichen)
              </span>
              <textarea
                name="begruendung"
                required
                minLength={10}
                rows={3}
                data-cse="begruendung"
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                placeholder="Warum wird trotzdem so geplant?"
              />
            </label>
            <div className="mt-s4 flex flex-wrap items-center gap-s3">
              <Button type="submit" variante="primary">Quittieren</Button>
              <span className="text-sm text-text-muted">
                Eine leere Quittung ist kein Vorgang, sondern ein Klick.
              </span>
            </div>
          </form>
        ) : (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Dieser Konflikt ist nicht offen ({k.status}) — zu quittieren ist
            nichts mehr.
          </p>
        )}
      </section>

      {k.verstoss !== null && k.verstoss.status === 'offen' && !k.blockiert
        && darf['dienstplan.arbzg_uebersteuern'] === true && (
        <p className="mt-s6 max-w-prose text-sm text-text-muted">
          Der Arbeitszeitbefund dahinter ist ein <strong>eigener</strong> Vorgang:
          die Warnung zu quittieren übersteuert ihn nicht.{' '}
          <Link
            href={`/portal/${mandant}/dienstplan/konflikte/${k.id}/uebersteuern`}
            data-cse="zum-uebersteuern"
            className="text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Zum Übersteuern des ArbZG-Befunds
          </Link>
        </p>
      )}
    </PortalRahmen>
  );
}

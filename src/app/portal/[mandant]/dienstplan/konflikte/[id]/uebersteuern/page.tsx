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
 * `/portal/[mandant]/dienstplan/konflikte/[id]/uebersteuern` — eine
 * ArbZG-WARNUNG bewusst stehen lassen und dafuer geradestehen (TIM-06).
 *
 * **Das ist nicht die Quittung.** Die Quittung betrifft den
 * `planungs_konflikt`, also die Warnung im Eingang der Planung. Hier geht es
 * um den `arbeitszeit_verstoss` dahinter — den Befund, der bei einer Pruefung
 * nach § 3, § 4, § 5 ArbZG vorgelegt wird. Zwei Aufzeichnungen, zwei Rechte,
 * zwei Handlungen; wer die Warnung quittiert, hat den Befund nicht
 * uebersteuert. Die Seite sagt das und verweist auf den anderen Weg.
 *
 * **Drei Rechte, nicht eines.** Das Manifest tort diese Route auf
 * `dienstplan.arbzg_uebersteuern`. Die Policies fragen anderes:
 * `planungs_konflikt` verlangt `dienstplan.lesen`, `arbeitszeit_verstoss`
 * verlangt `dienstplan.arbzg_lesen`. Die Seite braucht alle drei und benennt,
 * welches fehlt — ohne das waere ein leerer Bildschirm die einzige Auskunft.
 *
 * **Die Datenbank ist hier die SCHWAECHERE Linie, und das steht so im
 * Register.** `arbeitszeit_verstoss` gewaehrt `cse_app` kein `UPDATE`; der
 * einzige Schreibweg ist `app.arbzg_befund_quittieren`, und diese
 * Definer-Funktion prueft `dienstplan.arbzg_lesen` — nicht
 * `dienstplan.arbzg_uebersteuern`. Das staerkere Recht setzt die Route selbst
 * durch. Bis eine Migration den Definer nachzieht, darf sich niemand darauf
 * verlassen, dass die Datenbank es tut.
 *
 * **Eine Sperre ist durch KEIN Recht uebersteuerbar.** Ein blockierender
 * Befund wird ausdruecklich abgewiesen und nicht bloss ohne Formular gezeigt:
 * wer die Adresse tippt, steht vor einer Begruendung und nicht vor einem
 * leeren Kasten. Welche Befunde blockieren, ist O-166 und offen.
 */
export const dynamic = 'force-dynamic';

export default async function ArbzgUebersteuern(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/dienstplan/konflikte/${id}/uebersteuern`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  // Invariante 10: kein Schreibweg ohne genau einen aktiven Mandanten.
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const eben = frage['uebersteuert'] === '1';

  const darf = await haeltRechte(
    sitzung, 'dienstplan.lesen', 'dienstplan.arbzg_lesen', 'dienstplan.konflikt_quittieren',
  );
  if (darf['dienstplan.lesen'] !== true) notFound();

  const k = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => leseKonflikt(kontext, id)),
  ) as Promise<KonfliktBlatt | null>);
  if (k === null) notFound();

  const arbzgSichtbar = darf['dienstplan.arbzg_lesen'] === true && k.arbzgSichtbar;
  const befund = k.verstoss;
  const uebersteuert = befund !== null && befund.status === 'quittiert';
  const uebersteuerbar = befund !== null && befund.status === 'offen'
    && !k.blockiert && !k.hinfaellig;

  return (
    <PortalRahmen
      titel="Übersteuern"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Arbeitszeitbefund übersteuern</h1>
        <Link
          href={`/portal/${mandant}/dienstplan/konflikte`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zum Konflikteingang
        </Link>
      </div>

      {eben && (
        <p
          data-cse="uebersteuert-geschrieben"
          className="mb-s5 max-w-prose rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          Der Befund ist übersteuert. Er bleibt stehen und trägt jetzt Urheber,
          Serverzeitpunkt und Begründung — das ist die Spur, die bei einer
          Prüfung vorgelegt wird.
        </p>
      )}

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Übersteuern heißt: eine Arbeitszeitwarnung bewusst stehen lassen und
        dafür geradestehen. Der Befund verschwindet nicht — er bekommt Urheber,
        Zeitpunkt (Serveruhr) und Begründung. Eine Überschreitung, die jemand
        ohne Grund weggeklickt hat, ist bei einer Prüfung nach § 22 ArbZG das
        Gegenteil einer Entlastung.
      </p>

      <KonfliktKopf k={k} mandant={mandant} />

      <ArbzgBlock
        verstoss={befund}
        sichtbar={arbzgSichtbar}
        artIstArbzg={k.art === 'arbzg'}
      />

      <section data-cse="uebersteuerungsblock">
        <h2 className="mb-s2 mt-0 text-h3 text-text">
          {uebersteuert ? 'Die Übersteuerung' : 'Übersteuern'}
        </h2>

        {!arbzgSichtbar ? (
          <p className="max-w-prose rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-warning">
            Ohne das Recht <code className="text-xs">dienstplan.arbzg_lesen</code> ist
            der Befund nicht einsehbar — und was man nicht sehen kann, kann man
            nicht übersteuern.
          </p>
        ) : k.blockiert ? (
          <p
            data-cse="nicht-uebersteuerbar"
            className="max-w-prose rounded-lg border border-danger bg-danger-soft p-s5 text-sm text-danger"
          >
            <strong>Nicht übersteuerbar — durch kein Recht.</strong> Dieser
            Befund blockiert, und eine Sperre ist keine Warnung: sie ist eine
            Einteilung, die so nicht stattfinden darf. Die Einteilung muss
            geändert werden. (Welche Befunde blockieren, ist noch offen —
            <strong> offen (O-166)</strong>; diese Seite liest den gespeicherten
            Wert und leitet nichts daraus ab.)
          </p>
        ) : befund === null ? (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            An diesem Konflikt hängt kein Arbeitszeitbefund — hier ist nichts zu
            übersteuern. Eine Überschneidung oder ein fehlender Nachweis wird
            nicht übersteuert, sondern geändert oder quittiert.
          </p>
        ) : uebersteuert ? (
          <div
            data-cse="uebersteuerung"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                  Übersteuert am (Serveruhr)
                </dt>
                <dd className="m-0 mt-s1 text-sm tabular-nums text-text">
                  {befund.quittiertAmLokal ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                  Von
                </dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {befund.quittiertVon ?? 'Konto nicht einsehbar'}
                </dd>
              </div>
            </dl>
            <p className="m-0 mt-s4 max-w-prose text-sm text-text">
              {befund.quittierungBegruendung ?? 'Ohne Begründung — das sollte nicht vorkommen.'}
            </p>
            <p className="m-0 mt-s3 max-w-prose text-sm text-text-muted">
              Die Spur steht im Prüfprotokoll neben dem Befund
              (<code className="text-xs">arbzg.befund_quittiert</code>), gesetzt
              von der Serveruhr.
            </p>
          </div>
        ) : uebersteuerbar ? (
          <form
            action="/api/konflikt/uebersteuern"
            method="post"
            className="rounded-lg border border-warning bg-surface p-s5"
          >
            <input type="hidden" name="konflikt" value={k.id} />
            <input type="hidden" name="mandant" value={mandant} />
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
                placeholder="Warum wird die Grenze in diesem Fall überschritten?"
              />
            </label>
            <div className="mt-s4 flex flex-wrap items-center gap-s3">
              <Button type="submit" variante="primary">Befund übersteuern</Button>
              <span className="text-sm text-text-muted">
                Der Befund bleibt stehen — er bekommt Ihren Namen dazu.
              </span>
            </div>
          </form>
        ) : (
          <p className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Dieser Befund ist nicht offen ({befund.status}) — zu übersteuern ist
            nichts mehr.
          </p>
        )}
      </section>

      <p className="mt-s6 max-w-prose text-sm text-text-muted">
        <strong>Zwei Vorgänge, nicht einer.</strong> Diese Seite übersteuert den
        ArbZG-Befund. Die Warnung im Konflikteingang bleibt davon unberührt und
        will eigens quittiert werden.
        {darf['dienstplan.konflikt_quittieren'] === true && (
          <>
            {' '}
            <Link
              href={`/portal/${mandant}/dienstplan/konflikte/${k.id}/quittung`}
              data-cse="zur-quittung"
              className="text-text underline-offset-2 hover:text-brand hover:underline"
            >
              Zur Quittung des Konflikts
            </Link>
          </>
        )}
      </p>
    </PortalRahmen>
  );
}

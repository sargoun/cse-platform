import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Recht } from '@/components/ui/Recht';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  kenntnisfrist, leseAnweisung, leseErsteSchichten, leseKenntnisstand,
  type AnweisungZeile, type ErsteSchicht, type KenntnisstandZeile,
} from '@/server/services/security/dienstanweisung';
import { haeltRechte } from '@/app/portal/rechte';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/security/dienstanweisungen/[id]/kenntnisnahmen` — wer
 * welche Fassung wann bestätigt hat (SEC-06, EMP-09, Abnahme 1).
 *
 * **Die Liste zeigt eine Pflicht und daneben eine Tatsache.** Links steht, wer
 * bestätigen muss — eine echte Population aus `da_pflicht` und kein Anti-Join
 * gegen den Dienstplan (§6.9). Rechts steht, welche FASSUNG dieser Mensch
 * bestätigt hat. Nach der Freigabe von Fassung 3 steht dort weiter „Fassung 2,
 * 3. März" — die Zeile wurde nicht angefasst — und daneben, dass das nicht
 * mehr genügt.
 *
 * **Der bestätigte Digest steht in der Zeile.** Er ist die Kopie von
 * `dienstanweisung_version.inhalt_hash` zum Zeitpunkt der Bestätigung; der
 * Beweis steht damit ohne Verbund da: „dieser Mensch hat einen Text mit genau
 * diesem Digest bestätigt".
 *
 * **Keine Gruppenansicht.** `da_kenntnisnahme` trägt bewusst keine
 * `t_gruppe`-Policy (0078 §12): wer in einer anderen Gesellschaft welche
 * Anweisung gelesen hat, ist ein Beschäftigtendatum und keine Kennzahl.
 *
 * **Versäumt ist eine Feststellung, keine Sperre** (V-382, O-241, D-811).
 * Ab Beginn der ersten Schicht auf dem Objekt nach der Veröffentlichung steht
 * eine offene Zeile als versäumt da, vorher als fällig vor dieser Schicht.
 * Den Schichtbezug liest die Seite unter den Rechten des Betrachters; ohne
 * `dienstplan.lesen` sagt sie das, statt „offen" für „versäumt" zu zeigen.
 */
export const dynamic = 'force-dynamic';

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  objekt_einsatz: 'aus Einteilung',
  posten: 'aus Posten',
  manuell: 'von Hand',
};

export default async function Kenntnisnahmen(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/security/dienstanweisungen/${id}/kenntnisnahmen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung, 'dienstplan.lesen');
  const schichtbezug = darf['dienstplan.lesen'] === true;
  const { kopf, zeilen, ersteSchichten } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        kopf: await leseAnweisung(kontext, id),
        zeilen: await leseKenntnisstand(kontext, id),
        ersteSchichten: schichtbezug
          ? await leseErsteSchichten(kontext, id)
          : new Map<string, ErsteSchicht>(),
      }))) as Promise<{
        kopf: AnweisungZeile | null; zeilen: readonly KenntnisstandZeile[];
        ersteSchichten: ReadonlyMap<string, ErsteSchicht>;
      }>);

  if (kopf === null) notFound();

  /* Die Serveruhr entscheidet, ob eine Schicht begonnen hat (Invariante 5). */
  const jetzt = new Date();
  const fristen = new Map(zeilen.map((z) => [
    z.anstellungId,
    kenntnisfrist(z.aktuell, ersteSchichten.get(z.anstellungId)?.beginn ?? null, jetzt),
  ]));
  const versaeumt = [...fristen.values()].filter((f) => f.art === 'versaeumt').length;

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/security/dienstanweisungen/${id}`, text: kopf.titel }}
      titel="Kenntnisnahmen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstanweisungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <h1 className="mb-s2 text-h1 text-text">Kenntnisnahmen</h1>
      <p className="mb-s5 text-sm text-text-muted">
        {kopf.titel}
        {kopf.aktiveVersion !== null && (
          <> · geltende Fassung <span className="cse-zahl">{kopf.aktiveVersion}</span></>
        )}
        {' · '}
        <span className="cse-zahl">{kopf.bestaetigt}</span> von{' '}
        <span className="cse-zahl">{kopf.pflichtig}</span> bestätigt
        {versaeumt > 0 && (
          <span data-cse="versaeumt-zahl">
            {' · '}<span className="cse-zahl">{versaeumt}</span> versäumt
          </span>
        )}
      </p>
      {!schichtbezug && zeilen.length > 0 && (
        <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="ohne-schichtbezug">
          Ob die erste Schicht nach der Veröffentlichung schon begonnen hat und eine
          Kenntnisnahme damit versäumt ist, zeigt diese Seite nur mit dem Recht{' '}
          <Recht schluessel="dienstplan.lesen" />.
        </p>
      )}

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Anweisung besteht noch für niemanden eine Pflicht. Die
          Pflicht entsteht aus der Einteilung auf dem Objekt — solange dort
          niemand eingeteilt ist, gibt es niemanden zu unterweisen.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {zeilen.map((z) => {
            const frist = fristen.get(z.anstellungId);
            const erste = ersteSchichten.get(z.anstellungId);
            return (
            <li
              key={z.anstellungId}
              data-cse="kenntnisnahme"
              data-anstellung={z.anstellungId}
              data-aktuell={z.aktuell ? 'ja' : 'nein'}
              data-frist={frist?.art ?? 'ohne_schicht'}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <span className="text-base text-text">{z.name}</span>
                <StatusPill zustand={z.aktuell
                  ? 'Abgeschlossen' : frist?.art === 'versaeumt' ? 'Überfällig' : 'Offen'} />
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {QUELLE_TEXT[z.quelle] ?? z.quelle}
                {z.bestaetigteVersion === null ? (
                  ' · noch nicht bestätigt'
                ) : (
                  <>
                    {' · Fassung '}
                    <span className="cse-zahl">{z.bestaetigteVersion}</span>
                    {' am '}
                    <span className="cse-zahl">{z.bestaetigtLokal}</span>
                    {z.sprache !== null && ` · gelesen auf ${z.sprache}`}
                  </>
                )}
              </p>
              {/*
                „Veraltet" ist ein VERGLEICH und kein Stempel: die Zeile links
                wurde beim Veröffentlichen von Fassung 3 nicht angefasst.
              */}
              {z.bestaetigteVersion !== null && !z.aktuell && (
                <p className="m-0 mt-s2 text-sm text-warning" data-cse="veraltet">
                  Veraltet — die geltende Fassung ist noch nicht bestätigt.
                </p>
              )}
              {/*
                Versäumt ist eine Feststellung, keine Sperre (V-382, O-241):
                die Einteilung bleibt, die Leitung sieht es hier und an der
                Schicht.
              */}
              {frist?.art === 'versaeumt' && erste !== undefined && (
                <p className="m-0 mt-s2 text-sm text-danger" data-cse="versaeumt">
                  Versäumt — die erste Schicht nach der Veröffentlichung begann am{' '}
                  <span className="cse-zahl">{erste.beginnLokal}</span>. Keine Sperre: die
                  Einteilung bleibt; bitte die Bestätigung nachholen lassen.
                </p>
              )}
              {frist?.art === 'faellig' && erste !== undefined && (
                <p className="m-0 mt-s2 text-sm text-text-muted" data-cse="faellig">
                  Zu bestätigen vor der Schicht am{' '}
                  <span className="cse-zahl">{erste.beginnLokal}</span>.
                </p>
              )}
              {z.bestaetigterHash !== null && (
                <p className="m-0 mt-s2 break-all text-micro text-text-subtle">
                  <span className="cse-zahl" data-cse="bestaetigter-hash">
                    {z.bestaetigterHash}
                  </span>
                </p>
              )}
            </li>
            );
          })}
        </ul>
      )}
    </PortalRahmen>
  );
}

import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { fensterLage, restInWorten } from '@/server/services/freigabe/fenster';
import {
  EINSPRUCH_MINUTEN, FENSTER_OFFENE_FRAGE,
} from '@/server/services/freigabe/fenster.platzhalter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { kennungOder404 } from '../../../../kennung';
import { leseFensterKopf, type FensterKopf } from '../fenster-daten';
import {
  FEHLER_TEXT, RISIKO_LABEL, STATUS_LABEL, STATUS_PILL, VORGANG_LABEL, zeitpunkt,
} from '../../darstellung';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/freigaben/[id]/einspruch` — widersprechen, bevor
 * ausgelöst wird (APR-05, §4.5, O-108).
 *
 * **Was ein Einspruch ist.** Die Entscheidung ist gefallen, die Ausführung
 * noch nicht: eine risikoarme Genehmigung aus dem Stapelweg bekommt ein
 * Fenster, und bis es zugeht kann jemand die Genehmigung widerrufen. Danach
 * läuft die Ausführung an. Der Einspruch kehrt die Entscheidung nicht um —
 * er hält sie an; eine erneute Entscheidung ist eine NEUE Freigabe (§4.5).
 *
 * **Diese Seite zählt NICHT als Prüfung** (APR-08, K-13). Gelesen wird über
 * `leseFensterKopf`, nicht über `oeffneFreigabe` — das schriebe eine
 * `freigabe_ansicht`-Zeile, und auf der misst der Prüfdauer-Bericht. Ein
 * Einspruchsblatt in dieser Messung verfälscht genau den Bericht, der
 * Durchwinken aufdecken soll.
 *
 * **Und sie prüft das Recht der ZEILE, nicht nur ihr eigenes.** Die Route ist
 * auf `freigabe.einspruch_erheben` bewacht; `app.freigabe_einspruch` verlangt
 * zusätzlich das `erforderliches_recht` des Vorgangs (Vorgabe
 * `freigabe.entscheiden`). Wer nur die eine Befugnis hält, sähe sonst einen
 * Knopf, dessen Absage danach als „Fenster abgelaufen" zurückkäme — eine
 * Falschaussage über eine Frist, auf die jemand dann wartet. Offene Frage
 * dazu: O-367.
 *
 * **Warum die Seite heute meist leer ist.** Das Fenster armiert allein
 * `app.freigabe_verzoegern`, und das verlangt `status = 'genehmigt'`,
 * `risiko = 'niedrig'` UND `stapel_faehig`; sein einziger Aufrufer ist die
 * Stapelfreigabe. Im Demobestand gibt es keine offene Zeile, die diese drei
 * Bedingungen erfüllt — es läuft also kein Fenster, und die Seite sagt das,
 * statt eine Frist zu behaupten. Ein laufendes Fenster lässt sich auch nicht
 * sinnvoll in den Seed legen: es wäre dreissig Minuten nach dem Seed vorbei.
 * Geprüft wird der laufende Fall deshalb im Test
 * (`tests/isolation/freigabe-fenster.test.ts`) und nicht im Bestand.
 */
export const dynamic = 'force-dynamic';

/** Fensterfristen in Berliner Ortszeit (Invariante 2, K-11). */
const ZEIT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

export default async function Einspruch(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const tor = await mandantTor(`/portal/${mandant}/freigaben/${id}/einspruch`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/freigaben/[id]` verlangt `freigabe.entscheiden` (Manifest); diese Seite
   * öffnet mit `freigabe.einspruch_erheben` allein. Ein Verweis, der auf 404
   * führt, verrät, was er nicht zeigen darf (AUT-06, D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'freigabe.entscheiden');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const kopf = await leseFensterKopf(kontext, id);
      if (kopf === null) return null;
      /*
       * Die Uhr der DATENBANK, nicht die des Rechners, auf dem gerendert wird
       * (Invariante 5). Dieselbe `now()`, gegen die `app.freigabe_einspruch`
       * das Fenster prüft — sonst zeigte die Seite „noch zwei Minuten", wo
       * die Datenbank schon abweist.
       */
      const [uhr] = await kontext.abfrage<{ jetzt: Date }>(`select now() as jetzt`);
      return { kopf, jetzt: uhr?.jetzt ?? new Date() };
    })) as Promise<{ kopf: FensterKopf; jetzt: Date } | null>);

  if (daten === null) notFound();
  const { kopf: f, jetzt } = daten;
  const lage = fensterLage('einspruch', {
    status: f.status, ausfuehrungStatus: f.ausfuehrungStatus, bis: f.verzoegertBis,
  }, jetzt);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
    + 'text-base text-text';

  return (
    <PortalRahmen
      titel="Einspruch erheben"
      wurzelTitel="Freigaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">Einspruch erheben</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">
            {f.titel ?? 'Ohne Titel'}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-s2">
          <StatusPill zustand={STATUS_PILL[f.status]} />
          {darf['freigabe.entscheiden'] === true ? (
            <Link href={`/portal/${mandant}/freigaben/${id}`}
                  data-cse="einspruch-zur-pruefung"
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
              Zur Prüfung
            </Link>
          ) : null}
        </span>
      </div>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="einspruch-abgewiesen" className="mb-s5 max-w-prose">
          <strong>Kein Einspruch vermerkt.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      <dl data-cse="einspruch-kopf"
          className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Vorgangsart</dt>
        <dd className="text-text">
          {f.vorgangTyp === null ? f.aktion : VORGANG_LABEL[f.vorgangTyp]}
        </dd>
        <dt className="text-text-muted">Stand</dt>
        <dd className="text-text">{STATUS_LABEL[f.status]}</dd>
        <dt className="text-text-muted">Einstufung</dt>
        <dd className="text-text">
          {f.risiko === null ? '—' : RISIKO_LABEL[f.risiko]}
          {f.stapelFaehig ? ' · stapelfähig' : ' · nur einzeln zu prüfen'}
        </dd>
        <dt className="text-text-muted">Genehmigt</dt>
        <dd className="text-text">
          {zeitpunkt(f.freigegebenAm)}
          {f.freigegebenVonName === null ? '' : ` · ${f.freigegebenVonName}`}
        </dd>
        <dt className="text-text-muted">Betrag</dt>
        <dd className="text-text">
          {f.betragCent === null ? 'ohne Betrag' : formatiereGeld(f.betragCent)}
        </dd>
        <dt className="text-text-muted">Frist des Vorgangs</dt>
        <dd className="text-text">{zeitpunkt(f.frist)}</dd>
      </dl>

      {f.zusammenfassung === null ? null : (
        <p className="mb-s6 max-w-prose text-sm text-text-muted" data-cse="einspruch-zusammenfassung">
          {f.zusammenfassung}
        </p>
      )}

      {/* ------------------------------------------------- Das Fenster selbst */}
      {lage.art === 'laeuft' && f.haeltZeilenrecht ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="einspruch-fenster" data-rest={String(lage.restSekunden)}>
          <h2 className="mb-s2 text-h2 text-text">Das Fenster läuft</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Genehmigt, aber noch nicht ausgelöst — bis{' '}
            <strong>{ZEIT.format(lage.bis)}</strong> ({restInWorten(lage.restSekunden)}) kann
            jemand widersprechen. Danach läuft die Ausführung an. Die Fensterlänge von{' '}
            {String(EINSPRUCH_MINUTEN)} Minuten ist ein <strong>Platzhalter</strong>: wie lange
            das Fenster je Vorgangsart laufen soll, hat niemand entschieden (offene Frage{' '}
            {FENSTER_OFFENE_FRAGE}).
          </p>
          <form method="post" action="/api/freigaben/fenster" data-cse="einspruch-formular"
                className="flex flex-col gap-s3">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="freigabe" value={id} />
            <input type="hidden" name="was" value="einspruch" />
            {/* Abgewiesenes kommt HIERHER zurück, nicht auf die Prüfseite. */}
            <input type="hidden" name="zurueck" value="einspruch" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="grund">
              Grund des Einspruchs (Pflicht, mindestens 5 Zeichen)
              <input id="grund" type="text" name="grund" required minLength={5} maxLength={500}
                     className={feld} data-cse="einspruch-grund" />
            </label>
            <p className="text-xs text-text-muted">
              Der Grund steht später allein in der Kette: in einem halben Jahr ist „warum
              wurde das damals gestoppt" eine echte Frage. Der Schnappschuss der
              Entscheidung bleibt unangetastet (APR-07) — angehalten wird die Auslösung.
            </p>
            <div>
              <Button type="submit" variante="danger" data-cse="einspruch-erheben">
                Einspruch erheben
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <Hinweis art="hinweis" cse="einspruch-kein-fenster" className="mb-s6 max-w-prose">
          {lage.art === 'laeuft' ? (
            <>
              <strong>Das Fenster läuft — aber nicht für dieses Konto.</strong>{' '}
              Einspruch verlangt zusätzlich das Recht, das dieser Vorgang selbst fordert
              (<code className="text-xs">
                {f.erforderlichesRecht ?? 'freigabe.entscheiden'}
              </code>). Die eigene Befugnis
              {' '}<Recht schluessel="freigabe.einspruch_erheben" /> genügt dafür
              nicht — ein Knopf, den die Datenbank abweist, hätte gar nicht erst dastehen
              dürfen (offene Frage O-367).
            </>
          ) : lage.art === 'abgelaufen' ? (
            <>
              <strong>Das Fenster ist zu.</strong> Es lief bis{' '}
              {ZEIT.format(lage.bis)}; danach hilft nur noch das Rücknahmefenster
              (APR-06), falls es für diese Handlung läuft. Eine Korrektur ist sonst eine
              NEUE Freigabe (§4.5).
            </>
          ) : lage.art === 'falscher_stand' ? (
            <>
              <strong>Hier ist kein Einspruch möglich.</strong> {lage.grund}
            </>
          ) : (
            <>
              <strong>Für diese Freigabe ist kein Fenster armiert.</strong> Ein
              Einspruchsfenster entsteht allein auf dem Stapelweg und nur für risikoarme,
              stapelfähige Vorgänge (APR-05): bei allem darüber löst ein Mensch aus, nicht
              eine Uhr. Diese Genehmigung ist damit sofort gültig — das ist kein Fehler,
              sondern der Zustand, den jede Genehmigung vor APR-05 hatte. Die Fensterlänge
              selbst ist noch offen ({FENSTER_OFFENE_FRAGE}).
            </>
          )}
        </Hinweis>
      )}

      <p className="max-w-prose text-xs text-text-subtle">
        Diese Seite zählt nicht als Prüfung: sie vermerkt kein „geöffnet" und geht damit
        nicht in die Prüfdauer-Verteilung ein (APR-08). Wer die Freigabe wirklich ansehen
        will, öffnet sie — dort wird gemessen.
      </p>
    </PortalRahmen>
  );
}

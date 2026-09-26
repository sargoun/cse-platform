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
  FENSTER_OFFENE_FRAGE, RUECKNAHME_MINUTEN, RUECKNAHME_OFFENE_FRAGE,
} from '@/server/services/freigabe/fenster.platzhalter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { kennungOder404 } from '../../../../kennung';
import { leseFensterKopf, type FensterKopf } from '../fenster-daten';
import {
  FEHLER_TEXT, STATUS_LABEL, STATUS_PILL, VORGANG_LABEL, ausfuehrungText, zeitpunkt,
} from '../../darstellung';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/freigaben/[id]/rueckgaengig` — die Ausführung
 * zurücknehmen (APR-06, APR-07, §4.5, O-368).
 *
 * **Diese Seite hat zwei Zustände, und der häufigere ist heute der leere —
 * und genau deshalb gibt es sie.** Eine ausgeführte Handlung ohne laufendes
 * Fenster sah vorher aus wie eine, bei der man das Fenster verpasst hat. Sie
 * ist etwas anderes: für diese Handlung ist überhaupt keines armiert. Der Weg
 * steht vollständig — Fenster, Frist, eigenes Recht, Protokoll, Abweisung
 * nach Ablauf —, aber `app.freigabe_umkehrbar` gibt heute für JEDE
 * Vorgangsart `false` zurück.
 *
 * **Warum das so ist und nicht als Lücke gilt.** Genau eine Handlung wird
 * heute überhaupt ausgeführt: `eingangsrechnung_uebernehmen` legt eine
 * Eingangsrechnung an. Für sie gibt es keinen gebauten Rückweg — in Finanzen
 * wird nicht hart gelöscht (Invariante 8), korrigiert wird durch Storno, und
 * eine Stornofunktion für Eingangsrechnungen existiert nicht. Ein Knopf, der
 * nur `ausfuehrung_status` umsetzt und die Rechnung stehen lässt, wäre ein
 * vorgetäuschter Erfolg: jemand drückt ihn und glaubt, es sei zurückgeholt.
 * Wer eine Rückholung baut, trägt ihre Vorgangsart in
 * `app.freigabe_umkehrbar` ein und schreibt den Test dazu. Offene Frage:
 * {@link RUECKNAHME_OFFENE_FRAGE}.
 *
 * **Zurückgenommen wird die HANDLUNG, nicht die Entscheidung.** Die Freigabe
 * bleibt genehmigt, ihr Schnappschuss bleibt, was er war (APR-07). Wer die
 * Entscheidung selbst umkehren will, braucht eine neue Freigabe (§4.5).
 *
 * **Auch hier kein `oeffneFreigabe()`** (APR-08, K-13) — dieselbe Falle wie
 * auf der Einspruchsseite: ein Rücknahmeblatt, das als Prüfvorgang zählt,
 * verfälscht die Prüfdauer-Messung.
 */
export const dynamic = 'force-dynamic';

const ZEIT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

export default async function Rueckgaengig(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const tor = await mandantTor(`/portal/${mandant}/freigaben/${id}/rueckgaengig`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* `/freigaben/[id]` verlangt `freigabe.entscheiden`; diese Seite
     `freigabe.rueckgaengig`. Ohne das Recht führte der Verweis auf 404
     (AUT-06, D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'freigabe.entscheiden');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const kopf = await leseFensterKopf(kontext, id);
      if (kopf === null) return null;
      /* Die Uhr der Datenbank — dieselbe `now()`, gegen die
         `app.freigabe_ruecknahme` das Fenster prüft (Invariante 5). */
      const [uhr] = await kontext.abfrage<{ jetzt: Date }>(`select now() as jetzt`);
      return { kopf, jetzt: uhr?.jetzt ?? new Date() };
    })) as Promise<{ kopf: FensterKopf; jetzt: Date } | null>);

  if (daten === null) notFound();
  const { kopf: f, jetzt } = daten;
  const lage = fensterLage('ruecknahme', {
    status: f.status, ausfuehrungStatus: f.ausfuehrungStatus, bis: f.undoBis,
  }, jetzt);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
    + 'text-base text-text';

  return (
    <PortalRahmen
      titel="Rückgängig machen"
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
          <h1 className="text-h1 text-text">Rückgängig machen</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">
            {f.titel ?? 'Ohne Titel'}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-s2">
          <StatusPill zustand={STATUS_PILL[f.status]} />
          {darf['freigabe.entscheiden'] === true ? (
            <Link href={`/portal/${mandant}/freigaben/${id}`}
                  data-cse="ruecknahme-zur-pruefung"
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
              Zur Prüfung
            </Link>
          ) : null}
        </span>
      </div>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="ruecknahme-abgewiesen" className="mb-s5 max-w-prose">
          <strong>Nicht zurückgenommen.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      <dl data-cse="ruecknahme-kopf"
          className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Vorgangsart</dt>
        <dd className="text-text">
          {f.vorgangTyp === null ? f.aktion : VORGANG_LABEL[f.vorgangTyp]}
        </dd>
        <dt className="text-text-muted">Entscheidung</dt>
        <dd className="text-text">{STATUS_LABEL[f.status]}</dd>
        <dt className="text-text-muted">Ausführung</dt>
        <dd className="text-text" data-cse="ruecknahme-ausfuehrung"
            data-stand={f.ausfuehrungStatus}>
          {ausfuehrungText(f.ausfuehrungStatus, f.aktion)}
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
      </dl>

      {lage.art === 'laeuft' && f.haeltZeilenrecht ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="ruecknahme-fenster" data-rest={String(lage.restSekunden)}>
          <h2 className="mb-s2 text-h2 text-text">Rücknahme möglich</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Ausgeführt — bis <strong>{ZEIT.format(lage.bis)}</strong>{' '}
            ({restInWorten(lage.restSekunden)}) lässt sich das zurücknehmen. Die
            Fensterlänge von {String(RUECKNAHME_MINUTEN)} Minuten ist ein{' '}
            <strong>Platzhalter</strong> (offene Frage {FENSTER_OFFENE_FRAGE}).
            Zurückgenommen wird die
            Ausführung, nicht die Entscheidung: der Schnappschuss bleibt, was er war
            (APR-07).
          </p>
          <form method="post" action="/api/freigaben/fenster" data-cse="ruecknahme-formular"
                className="flex flex-col gap-s3">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="freigabe" value={id} />
            <input type="hidden" name="was" value="ruecknahme" />
            <input type="hidden" name="zurueck" value="ruecknahme" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="grund">
              Grund der Rücknahme (Pflicht, mindestens 5 Zeichen)
              <input id="grund" type="text" name="grund" required minLength={5} maxLength={500}
                     className={feld} data-cse="ruecknahme-grund" />
            </label>
            <div>
              <Button type="submit" variante="danger" data-cse="ruecknahme-ausloesen">
                Rückgängig machen
              </Button>
            </div>
          </form>
        </section>
      ) : lage.art === 'laeuft' ? (
        <Hinweis art="hinweis" cse="ruecknahme-kein-zeilenrecht" className="mb-s6 max-w-prose">
          <strong>Das Fenster läuft — aber nicht für dieses Konto.</strong> Eine Rücknahme
          verlangt zusätzlich das Recht, das dieser Vorgang selbst fordert
          (<code className="text-xs">{f.erforderlichesRecht ?? 'freigabe.entscheiden'}</code>).
          Die eigene Befugnis <Recht schluessel="freigabe.rueckgaengig" /> genügt
          dafür nicht (offene Frage O-367).
        </Hinweis>
      ) : lage.art === 'abgelaufen' ? (
        <Hinweis art="hinweis" cse="ruecknahme-abgelaufen" className="mb-s6 max-w-prose">
          <strong>Das Fenster ist zu.</strong> Es lief bis {ZEIT.format(lage.bis)}. Eine
          Korrektur ist jetzt eine NEUE Freigabe (§4.5) — und sie korrigiert die Sache,
          nicht die Entscheidung von damals.
        </Hinweis>
      ) : lage.art === 'falscher_stand' ? (
        <Hinweis art="hinweis" cse="ruecknahme-falscher-stand" className="mb-s6 max-w-prose">
          <strong>Hier ist nichts zurückzunehmen.</strong> {lage.grund}
        </Hinweis>
      ) : (
        /*
         * **Wo der Knopf stünde, steht der Grund.** Das ist der Zweck dieser
         * Seite: der Unterschied zwischen „Fenster verpasst" und „für diese
         * Handlung ist keines gebaut".
         */
        <Hinweis art="hinweis" cse="ruecknahme-nicht-armiert" className="mb-s6 max-w-prose">
          <strong>Kein Rückgängig für diese Handlung.</strong> Der Weg dafür steht
          vollständig — Fenster, Frist, eigenes Recht, Protokoll, Abweisung nach Ablauf —,
          aber er ist für nichts armiert:{' '}
          <code className="text-xs">app.freigabe_umkehrbar</code> gibt heute für jede
          Vorgangsart „nein" zurück. Zurückzunehmen wäre die HANDLUNG, nicht ihr Stand,
          und dafür gibt es hier keinen gebauten Rückweg: die einzige Handlung, die
          ausgeführt wird, legt eine Eingangsrechnung an, und in Finanzen wird nicht hart
          gelöscht (Invariante 8) — korrigiert wird per Storno, und eine Stornofunktion
          für Eingangsrechnungen existiert nicht. Ein Knopf, der nur den Stand umsetzt und
          die Rechnung stehen lässt, wäre ein vorgetäuschter Erfolg. Eine Korrektur ist
          deshalb eine NEUE Freigabe (§4.5). Offene Frage: {RUECKNAHME_OFFENE_FRAGE}.
        </Hinweis>
      )}

      <p className="max-w-prose text-xs text-text-subtle">
        Diese Seite zählt nicht als Prüfung: sie vermerkt kein „geöffnet" und geht damit
        nicht in die Prüfdauer-Verteilung ein (APR-08).
      </p>
    </PortalRahmen>
  );
}

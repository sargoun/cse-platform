import Link from 'next/link';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  ART_TEXT, liste, type AnfrageZeile,
} from '@/server/services/datenschutz/anfrage';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/datenschutz` — der Posteingang für
 * Betroffenenrechte (LEG-09, Art. 12 Abs. 3 DSGVO).
 *
 * **Diese Seite ist die Hälfte, ohne die das öffentliche Formular schädlich
 * wäre.** Ein Formular, das eine gesetzliche Frist auslöst und keinen internen
 * Empfänger hat, ist eine versäumte Frist mit einem Zeitstempel darauf — und
 * der Zeitstempel ist der Beweis.
 *
 * **Die Frist ist die Sortierung**, nicht der Eingang: was zuerst ablaufen
 * würde, steht oben. Eine Liste nach Eingangsdatum sieht ordentlich aus und
 * lässt die verlängerte Anfrage von vorgestern über der frischen von heute
 * stehen, obwohl die frische früher fällig ist.
 *
 * **Überfällig steht in Rot und mit Zahl.** „Seit 3 Tagen überfällig" ist eine
 * andere Nachricht als „überfällig" — die erste sagt, wie schlimm es ist.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Betroffenenanfragen — Datenschutz' };

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen',
  identitaet_offen: 'Offen',
  in_bearbeitung: 'In Arbeit',
  beantwortet: 'Abgeschlossen',
  abgelehnt: 'Archiviert',
};

const STATUS_WORT: Readonly<Record<string, string>> = {
  neu: 'Neu',
  identitaet_offen: 'Identität offen',
  in_bearbeitung: 'In Bearbeitung',
  beantwortet: 'Beantwortet',
  abgelehnt: 'Abgelehnt',
};

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

export default async function Anfragen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/datenschutz`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  /*
   * `referenz.schreiben` ist das Tor der Barrierenliste (Register §5.25) —
   * gefragt wird genau das Recht, mit dem die Route bewacht ist, damit der
   * Verweis nie auf eine 404 fuehrt (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'datenschutz.auskunft_erstellen', 'referenz.schreiben');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => liste(kontext))
  ) as Promise<readonly AnfrageZeile[]>);

  const offen = zeilen.filter(
    (z) => !['beantwortet', 'abgelehnt'].includes(z.status));
  const ueberfaellig = offen.filter((z) => z.tageBisFrist < 0);

  return (
    <PortalRahmen
      titel="Betroffenenanfragen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datenschutz"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Betroffenenanfragen</h1>
        <p className="m-0 text-sm text-text-muted">
          {`${String(offen.length)} offen von ${String(zeilen.length)}`}
        </p>
      </div>

      {/*
        * **Der Weg für den Brief und den Anruf** (V-031, Art. 12 Abs. 1).
        *
        * Diese Liste hatte genau eine Quelle: das öffentliche Formular. Art. 12
        * Abs. 1 kennt diese Beschränkung nicht — der Antrag geht „schriftlich
        * oder in anderer Form", der mündliche ausdrücklich eingeschlossen. Ein
        * Brief löste damit dieselbe Monatsfrist aus wie das Formular und hatte
        * in der Plattform, die diese Frist überwacht, keinen Platz.
        *
        * Der Knopf steht am Recht dieser Liste (`datenschutz.auskunft_erstellen`,
        * §5.25) — wer den Vorgang führen darf, nimmt den Brief auf, der ihn
        * auslöst.
        */}
      {darf['datenschutz.auskunft_erstellen'] === true && (
        <Link
          href={`/portal/${mandant}/datenschutz/aufnehmen`}
          data-cse="anfrage-aufnehmen"
          className="mb-s5 inline-flex min-h-11 items-center rounded-md bg-brand
                     px-s4 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Anfrage aufnehmen
        </Link>
      )}

      {/*
        * **Der Eingang zu den gemeldeten Barrieren** (V-032, LEG-07, BFSG).
        *
        * Das öffentliche Meldeformular schreibt seit je hinein — und NIEMAND
        * las. Eine Barrieremeldung, die niemand öffnet, ist dasselbe wie kein
        * Meldeweg, nur mit mehr Aufwand: das BFSG verlangt einen erreichbaren
        * Kanal, und erreichbar heisst, dass am anderen Ende jemand sitzt.
        *
        * Sie steht hier, weil beides derselbe Schreibtisch ist: wer
        * Betroffenenanfragen bearbeitet, bearbeitet auch diese Meldungen.
        */}
      {darf['referenz.schreiben'] === true && (
        <nav aria-label="Weiter" className="mb-s5 flex flex-wrap gap-s2">
          <Link
            href={`/portal/${mandant}/datenschutz/barrieren`}
            data-cse="zu-den-barrieren"
            className="inline-flex min-h-11 items-center rounded-md border border-line
                       px-s3 text-sm text-text-muted transition-colors duration-fast
                       hover:border-line-strong hover:text-text"
          >
            Gemeldete Barrieren (BFSG)
          </Link>
        </nav>
      )}

      {ueberfaellig.length > 0 && (
        <Hinweis art="warnung" cse="anfragen-ueberfaellig" className="mb-s5 max-w-prose">
          <strong className="block">
            {`${String(ueberfaellig.length)} Anfrage(n) sind über die Frist.`}
          </strong>
          Art. 12 Abs. 3 DSGVO nennt einen Monat. Eine überschrittene Frist ist ein
          eigener Verstoss — unabhängig davon, wie die Anfrage am Ende beschieden
          wird.
        </Hinweis>
      )}

      <Hinweis art="hinweis" cse="anfragen-erklaerung" className="mb-s5 max-w-prose">
        Diese Anfragen kommen aus dem öffentlichen Formular
        <code className="mx-s1 font-mono">/datenschutz/anfrage</code>. Es fragt
        absichtlich wenig — kein Geburtsdatum, keine Anschrift: Art. 12 Abs. 6
        erlaubt die Identitätsnachfrage nur bei <em>begründeten Zweifeln</em>, also
        hier, im Einzelfall, von Ihnen.
      </Hinweis>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Betroffenenanfrage eingegangen.
        </p>
      ) : (
        <DataTable
          beschriftung="Betroffenenanfragen nach Frist, offene zuerst"
          zeilen={[...zeilen]}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'anliegen',
              kopf: 'Anliegen',
              zelle: (z) => (
                <span>
                  {ART_TEXT[z.art].kurz}
                  <span className="block text-xs text-text-muted">{z.name}</span>
                </span>
              ),
            },
            { schluessel: 'email', kopf: 'Antwort an', zelle: (z) => z.email },
            {
              schluessel: 'eingang',
              kopf: 'Eingegangen',
              zelle: (z) => BERLIN.format(new Date(z.eingegangenAm)),
            },
            {
              schluessel: 'frist',
              kopf: 'Frist',
              zelle: (z) => {
                const erledigt = ['beantwortet', 'abgelehnt'].includes(z.status);
                const wirksam = z.verlaengertBis ?? z.fristAm;
                if (erledigt) {
                  return <span className="text-text-muted">{BERLIN.format(new Date(wirksam))}</span>;
                }
                return (
                  <span className={z.tageBisFrist < 0 ? 'text-danger' : 'text-text'}>
                    {BERLIN.format(new Date(wirksam))}
                    <span className="block text-xs">
                      {z.tageBisFrist < 0
                        ? `seit ${String(-z.tageBisFrist)} Tag(en) überfällig`
                        : `noch ${String(z.tageBisFrist)} Tag(e)`}
                    </span>
                    {z.verlaengertBis === null ? null : (
                      <span className="block text-xs text-text-muted">verlängert</span>
                    )}
                  </span>
                );
              },
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span>
                  <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />
                  <span className="block text-xs text-text-muted">
                    {STATUS_WORT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'handlung',
              kopf: '',
              zelle: (z) => (
                darf['datenschutz.auskunft_erstellen'] !== true
                || ['beantwortet', 'abgelehnt'].includes(z.status)
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <details data-cse="anfrage-entscheiden">
                      <summary className="cursor-pointer text-sm text-brand">
                        Entscheiden
                      </summary>
                      <form method="post" action="/api/datenschutz/bearbeiten"
                            className="mt-s3 flex flex-col gap-s2">
                        <input type="hidden" name="id" value={z.id} />
                        <input type="hidden" name="zurueck"
                               value={`/portal/${mandant}/datenschutz`} />
                        <textarea name="entscheidung" rows={3} required
                                  placeholder="Was wurde entschieden, und warum?"
                                  className="rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text" />
                        <div className="flex flex-wrap gap-s2">
                          <Button type="submit" name="handlung" value="beantwortet"
                                  variante="primary">
                            Beantwortet
                          </Button>
                          <Button type="submit" name="handlung" value="abgelehnt"
                                  variante="secondary">
                            Abgelehnt
                          </Button>
                          <Button type="submit" name="handlung" value="verlaengern"
                                  variante="ghost">
                            Frist verlängern
                          </Button>
                        </div>
                      </form>
                    </details>
                  )
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}

import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  HINWEIS_TEXT, ladeRichtlinien, WIRKUNG_TEXT, type RichtlinienZeile, type Wirkung,
} from '@/server/services/agent/richtlinie';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';

/**
 * `/portal/[mandant]/agenten/richtlinien` — was ohne einen Menschen hinaus
 * darf (AGT-03, APR-01, Invariante 7).
 *
 * **Dieselbe Regel, ein anderer Eingang.**
 * `/portal/[mandant]/einstellungen/agent-richtlinien` zeigt sie als
 * Einstellung der Gesellschaft; hier steht sie im Agentenzentrum, wo jemand
 * über das Einschalten eines Agenten nachdenkt — und von hier führt zu jeder
 * hinterlegten Zeile eine Bearbeitungsseite. Gelesen wird durch denselben
 * Dienst und geschrieben durch denselben Handler; zwei Schreibwege wären zwei
 * Stellen, an denen jemand das `authorize` vergisst.
 *
 * **Alle acht Aktionen stehen hier, auch die ohne Zeile.** Die acht
 * `AKTIONEN` aus `server/agent/policy.ts` sind der vollständige
 * Konfigurationsraum. Eine Aktion ohne Richtlinie ist nicht „egal", sondern
 * fail-closed: `gate()` verlangt dann eine Freigabe, weil eine fehlende Regel
 * keine Erlaubnis ist.
 *
 * **Drei Aktionen sind im CODE gesperrt.** Angebot (§ 145 BGB), Nachtrag
 * (§ 2 Abs. 6 VOB/B) und Behinderungsanzeige (§ 6 Abs. 1 VOB/B) gehen nie
 * automatisch hinaus, unabhängig von jeder Zeile hier. Sie stehen in der
 * Liste mit diesem Satz und ohne Anlegeformular — eine gespeicherte Erlaubnis
 * wäre wirkungslos und sähe wie eine aus.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<Wirkung, PillZustand>> = {
  nicht_hinterlegt: 'Offen',
  abgeschaltet: 'Inaktiv',
  freigabe: 'In Prüfung',
  im_code_gesperrt: 'Wartet',
  automatisch: 'Aktiv',
  automatisch_bis_limit: 'Aktiv',
};

export default async function AgentenRichtlinien(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  /*
   * **Aufgeloest, nicht ausgegeben.** Hier stand der Inhalt von `?hinweis=`
   * unveraendert im Hinweiskasten — ein Link konnte damit jeden beliebigen
   * Satz in der Oberflaeche erscheinen lassen. Die Adresse traegt jetzt nur
   * den Namen; den Satz kennt `HINWEIS_TEXT`, und ein unbekannter Name zeigt
   * gar nichts.
   */
  const hinweis = typeof suche['hinweis'] === 'string'
    ? HINWEIS_TEXT[suche['hinweis']] ?? null : null;

  const tor = await mandantTor(`/portal/${mandant}/agenten/richtlinien`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/portal/[mandant]/agenten` öffnet mit `agent.lesen` (Manifest); diese
   * Seite mit `agent.richtlinie_verwalten`. Der Verweis zurück ins
   * Agentenzentrum führte ohne das Recht auf 404 und verriete damit, was er
   * nicht zeigen darf (AUT-06).
   */
  const darf = await haeltRechte(zugang.sitzung, 'agent.lesen');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeRichtlinien(kontext)),
  ) as Promise<readonly RichtlinienZeile[]>);

  const automatisch = zeilen.filter(
    (z) => z.wirkung === 'automatisch' || z.wirkung === 'automatisch_bis_limit').length;
  const ohneZeile = zeilen.filter((z) => z.id === null && !z.imCodeGesperrt);

  return (
    <PortalRahmen
      titel="Was hinausgehen darf"
      wurzelTitel="Agenten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Was hinausgehen darf</h1>
        {darf['agent.lesen'] === true ? (
          <Link href={`/portal/${mandant}/agenten`}
                data-cse="richtlinien-zu-agenten"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zum Agentenzentrum
          </Link>
        ) : null}
      </div>

      {hinweis === null ? null : (
        <Hinweis art="hinweis" cse="richtlinien-hinweis" className="mb-s5 max-w-prose">
          {hinweis}
        </Hinweis>
      )}

      <p data-cse="richtlinien-zaehler" data-automatisch={String(automatisch)}
         className="mb-s5 max-w-prose text-sm text-text-muted">
        {automatisch === 0
          ? 'Keine Aktion geht heute ohne einen Menschen hinaus. '
          : `${String(automatisch)} von ${String(zeilen.length)} Aktionen gehen ohne einen `
            + 'Menschen hinaus. '}
        Eine Richtlinie entscheidet nur dort, wo keine menschliche Freigabe nötig ist —
        eine gültige Freigabe schlägt jede Automatik. Und § 7 UWG hebt sie unter keinen
        Umständen auf: ein Kontakt ohne aufgezeichnete Rechtsgrundlage wird abgewiesen,
        ungeachtet jeder Zeile hier (LEG-08).
      </p>

      <div data-cse="richtlinien" className="mb-s7">
        <DataTable
          beschriftung="Aktionen des Ausgangs-Gates mit Wirkung, Betragsgrenze und Begründung"
          zeilen={zeilen}
          schluessel={(z) => z.aktion}
          spalten={[
            {
              schluessel: 'aktion',
              kopf: 'Aktion',
              zelle: (z) => (
                <span data-cse="richtlinie-aktion" data-schluessel={z.aktion}>
                  {z.id === null ? (
                    <span className="text-text">{z.text}</span>
                  ) : (
                    <Link href={`/portal/${mandant}/agenten/richtlinien/${z.id}`}
                          data-cse="richtlinie-bearbeiten"
                          className="text-text underline-offset-2 hover:text-brand hover:underline">
                      {z.text}
                    </Link>
                  )}
                  <code className="ml-s2 text-xs text-text-subtle">{z.aktion}</code>
                </span>
              ),
            },
            {
              schluessel: 'wirkung',
              kopf: 'Wirkung',
              zelle: (z) => (
                <span className="flex flex-wrap items-center gap-s2" data-wirkung={z.wirkung}>
                  <StatusPill zustand={PILLE[z.wirkung]} />
                  <span className="text-xs text-text-muted">{WIRKUNG_TEXT[z.wirkung]}</span>
                </span>
              ),
            },
            {
              schluessel: 'grenze',
              kopf: 'Betragsgrenze',
              numerisch: true,
              zelle: (z) => (z.maxBetragCent === null
                ? <span className="text-text-muted">kein Limit</span>
                : formatiereGeld(z.maxBetragCent)),
            },
            /*
             * BEIDE Texte, nicht der eine STATT des anderen. `grund` ist der
             * feste Gesetzestext der drei im Code gesperrten Aktionen;
             * `begruendung` ist das, was ein Mensch gespeichert hat. Hier
             * stand `z.grund ?? z.begruendung`, und damit verdeckte der
             * Gesetzestext bei genau diesen drei Aktionen die menschliche
             * Begruendung dauerhaft — dort also, wo sie am ehesten erklaert,
             * warum die Zeile ueberhaupt angelegt wurde. Die Schwesterseite
             * `einstellungen/agent-richtlinien` hat denselben Defekt schon
             * behoben; hier lief die Abschrift davon weg.
             */
            {
              schluessel: 'begruendung',
              kopf: 'Begründung',
              zelle: (z) => (
                <span className="block text-sm text-text-muted">
                  {z.begruendung ?? (z.grund === null ? '—' : '')}
                  {z.grund === null ? null : (
                    <span className="mt-s1 block text-xs text-text-subtle">
                      Im Code gesperrt: {z.grund}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'geaendert',
              kopf: 'Zuletzt gesetzt',
              zelle: (z) => (z.geaendertAm === null
                ? '—'
                : `${z.geaendertAm}${z.geaendertVon === null ? '' : ` · ${z.geaendertVon}`}`),
            },
          ]}
        />
      </div>

      {/*
        * **Anlegen und dann bearbeiten, nicht beides in einem Formular.**
        * Eine neue Zeile entsteht fail-closed: `auto_erlaubt` aus, aktiv, ohne
        * Limit. Alles weitere steht auf ihrer eigenen Seite — wer Automatik
        * einschaltet, soll dabei die Begründung schulden und nicht im
        * Vorbeigehen ein Häkchen setzen.
        */}
      {ohneZeile.length === 0 ? (
        <Hinweis art="hinweis" cse="richtlinien-vollstaendig" className="max-w-prose">
          <strong>Jede wählbare Aktion trägt eine Richtlinie.</strong> Die drei im Code
          gesperrten brauchen keine: sie gehen nie automatisch hinaus.
        </Hinweis>
      ) : (
        <section aria-labelledby="anlegen-titel"
                 className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 id="anlegen-titel" className="text-h2 text-text">Richtlinie anlegen</h2>
          <p className="mt-s2 text-sm text-text-muted">
            {ohneZeile.length === 1
              ? 'Für eine Aktion ist keine Zeile hinterlegt.'
              : `Für ${String(ohneZeile.length)} Aktionen ist keine Zeile hinterlegt.`}
            {' '}Das ist keine Lücke, sondern die Vorgabe — ohne Zeile verlangt das Gate
            eine Freigabe. Eine neue Zeile entsteht genauso: aktiv, aber ohne Automatik.
            Einstellen lässt sie sich danach auf ihrer eigenen Seite.
          </p>
          <form method="post" data-cse="richtlinie-anlegen"
                action={`/api/einstellungen/agent-richtlinien?mandant=${mandant}`}
                className="mt-s4 flex flex-col gap-s3">
            <input type="hidden" name="ziel" value="agenten" />
            <input type="hidden" name="istAktiv" value="ja" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="aktion">
              Aktion
              <select id="aktion" name="aktion" required
                      className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text">
                {ohneZeile.map((z) => (
                  <option key={z.aktion} value={z.aktion}>{z.text}</option>
                ))}
              </select>
            </label>
            <div>
              <Button type="submit" variante="secondary" data-cse="richtlinie-anlegen-knopf">
                Anlegen — ohne Automatik
              </Button>
            </div>
          </form>
        </section>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-subtle">
        Jede Änderung steht im Protokoll — die Tabelle trägt seit 0203 ihren
        Audit-Trigger. Gelöscht wird eine Richtlinie nicht: abgeschaltet wird über
        „aktiv", damit belegbar bleibt, was einmal galt (Invariante 8).
      </p>
    </PortalRahmen>
  );
}

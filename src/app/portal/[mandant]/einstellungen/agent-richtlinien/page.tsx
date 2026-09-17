import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  ladeRichtlinien, WIRKUNG_TEXT, type RichtlinienZeile, type Wirkung,
} from '@/server/services/agent/richtlinie';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/agent-richtlinien` — das Ausgangs-Gate als
 * Bildschirm (AGT-03, APR-01, Invariante 7).
 *
 * **Alle acht Aktionen stehen hier, auch die ohne Zeile.** Die acht
 * `AKTIONEN` aus `server/agent/policy.ts` sind der vollstaendige
 * Konfigurationsraum. Eine Aktion ohne Richtlinie ist nicht „egal", sondern
 * fail-closed: `gate()` verlangt eine Freigabe, weil eine fehlende Regel
 * keine Erlaubnis ist. Genau das steht in der Zeile — nicht eine leere
 * Zelle, die wie eine offene Frage aussieht.
 *
 * **Drei Aktionen sind im CODE gesperrt und nicht hier.** Angebot,
 * Nachtrag und Behinderungsanzeige gehen nie automatisch hinaus, unabhaengig
 * von jeder Zahl in dieser Tabelle — § 145 BGB, § 2 Abs. 6 und § 6 Abs. 1
 * VOB/B. Die Seite sagt es an der Zeile, und der Dienst weist eine
 * gespeicherte Erlaubnis ab: sonst stuende hier „automatisch", wo `gate()`
 * abweist.
 *
 * **Das Recht.** Die Route ist mit `agent.richtlinie_verwalten` bewacht;
 * `0203` zieht die RLS-Policies der Tabelle auf dasselbe Recht (sie
 * verlangten `versand.lesen`/`versand.freigeben`, und eine Sitzung mit dem
 * Recht der Seite bekam null Zeilen — Tor offen, Datenbank leer).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<Wirkung, PillZustand>> = {
  nicht_hinterlegt: 'Offen',
  abgeschaltet: 'Inaktiv',
  freigabe: 'In Prüfung',
  /* „Wartet" und nicht „Abgelehnt": es ist kein Fehler, es wartet — immer. */
  im_code_gesperrt: 'Wartet',
  automatisch: 'Aktiv',
  automatisch_bis_limit: 'Aktiv',
};

export default async function AgentRichtlinien(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const tor = await mandantTor(
    `/portal/${mandant}/einstellungen/agent-richtlinien`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeRichtlinien(kontext)),
  ) as Promise<readonly RichtlinienZeile[]>);

  const ohneZeile = zeilen.filter((z) => z.wirkung === 'nicht_hinterlegt').length;
  const automatisch = zeilen.filter(
    (z) => z.wirkung === 'automatisch' || z.wirkung === 'automatisch_bis_limit').length;
  const waehlbar = zeilen.filter((z) => !z.imCodeGesperrt);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Agent-Richtlinien"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Agent-Richtlinien</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="richtlinie-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <p data-cse="richtlinien-zaehler"
         data-ohne={String(ohneZeile)} data-automatisch={String(automatisch)}
         className="mb-s5 max-w-[72ch] rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
        {automatisch === 0
          ? 'Keine Aktion geht heute ohne einen Menschen hinaus. '
          : `${String(automatisch)} von ${String(zeilen.length)} Aktionen gehen ohne `
            + 'einen Menschen hinaus. '}
        {ohneZeile > 0
          ? `Für ${String(ohneZeile)} Aktion(en) ist keine Richtlinie hinterlegt — das `
            + 'ist keine Lücke, sondern die Vorgabe: eine fehlende Regel ist keine '
            + 'Erlaubnis, und das Gate verlangt dann eine Freigabe.'
          : 'Jede Aktion trägt eine Richtlinie.'}
      </p>

      <Hinweis art="hinweis" cse="richtlinien-leg08" className="mb-s7 max-w-[72ch]">
        <strong>§ 7 UWG steht vor jeder Richtlinie.</strong> Ein Kontakt ohne
        aufgezeichnete Rechtsgrundlage wird abgewiesen, ungeachtet jeder Freigabe und
        jeder Zeile hier — das ist ein hartes Tor (LEG-08). Und der Hash bindet die
        Freigabe an den Inhalt: wer nach der Freigabe den Text ändert, hat keine
        Freigabe mehr für das, was er sendet.
      </Hinweis>

      <section aria-labelledby="richtlinien-titel" className="mb-s7">
        <h2 id="richtlinien-titel" className="mb-s3 text-h2 text-text">
          Die acht Aktionen des Gates
        </h2>
        <div data-cse="richtlinien">
          <DataTable
            beschriftung="Aktionen des Ausgangs-Gates mit Wirkung, Betragsgrenze und Begründung"
            zeilen={zeilen}
            schluessel={(z) => z.aktion}
            spalten={[
              { schluessel: 'aktion', kopf: 'Aktion',
                zelle: (z) => (
                  <span data-cse="richtlinie-aktion" data-schluessel={z.aktion}>
                    <span className="text-text">{z.text}</span>
                    <code className="ml-s2 text-xs text-text-subtle">{z.aktion}</code>
                  </span>
                ) },
              { schluessel: 'wirkung', kopf: 'Wirkung',
                zelle: (z) => (
                  <span className="flex items-center gap-s2" data-wirkung={z.wirkung}>
                    <StatusPill zustand={PILLE[z.wirkung]} />
                    <span className="text-xs text-text-muted">{WIRKUNG_TEXT[z.wirkung]}</span>
                  </span>
                ) },
              { schluessel: 'grenze', kopf: 'Betragsgrenze', numerisch: true,
                zelle: (z) => (z.maxBetragCent === null
                  ? <span className="text-text-muted">kein Limit</span>
                  : formatiereGeld(z.maxBetragCent)) },
              { schluessel: 'begruendung', kopf: 'Begründung',
                zelle: (z) => (
                  <span className="text-sm text-text-muted">
                    {z.grund ?? z.begruendung ?? '—'}
                  </span>
                ) },
              { schluessel: 'geaendert', kopf: 'Zuletzt gesetzt',
                zelle: (z) => (z.geaendertAm === null
                  ? '—'
                  : `${z.geaendertAm}${z.geaendertVon === null ? '' : ` · ${z.geaendertVon}`}`) },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="setzen-titel"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 id="setzen-titel" className="text-h2 text-text">Richtlinie setzen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Angebot, Nachtrag und Behinderungsanzeige stehen nicht zur Wahl: sie gehen
          nie automatisch hinaus, und die Sperre steht im Code (§ 145 BGB,
          § 2 Abs. 6 und § 6 Abs. 1 VOB/B). Eine Erlaubnis hier wäre wirkungslos und
          sähe wie eine aus.
        </p>
        <form method="post" action={`/api/einstellungen/agent-richtlinien?mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="aktion">Aktion</label>
          <select id="aktion" name="aktion" required className={feld}>
            {waehlbar.map((z) => (
              <option key={z.aktion} value={z.aktion}>{z.text}</option>
            ))}
          </select>

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="autoErlaubt" value="ja" />
            Darf ohne menschliche Freigabe hinausgehen
          </label>

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="istAktiv" value="ja" defaultChecked />
            Richtlinie ist aktiv
          </label>
          <p className="text-xs text-text-muted">
            Eine abgeschaltete Richtlinie wirkt wie keine: das Gate verlangt eine
            Freigabe. Sie bleibt lesbar, damit belegbar ist, was einmal galt.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="maxBetrag">
            Betragsgrenze in Euro (leer = kein Limit)
          </label>
          <input id="maxBetrag" name="maxBetrag" type="text" inputMode="decimal"
                 className={feld} placeholder="0,00" />

          <label className="mt-s4 block text-sm text-text" htmlFor="begruendung">
            Begründung
          </label>
          <textarea id="begruendung" name="begruendung" rows={3} className={feld}
                    placeholder="Warum diese Aktion so konfiguriert ist." />

          <button type="submit"
                  className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
            Richtlinie setzen
          </button>
        </form>
      </section>

      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Jede Änderung steht im Protokoll (Einstellungen › Protokoll). Was ein Agent
        vorgelegt hat und was ein Mensch entschieden hat, steht im Freigabe-Posteingang
        — nicht hier: diese Seite setzt die Regel, sie gibt nichts frei.
      </p>
    </PortalRahmen>
  );
}

import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  HINWEIS_TEXT, ladeRichtlinien, WIRKUNG_TEXT, type RichtlinienZeile, type Wirkung,
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
  /*
   * **Ein CODE aus geschlossenem Satz, kein Text aus der Adresse.** Hier ging
   * der Inhalt von `?hinweis=` unveraendert auf den Bildschirm; damit liess
   * sich ueber einen Link jeder beliebige Satz in der Oberflaeche erscheinen
   * lassen. Der Handler schickt jetzt nur noch den Namen.
   */
  const { hinweis } = await searchParams;
  const hinweisText = typeof hinweis === 'string'
    ? HINWEIS_TEXT[hinweis] ?? null : null;
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
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Agent-Richtlinien</h1>

      {hinweisText === null ? null : (
        <p data-cse="richtlinie-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweisText}
        </p>
      )}

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
              /*
               * BEIDE Texte, nicht der eine statt des anderen. `grund` ist der
               * feste Gesetzestext der drei im Code gesperrten Aktionen;
               * `begruendung` ist das, was ein Mensch gespeichert hat. Stand
               * hier `z.grund ?? z.begruendung`, verdeckte der Gesetzestext die
               * menschliche Begruendung dauerhaft — und zwar genau dort, wo sie
               * am ehesten erklaert, warum jemand die Zeile angelegt hat.
               */
              { schluessel: 'begruendung', kopf: 'Begründung',
                zelle: (z) => (
                  <span className="block text-sm text-text-muted">
                    {z.begruendung ?? (z.grund === null ? '—' : '')}
                    {z.grund === null ? null : (
                      <span className="mt-s1 block text-xs text-text-subtle">
                        Im Code gesperrt: {z.grund}
                      </span>
                    )}
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
          Angebot, Nachtrag und Behinderungsanzeige gehen nie automatisch hinaus; die
          Sperre steht im Code (§ 145 BGB, § 2 Abs. 6 und § 6 Abs. 1 VOB/B) und nicht
          in dieser Tabelle. Wählbar sind sie trotzdem — für sie lassen sich
          Begründung, Betragsgrenze und „aktiv" setzen, nur das Häkchen „darf ohne
          menschliche Freigabe hinausgehen" nicht: es wird abgewiesen, mit genau
          diesem Satz. Eine Erlaubnis, die stillschweigend wirkungslos bliebe, sähe
          wie eine aus.
        </p>
        <form method="post" action={`/api/einstellungen/agent-richtlinien?mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="aktion">Aktion</label>
          <select id="aktion" name="aktion" required className={feld}>
            {zeilen.map((z) => (
              <option key={z.aktion} value={z.aktion}>
                {z.imCodeGesperrt ? `${z.text} — nie automatisch` : z.text}
              </option>
            ))}
          </select>

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="autoErlaubt" value="ja" />
            Darf ohne menschliche Freigabe hinausgehen
          </label>
          <p className="text-xs text-text-muted">
            Für Angebot, Nachtrag und Behinderungsanzeige wird dieses Häkchen
            abgewiesen — dort ist die Sperre im Code, und eine gespeicherte Erlaubnis
            wäre eine Einstellung, die nichts einstellt.
          </p>

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
            Begründung (Pflicht, sobald das Häkchen oben gesetzt ist)
          </label>
          <textarea id="begruendung" name="begruendung" rows={3} minLength={5}
                    className={feld}
                    placeholder="Warum diese Aktion so konfiguriert ist." />
          <p className="text-xs text-text-muted">
            Leer gelassen bleibt die vorhandene Begründung stehen — sie wird von
            diesem Formular nicht geleert. Wer sie ersetzen will, schreibt eine
            neue; was einmal galt, steht im Protokoll (Invariante 8).
          </p>

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

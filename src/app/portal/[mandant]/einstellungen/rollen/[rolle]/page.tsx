import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import { zelleBindbar } from '@/server/services/system/rollenrecht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/einstellungen/rollen/[rolle]` — die Matrix einer Rolle
 * in dieser Gesellschaft (AUT-03): jedes Recht des Katalogs, ob es gilt, und
 * ob das die Vorgabe oder eine Abweichung dieses Bereichs ist.
 *
 * **Und sie ist bedienbar** (V-023). Die Seitenkarte nennt sie wörtlich
 * „editable per mandant", `0008` baut alles dafür — `mandant_id` an der
 * Bindungszeile, `gewaehrt` als BOOLEAN statt blosser Existenz, die
 * Auflösung „mandantenspezifisch vor Plattformvorgabe", drei Policies und
 * das `aal2`-Gate — und **keine Oberfläche erzeugte je eine Abweichung.**
 *
 * **Die ganze Matrix in EINEM Formular**, nicht ein Formular je Zeile: eine
 * Rechtematrix wird als Ganzes gelesen und als Ganzes entschieden.
 * „`finanzen.lesen` entziehen, `finanzen.exportieren` aber lassen" ist EINE
 * Überlegung, und zwei Anfragen daraus zu machen hiesse, dass zwischen ihnen
 * ein Zustand steht, den niemand gewollt hat.
 *
 * **Ein Auswahlfeld steht nur dort, wo die Matrix die Zelle kennt** (`✔` oder
 * `○` in 03-AUTH §12). Ein Feld, das etwas anbietet und danach „geht nicht"
 * sagt, ist schlechter als eines, das gar nicht erst da ist — die Regel dazu
 * steht im Dienst (`zelleBindbar`), damit Seite und Route dieselbe Antwort
 * geben.
 *
 * **Zurück zur Plattformvorgabe gibt es nicht**, und das steht auf der Seite:
 * `0008` erteilt `cse_app` kein `delete` auf `rolle_berechtigung`. Eine
 * Entscheidung dieser Gesellschaft über ihre eigene Rechtematrix soll nicht
 * spurlos verschwinden.
 */
export const dynamic = 'force-dynamic';

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  nichts_gewaehlt: 'Es wurde keine Zelle geändert — jedes Auswahlfeld stand auf '
    + '„unverändert".',
  zu_viele: 'Zu viele Zellen auf einmal.',
  unbekannte_rolle: 'Diese Rolle gibt es nicht, oder sie gehört einer anderen '
    + 'Gesellschaft.',
  unbekanntes_recht: 'Ein Rechteschlüssel steht nicht im Katalog. Ein Tippfehler ist '
    + 'eine dauerhafte, stille Verweigerung (K-19) — deshalb wird er hier abgewiesen '
    + 'und nicht geschrieben.',
  rolle_nicht_editierbar: 'Die Rechte dieser Rolle ändert keine einzelne Gesellschaft. '
    + 'Die Plattformverwaltung und die Dienstprinzipale gehören der Plattform; eine '
    + 'Rolle, die es nur hier gibt, steht in keiner Spalte der Matrix (offene Frage '
    + 'O-904).',
  nur_global: 'Dieses Recht gilt nur über die globale Rolle. Eine Abweichung je '
    + 'Gesellschaft wäre eine Zeile, die nichts bewirkt — und eine Anzeige, die das '
    + 'Gegenteil behauptet.',
  nicht_in_der_matrix: 'Die Matrix in 03-AUTH §12 führt diese Zelle weder als gebunden '
    + 'noch als bindbar. Sie wird dort entschieden, nicht hier.',
  selbstaussperrung: 'Mit dieser Änderung hätte diese Sitzung selbst kein Recht mehr, '
    + 'Rollen zu verwalten — die Tür wäre von innen zu. Es wurde NICHTS gespeichert. '
    + 'Ein anderes Konto mit dem Recht kann es setzen.',
  nicht_selbst_gehalten: 'Eines der Rechte lässt sich nicht vergeben: diese Sitzung '
    + 'hält es selbst nicht (SEC-A3). Wer Rollen verwaltet, gibt damit nicht mehr '
    + 'weiter, als er hat — sonst wäre die Rechteverwaltung eine Hintertür in jedes '
    + 'andere Recht. ENTZIEHEN geht auch ohne das Recht: ein Entzug gibt niemandem '
    + 'etwas.',
  abgewiesen: 'Die Änderung wurde abgewiesen.',
};

const SCHLUESSEL = /^[a-z][a-z0-9_]{1,63}$/u;
const RISIKO: Readonly<Record<string, string>> = { niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch' };

interface Kopf {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly portal: string;
  readonly erfordert_2fa: boolean;
}

interface Recht {
  readonly schluessel: string;
  readonly modul: string;
  readonly bezeichnung: string;
  readonly aktion: string;
  readonly risiko: string;
  readonly erfordert_2fa: boolean;
  readonly nur_global: boolean;
  /** `null` = nicht vergeben; sonst ob gewaehrt. */
  readonly gewaehrt: boolean | null;
  readonly abweichung: boolean;
}

export default async function Rollenblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; rolle: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, rolle } = await params;
  if (!SCHLUESSEL.test(rolle)) notFound();
  /*
   * `?eigene=1` waehlt die Rolle DIESER Gesellschaft, sonst die plattformweite.
   * Beide duerfen denselben Schluessel tragen; ohne die Wahl war die
   * plattformweite unerreichbar, sobald eine eigene daneben stand.
   */
  const suche = await searchParams;
  const eigene = suche['eigene'] === '1';
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gesetzt = typeof suche['gesetzt'] === 'string' ? suche['gesetzt'] : null;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/rollen/${rolle}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  /*
   * **Ansehen und Verstellen sind zwei Rechte.** Die Seite öffnet mit
   * `system.rolle_lesen` (bis `leitung` bindbar); das Formular erscheint nur
   * mit `system.rolle_verwalten` (bis `admin`). Und der zweite Faktor gehört
   * der SITZUNG, nicht dem Konto: ohne ihn weist die restriktive Policy
   * `p_rb_aal2` jeden Schreibversuch ab, und die Seite sagt das vorher statt
   * eine Meldung aus der Tiefe abzuwarten (AUT-02, K-15).
   */
  const darf = await haeltRechte(zugang.sitzung, 'system.rolle_verwalten');
  const zweiterFaktor = zugang.sitzung.aal === 'aal2';
  const darfSetzen = darf['system.rolle_verwalten'] === true && zweiterFaktor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      /*
       * ERST die eine Rollenzeile, DANN ihre Rechte — ueber `r.id`. Der Join
       * ueber den Schluessel traf sonst zwei Zeilen (plattformweit und
       * eigene) und verdoppelte jede Matrixzeile.
       */
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.schluessel, r.bezeichnung, r.beschreibung, r.portal, r.erfordert_2fa
           from rolle r
          where r.schluessel = $1 and r.archiviert_am is null
            and (case when $3::boolean then r.mandant_id = $2 else r.mandant_id is null end)
          limit 1`, [rolle, mandantId, eigene]);
      if (kopf === undefined) return null;
      const rechte = await kontext.abfrage<Recht>(
        `select b.schluessel, b.modul, b.bezeichnung, b.aktion::text as aktion, b.risiko::text as risiko,
                b.erfordert_2fa, b.nur_global,
                coalesce(hier.gewaehrt, vorgabe.gewaehrt) as gewaehrt,
                (hier.gewaehrt is not null) as abweichung
           from berechtigung b
           left join rolle_berechtigung vorgabe
                  on vorgabe.rolle_id = $1::uuid and vorgabe.berechtigung_id = b.id
                 and vorgabe.mandant_id is null
           left join rolle_berechtigung hier
                  on hier.rolle_id = $1::uuid and hier.berechtigung_id = b.id
                 and hier.mandant_id = $2
          order by b.modul, b.sortierung, b.schluessel`, [kopf.id, mandantId]);
      return { kopf, rechte };
    })) as Promise<{ kopf: Kopf; rechte: readonly Recht[] } | null>);
  if (daten === null) notFound();
  const { kopf, rechte } = daten;
  const gewaehrt = rechte.filter((r) => r.gewaehrt === true);

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      wurzelTitel="Rollen"
      bereich={mandant as BereichSchluessel}
      /*
       * Die Pille „Nur Lesen" sagt jetzt die Wahrheit statt einer Gewohnheit:
       * mit `system.rolle_verwalten` UND zweitem Faktor ist diese Seite
       * schreibend (V-023), sonst zeigt sie nur.
       */
      nurLesen={!darfSetzen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{kopf.bezeichnung}</h1>
      <p data-cse="rolle-zaehler" data-gewaehrt={gewaehrt.length} className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        <code>{kopf.schluessel}</code> · {kopf.portal}
        {kopf.erfordert_2fa ? ' · Zwei-Faktor-Pflicht' : ''} —{' '}
        {String(gewaehrt.length)} von {String(rechte.length)} Rechten des Katalogs gelten in dieser
        Gesellschaft{kopf.beschreibung === null ? '' : `. ${kopf.beschreibung}`}
      </p>
      {fehler !== null ? (
        <Hinweis art="warnung" cse="rollenrecht-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Änderung wurde abgewiesen.'}
        </Hinweis>
      ) : null}
      {gesetzt !== null ? (
        <Hinweis art="erfolg" cse="rollenrecht-gesetzt" className="mb-s5 max-w-prose">
          {gesetzt === '0'
            ? 'Nichts geändert — die gewählten Zellen standen bereits so.'
            : `${gesetzt} Zelle${gesetzt === '1' ? '' : 'n'} gilt jetzt abweichend von der `
              + 'Plattformvorgabe. Die Änderung wirkt sofort und nur in dieser Gesellschaft.'}
        </Hinweis>
      ) : null}

      {/*
        * **Was das Formular NICHT kann, steht vor ihm** — nicht in einer
        * Fussnote danach. Wer eine Zelle bewegt, soll vorher wissen, dass die
        * Abweichung bleibt.
        */}
      {darfSetzen ? (
        <Hinweis art="hinweis" cse="rollenrecht-hinweis" className="mb-s5 max-w-prose">
          <strong>Eine Abweichung gilt nur hier — und sie bleibt.</strong> Sie schlägt die
          Plattformvorgabe in dieser Gesellschaft und ändert in keiner anderen etwas
          (AUT-03). <strong>Zurück zur Vorgabe gibt es nicht:</strong> es gibt „gilt hier"
          und „gilt hier nicht". Eine Entscheidung dieser Gesellschaft über ihre eigene
          Rechtematrix soll nicht spurlos verschwinden — und wer „wie die Vorgabe" will,
          setzt den Wert, den die Vorgabe heute hat, und bleibt darauf stehen, auch wenn
          die Vorgabe sich später ändert. Jede Zelle geht ins Protokoll.
          {' '}<strong>Und vergeben lässt sich nur, was diese Sitzung selbst hält</strong>
          {' '}(SEC-A3) — sonst wäre die Rechteverwaltung eine Hintertür in jedes andere
          Recht. Entziehen geht auch ohne: ein Entzug gibt niemandem etwas.
        </Hinweis>
      ) : null}

      {darf['system.rolle_verwalten'] === true && !zweiterFaktor ? (
        <Hinweis art="warnung" cse="rollenrecht-2fa" className="mb-s5 max-w-prose">
          <strong>Der zweite Faktor fehlt in dieser Sitzung.</strong> Rechte werden nur
          mit ihm verstellt (AUT-02) — er gehört der Sitzung, nicht dem Konto. Melde dich
          mit dem zweiten Faktor an, dann steht das Formular hier.
        </Hinweis>
      ) : null}

      <form method="post" action="/api/einstellungen/rollenrecht"
            data-cse="rollenrecht-formular">
        <input type="hidden" name="rolle" value={kopf.id} />
      <div data-cse="rechte-matrix">
        <DataTable
          beschriftung={`Rechte der Rolle ${kopf.bezeichnung} in dieser Gesellschaft`}
          zeilen={rechte}
          schluessel={(r) => r.schluessel}
          spalten={[
            { schluessel: 'modul', kopf: 'Modul', zelle: (r) => r.modul },
            { schluessel: 'recht', kopf: 'Recht',
              zelle: (r) => (
                <span>
                  {r.bezeichnung}
                  <span className="ml-s2 text-xs text-text-subtle"><code>{r.schluessel}</code></span>
                </span>
              ) },
            { schluessel: 'risiko', kopf: 'Risiko',
              zelle: (r) => <span className={r.risiko === 'hoch' ? 'text-danger' : ''}>{RISIKO[r.risiko] ?? r.risiko}</span> },
            { schluessel: 'faktor', kopf: '2FA', zelle: (r) => (r.erfordert_2fa ? 'Pflicht' : '—') },
            { schluessel: 'gilt', kopf: 'Gilt',
              zelle: (r) => (r.gewaehrt === true
                ? <span data-gilt="ja" className="text-success">ja</span>
                : r.gewaehrt === false
                  ? <span data-gilt="nein" className="text-danger">verweigert</span>
                  : <span data-gilt="offen" className="text-text-subtle">nicht vergeben</span>) },
            { schluessel: 'quelle', kopf: 'Quelle',
              zelle: (r) => (r.gewaehrt === null ? '—' : r.abweichung ? 'Abweichung dieser Gesellschaft' : 'Plattformvorgabe') },
            ...(darfSetzen ? [{
              schluessel: 'setzen', kopf: 'Hier setzen',
              zelle: (r: Recht) => (zelleBindbar(kopf.schluessel, r.schluessel) ? (
                <select name={`r:${r.schluessel}`} defaultValue="unveraendert"
                        data-cse="rollenrecht-wahl" data-recht={r.schluessel}
                        className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text">
                  <option value="unveraendert">unverändert</option>
                  <option value="gewaehren">gilt hier</option>
                  <option value="entziehen">gilt hier nicht</option>
                </select>
              ) : (
                /*
                 * Kein Auswahlfeld, und der Grund daneben. Ein leeres Feld
                 * liesse offen, ob die Zelle vergessen wurde oder nicht
                 * bewegt werden darf.
                 */
                <span className="text-xs text-text-subtle" data-cse="rollenrecht-fest">
                  {r.nur_global ? 'nur global' : 'nicht in der Matrix'}
                </span>
              )),
            }] : []),
          ]}
        />
      </div>
        {darfSetzen ? (
          <div className="mt-s4 flex flex-col gap-s3">
            <div>
              <Button type="submit" variante="primary" data-cse="rollenrecht-speichern">
                Abweichungen speichern
              </Button>
            </div>
            <p className="m-0 max-w-prose text-xs text-text-muted">
              Ein Auswahlfeld steht nur dort, wo die Rechtematrix aus 03-AUTH §12 die
              Zelle kennt — als Vorgabe (<code>✔</code>) oder als bindbar
              (<code>○</code>). Was dort leer ist, wird dort entschieden und nicht hier;
              ein Recht, das nur über die globale Rolle gilt, bliebe als Abweichung
              wirkungslos. <strong>Und wer sich selbst{' '}
              <Recht schluessel="system.rolle_verwalten" /> nähme, bekommt nichts
              gespeichert:</strong> die Plattform fragt nach dem Schreiben noch einmal, ob
              diese Sitzung das Recht dann noch hält — und nimmt sonst alles zurück.
            </p>
          </div>
        ) : null}
      </form>
    </PortalRahmen>
  );
}

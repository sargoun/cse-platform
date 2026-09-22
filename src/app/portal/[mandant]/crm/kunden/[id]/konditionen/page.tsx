import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  leseKondition, mahnsperreAktiv, zielHerkunft, type Kondition,
} from '@/server/services/crm/kondition';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { Unternavigation } from '../Unternavigation';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/crm/kunden/[id]/konditionen` — Debitorennummer,
 * Zahlungsziel, Mahnsperre (CRM-01, FIN-15, K-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Angaben, und jede steht mit ihrer WIRKUNG daneben.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das ist der Punkt dieser Seite. Ein Formular mit drei Feldern hätte jeder
 * gebaut; was fehlt, ist die Antwort auf die Frage, die der Mensch davor hat
 * — was passiert, wenn ich das leer lasse? Deshalb steht neben dem
 * Zahlungsziel, welche Stufe der Auflösung greift und was die Faktura tut,
 * wenn keine greift (nämlich: kein `faellig_am`, und die Festschreibung weist
 * mit Grund ab — kein geratenes 14, O-66). Und neben der Mahnsperre steht,
 * dass `app.kunde_mahnsperre_aktiv` den Mahnlauf tatsächlich anhält.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die vier Spalten sind `cse_app` ENTZOGEN (K-05) — gelesen wird über einen
 * Definer, und der PROTOKOLLIERT.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `app.zahlungskondition_lesen` prüft `crm_entgelt.lesen` und schreibt bei
 * jedem Aufruf eine Protokollzeile. Das steht auf der Seite, nicht nur im
 * Quelltext: wer die Kondition eines Kunden liest, soll wissen, dass es
 * sichtbar ist.
 */
export const dynamic = 'force-dynamic';

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

interface Kopf {
  readonly id: string;
  readonly name: string;
  readonly kundennummer: string;
  readonly typ: string;
}

export default async function Konditionen(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ meldung?: string; erfolg?: string }>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/crm/kunden/${id}/konditionen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Das Tor der Route ist `crm_entgelt.lesen`. Die Kundenzeile selbst steht
   * aber unter `t_mandant` und verlangt `crm.lesen` — ohne das kommt sie
   * nicht zurück, und die Seite antwortet 404 (AUT-06). `crm.schreiben`
   * entscheidet, ob das Formular erscheint; `mahnung.lesen` und die Reiter
   * der Nachbarseiten kommen aus derselben Abfrage.
   */
  const darf = await haeltRechte(sitzung,
    'crm.lesen', 'crm.schreiben', 'mahnung.lesen',
    'crm_entgelt.lesen', 'abrechnung.lesen', 'system.benutzer_verwalten');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select k.id, k.name, k.kundennummer, k.typ::text as typ
           from kunde k
          where k.mandant_id = app.aktiver_mandant() and k.id = $1::uuid
            and k.archiviert_am is null`, [id]);
      if (kopf === undefined) return null;
      return {
        kopf,
        kondition: await leseKondition(kontext, id),
        sperreAktiv: await mahnsperreAktiv(kontext, id),
        heute: (await kontext.abfrage<{ tag: string }>(
          `select app.berlin_heute()::text as tag`))[0]?.tag ?? '',
      };
    })) as Promise<{
      kopf: Kopf; kondition: Kondition | null; sperreAktiv: boolean | null;
      heute: string;
    } | null>);

  if (daten === null) notFound();
  const { kopf, kondition, sperreAktiv, heute } = daten;
  const herkunft = zielHerkunft(kondition);
  const darfSchreiben = darf['crm.schreiben'] === true;
  /*
   * Eine ABGELAUFENE Sperre bleibt bedienbar.
   *
   * Sie läuft ja normalerweise ab — der Seed setzt eine auf heute + 30 Tage.
   * Stünde hier weiter `min={heute}`, verweigerte der Browser ab Tag 31 den
   * eigenen Vorgabewert, und an diesem Kunden wäre weder die Debitorennummer
   * noch das Zahlungsziel änderbar, ohne zugleich den festgehaltenen Grund zu
   * löschen. Der Dienst lässt ein UNVERÄNDERTES `mahnsperre_bis` in der
   * Vergangenheit deshalb durch; die Schranke im Browser muss dasselbe tun.
   */
  const sperreAbgelaufen = kondition?.mahnsperreBis != null
    && kondition.mahnsperreBis < heute;

  return (
    <PortalRahmen
      titel="Konditionen"
      wurzelTitel="CRM"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/crm/kunden`, text: 'Alle Kunden' }}
    >
      <h1 className="mb-s3 text-h1 text-text">{kopf.name}</h1>
      <Unternavigation mandant={mandant} kundeId={id} aktiv="konditionen" rechte={darf} />

      {typeof suche.meldung === 'string' && suche.meldung !== '' ? (
        <Hinweis art="warnung" cse="kondition-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {suche.meldung}
        </Hinweis>
      ) : null}
      {typeof suche.erfolg === 'string' && suche.erfolg !== '' ? (
        <Hinweis art="erfolg" cse="kondition-erfolg" className="mb-s5 max-w-prose">
          {suche.erfolg}
        </Hinweis>
      ) : null}

      {kondition === null ? (
        <Hinweis art="warnung" cse="kondition-verdeckt" className="mb-s5 max-w-prose">
          <strong>Die Konditionen sind Ihnen nicht sichtbar.</strong> Diese vier
          Angaben sind der Anwendung spaltenweise entzogen (K-05) und kommen
          ausschliesslich über <code className="text-text">app.zahlungskondition_lesen</code>
          {' '}— und die verlangt <Recht schluessel="crm_entgelt.lesen" />. Das
          heisst nicht, dass keine hinterlegt sind.
        </Hinweis>
      ) : (
        <>
          <p className="mb-s5 max-w-prose text-sm text-text-muted">
            Dieser Abruf steht im Prüfprotokoll. Debitorennummer, Zahlungsziel und
            Mahnsperre sind der Anwendung entzogen und werden über einen geprüften
            Umweg gelesen — nicht aus Vorsicht, sondern weil ein
            <code className="text-text"> select *</code> auf dem Kundenstamm sie sonst in
            jeden Export und jede Fehlermeldung trüge.
          </p>

          <dl className="m-0 mb-s6 grid grid-cols-1 gap-s5 lg:grid-cols-3"
              data-cse="kondition-stand">
            <div className="rounded-lg border border-line bg-surface p-s5">
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Debitorennummer
              </dt>
              <dd className="m-0 mt-s2 text-lg text-text tabular-nums"
                  data-cse="kondition-debitor">
                {kondition.debitorennummer ?? 'nicht gesetzt'}
              </dd>
              <p className="m-0 mt-s3 text-xs text-text-muted">
                Freies Feld, eindeutig je Gesellschaft
                (<code className="text-text">kunde_debitor_uk</code>). Ob sie dem
                DATEV-Debitorenkreis des SKR folgen muss — Nummernband, Länge, führende
                Ziffer —, ist offen (O-05); bis dahin wird nichts erzwungen, was später
                falsch wäre.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface p-s5">
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Zahlungsziel
              </dt>
              <dd className="m-0 mt-s2 text-lg text-text tabular-nums"
                  data-cse="kondition-ziel">
                {kondition.zahlungszielTage === null
                  ? 'nicht gesetzt'
                  : `${String(kondition.zahlungszielTage)} Tage`}
              </dd>
              <p className="m-0 mt-s3 text-xs text-text-muted" data-cse="kondition-ziel-herkunft">
                {herkunft.text}
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface p-s5">
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Mahnsperre
              </dt>
              <dd className="m-0 mt-s2 flex flex-wrap items-center gap-s3 text-lg text-text"
                  data-cse="kondition-mahnsperre">
                {kondition.mahnsperreBis === null ? (
                  <span className="text-text">keine</span>
                ) : (
                  <>
                    <StatusPill zustand={sperreAktiv === true ? 'Wartet' : 'Archiviert'} />
                    <span className="text-sm tabular-nums">
                      bis {tagDeutsch(kondition.mahnsperreBis)}
                    </span>
                  </>
                )}
              </dd>
              <p className="m-0 mt-s3 text-xs text-text-muted">
                {kondition.mahnsperreBis === null
                  ? 'Ohne Sperre läuft der nächtliche Mahnlauf normal.'
                  : kondition.mahnsperreGrund ?? ''}
                {kondition.mahnsperreBis === null ? null : (
                  <span className="mt-s2 block">
                    {sperreAktiv === null
                      ? 'Ob sie den Lauf gerade anhält, ist Ihnen nicht sichtbar — dafür '
                        + 'fehlt mahnung.lesen.'
                      : sperreAktiv
                        ? `app.kunde_mahnsperre_aktiv hält den Mahnlauf an. Ab dem Tag `
                          + `nach dem ${tagDeutsch(kondition.mahnsperreBis)} mahnt er `
                          + 'wieder.'
                        : 'Die Sperre ist abgelaufen — der Mahnlauf läuft wieder. Sie '
                          + 'darf trotzdem stehen bleiben: sie trägt den Grund, aus dem '
                          + 'einmal nicht gemahnt wurde.'}
                  </span>
                )}
              </p>
            </div>
          </dl>
        </>
      )}

      {!darfSchreiben ? (
        <Hinweis art="hinweis" cse="kondition-nur-lesen" className="max-w-prose">
          <strong>Hier ist nur Anzeige.</strong> Zum Ändern fehlt
          <Recht schluessel="crm.schreiben" />. Das Lesen der Konditionen
          (<Recht schluessel="crm_entgelt.lesen" />) und das Ändern des
          Kundenstamms sind getrennte Rechte — wer eine Zahl sehen darf, darf sie nicht
          schon setzen.
        </Hinweis>
      ) : (
        <section aria-labelledby="aendern" className="max-w-prose">
          <h2 id="aendern" className="text-h2 text-text">Konditionen ändern</h2>
          <form
            method="post"
            action="/api/crm/kunde/konditionen"
            data-cse="kondition-formular"
            className="mt-s3 flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="kundeId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              Debitorennummer
              <input
                name="debitorennummer" className={FELD}
                defaultValue={kondition?.debitorennummer ?? ''}
                data-cse="kondition-debitor-feld"
              />
              <span className="text-xs text-text-muted">
                Leer lassen, solange keine vergeben ist. Eine erfundene Nummer wandert
                in den DATEV-Export und wird dort zum Problem eines anderen (O-05).
              </span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Zahlungsziel in Tagen
              <input
                name="zahlungszielTage" type="number" min={0} max={180} step={1}
                className={FELD}
                defaultValue={kondition?.zahlungszielTage ?? ''}
                data-cse="kondition-ziel-feld"
              />
              <span className="text-xs text-text-muted">
                0 bis 180 (<code className="text-text">kunde_zahlungsziel_plausibel</code>).
                Leer heisst „nicht vereinbart" — dann schreibt die Faktura kein
                Fälligkeitsdatum und die Festschreibung weist mit Grund ab. Das ist
                gewollt: ein Vorgabewert triebe den Mahnlauf und die Verzugszinsen nach
                § 288 BGB (O-66).
              </span>
            </label>

            <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
              <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                Mahnsperre
              </legend>
              <p className="m-0 text-xs text-text-muted">
                <strong>Beide Felder gehören zusammen.</strong> Der CHECK
                <code className="text-text"> kunde_mahnsperre_begruendet</code> nimmt nur
                beides oder keines: eine Sperre ohne Grund hinterlässt später nur die
                Auskunft, dass nicht gemahnt wurde — und niemand weiss, ob es so gewollt
                war. Beide leeren hebt die Sperre auf.
              </p>
              {sperreAbgelaufen ? (
                <p className="m-0 text-xs text-text-muted" data-cse="kondition-sperre-alt">
                  <strong>Diese Sperre ist abgelaufen — und darf so bleiben.</strong> Sie
                  hält nichts mehr an, trägt aber den Grund, aus dem einmal nicht gemahnt
                  wurde. Ein neues Datum muss heute oder später liegen; das vorhandene
                  können Sie unverändert stehen lassen und trotzdem die Debitorennummer
                  oder das Zahlungsziel ändern.
                </p>
              ) : null}
              <label className="flex flex-col gap-s2 text-sm text-text">
                Gesperrt bis
                <input
                  type="date" name="mahnsperreBis" className={FELD}
                  min={sperreAbgelaufen ? undefined : heute}
                  defaultValue={kondition?.mahnsperreBis ?? ''}
                  data-cse="kondition-sperre-bis"
                />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Grund
                <input
                  name="mahnsperreGrund" className={FELD}
                  defaultValue={kondition?.mahnsperreGrund ?? ''}
                  placeholder="Reklamation offen, Klärung mit der Objektleitung"
                  data-cse="kondition-sperre-grund"
                />
              </label>
            </fieldset>

            <button
              type="submit" data-cse="kondition-speichern"
              className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Konditionen speichern
            </button>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}

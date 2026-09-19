import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { berlinHeute } from '@/server/db/heute';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  FREIGABE_HOECHSTZAHL, ladeFreigabeliste, summeMinuten, type Freigabeliste,
} from '@/server/services/zeit/abrechnungsfreigabe';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/zeiten/freigabe` — erfasste Zeit zur Abrechnung
 * freigeben (TIM-12, FIN-07, FIN-18, `04-SEITENKARTE.md` §5.11).
 *
 * **Diese Seite ist gebaut und auf O-39 blockiert — beides zugleich.**
 * `zeit.abrechnung_freigeben` ist nicht geseedet und an keine Rolle gebunden
 * (03-AUTH §12.4), weil offen ist, ob es diesen Schritt als eigenen
 * menschlichen Akt überhaupt gibt: entweder gibt ein Mensch eine Woche frei,
 * bevor sie abgerechnet werden darf — oder eine festgeschriebene Rechnung
 * nimmt sich die Zeilen direkt. Bis der Mandant das beantwortet, antwortet
 * das Tor mit 404 (AUT-06), und die Antwort öffnet die Seite mit einer
 * Rechtebindung statt mit einem Umbau.
 *
 * **Was NICHT offen ist.** `freigegeben_am` steht seit 0034 im Schema und hat
 * zwei gebaute Leser: das Stundenkonto nimmt nur Freigegebenes (§7.3, EMP-04),
 * und die Rechnungsstellung wählt `freigegeben_am is not null and
 * abgerechnet_am is null` (§3.3, FIN-07). Diese Seite schreibt genau das
 * hinein, was dort steht — sie erfindet keine Regel, sondern gibt der
 * vorhandenen ihren einzigen menschlichen Weg.
 *
 * **Kein Lohn, nirgends** (K-05): weder Stundensatz noch Betrag. Die Seite
 * beantwortet „welche Zeit darf abgerechnet werden", nicht „wie viel ist sie
 * wert".
 *
 * **Die Häkchen sind gesetzt, und das ist eine Entscheidung.** Der gefilterte
 * Zeitraum IST die geprüfte Menge — wer eine Woche ansieht und freigibt,
 * nimmt heraus, was nicht dazugehört. Umgekehrt (alles leer, sechzig Häkchen
 * setzen) würde die Liste nicht sorgfältiger gelesen, sondern nur langsamer.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

function zahl(wert: string | string[] | undefined): number | null {
  const roh = einzeln(wert);
  return roh !== null && Number.isFinite(Number(roh)) ? Number(roh) : null;
}

export default async function Abrechnungsfreigabe({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/freigabe`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: „Zeiterfassung" verlangt `zeit.lesen`, der MiLoG-Nachweis
     `zeit.exportieren`. Wer nur freigeben darf, bekäme hinter beiden ein 404
     (D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'zeit.lesen', 'zeit.exportieren');

  const frage = await searchParams;
  const heute = await berlinHeute();
  const rohWoche = einzeln(frage['woche']);
  const anker = rohWoche !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohWoche) ? rohWoche : heute;
  const von = montag(anker);
  const bis = tagePlus(von, 6);

  const rohPerson = einzeln(frage['person']);
  const rohObjekt = einzeln(frage['objekt']);
  const filter = {
    von,
    bis,
    personId: rohPerson !== null && UUID.test(rohPerson) ? rohPerson : null,
    objektId: rohObjekt !== null && UUID.test(rohObjekt) ? rohObjekt : null,
    nurOhneAuftrag: einzeln(frage['ohne_auftrag']) === '1',
  };

  const liste = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeFreigabeliste(kontext, filter)),
  ) as Promise<Freigabeliste>);

  const { minuten, ohneDauer } = summeMinuten(liste.zeilen);
  const ohneAuftrag = liste.zeilen.filter((z) => z.ohneAuftrag).length;
  const nacherfasst = liste.zeilen.filter((z) => z.nacherfasst).length;
  const gesperrt = liste.zeilen.filter((z) => z.monatGesperrt).length;
  const zuViele = liste.zeilen.length > FREIGABE_HOECHSTZAHL;

  const freigegeben = zahl(frage['freigegeben']);
  const uebersprungen = zahl(frage['uebersprungen']);
  const fehler = einzeln(frage['fehler']);

  /** Die Filterlage als Abfrage — für die Wochenpfeile und den Rückweg. */
  const mitFilter = (aenderung: Readonly<Record<string, string | null>>): string => {
    const p = new URLSearchParams();
    const basis: Record<string, string | null> = {
      woche: von,
      person: filter.personId,
      objekt: filter.objektId,
      ohne_auftrag: filter.nurOhneAuftrag ? '1' : null,
      ...aenderung,
    };
    for (const [k, v] of Object.entries(basis)) if (v !== null && v !== '') p.set(k, v);
    return p.toString();
  };
  const lage = mitFilter({});

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 '
    + 'text-sm text-text-muted transition-colors duration-fast hover:border-line-strong '
    + 'hover:text-text';

  return (
    <PortalRahmen
      titel="Freigabe zur Abrechnung"
      wurzelTitel="Zeiterfassung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Freigabe zur Abrechnung</h1>
        <p className="m-0 text-sm text-text-muted">
          {von} bis {bis}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['zeit.lesen'] === true && (
          <Link href={`/portal/${mandant}/zeiten`} className={verweis}>Zur Zeiterfassung</Link>
        )}
        {darf['zeit.exportieren'] === true && (
          <Link href={`/portal/${mandant}/zeiten/milog`} className={verweis}>
            MiLoG-Nachweis
          </Link>
        )}
      </nav>

      {/*
        * **Der offene Punkt steht oben und nicht in einer Fussnote.** Eine
        * Seite, die eine unbeantwortete Geschäftsregel umsetzt, muss das
        * sagen — sonst wird aus einem Platzhalter eine Gewohnheit (K-17).
        */}
      <Hinweis art="hinweis" cse="o39-offen" className="mb-s5 max-w-prose">
        <strong>Offen: O-39 — gibt es diesen Schritt überhaupt?</strong> Entweder gibt
        ein Mensch erfasste Zeit frei, bevor sie abgerechnet werden darf, oder eine
        festgeschriebene Rechnung nimmt sich die Zeilen direkt. Bis der Mandant das
        beantwortet, ist das Recht <code>zeit.abrechnung_freigeben</code> an keine Rolle
        gebunden: diese Seite ist gebaut und geprüft, und sie wird durch eine
        Rechtebindung erreichbar — nicht durch einen Umbau. Offen ist zudem die
        <strong> Einheit</strong> (je Eintrag, je Woche, je Person, je Monat) und ob eine
        erteilte Freigabe zurücknehmbar ist; ausgeliefert ist die feinste Einheit — je
        Eintrag — und keine Rücknahme (O-861, Invariante 8).
        {/* TODO(client, O-861): In welcher Einheit wird Zeit zur Abrechnung freigegeben — je Eintrag, je Woche, je Person, je Monat —, und laesst sich eine erteilte Freigabe zuruecknehmen, solange nichts abgerechnet ist? */}
      </Hinweis>

      {freigegeben !== null && (
        <Hinweis art="erfolg" cse="freigabe-bericht" className="mb-s5 max-w-prose">
          <strong>{freigegeben} freigegeben.</strong>{' '}
          {uebersprungen === null || uebersprungen === 0
            ? 'Nichts übersprungen.'
            : `${String(uebersprungen)} übersprungen — sie standen nicht mehr so da, wie `
              + 'die Liste sie zeigte (storniert, schon freigegeben oder ohne Dauer).'}{' '}
          Freigegebene Zeit fliesst auf das Stundenkonto (EMP-04) und steht der
          Rechnungsstellung zur Verfügung (FIN-07).
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" cse="freigabe-fehler" className="mb-s5 max-w-prose">
          <strong>Nichts freigegeben.</strong>{' '}
          {fehler === 'zu_gross'
            ? `Höchstens ${String(FREIGABE_HOECHSTZAHL)} Einträge auf einmal.`
            : 'Es war nichts ausgewählt.'}
        </Hinweis>
      )}

      <div className="mb-s5 grid gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiStat label="Offen" wert={String(liste.zeilen.length)} ton="info" icon="uhr" />
        <KpiStat label="Stunden" wert={stundenAusMinuten(minuten)} ton="info" icon="uhr" />
        <KpiStat
          label="Ohne Auftrag" wert={String(ohneAuftrag)}
          ton={ohneAuftrag > 0 ? 'warning' : 'muted'} icon="warnung"
        />
        <KpiStat
          label="Nacherfasst" wert={String(nacherfasst)}
          ton={nacherfasst > 0 ? 'warning' : 'muted'} icon="warnung"
        />
      </div>

      <form method="get" action={pfad} data-cse="freigabe-filter"
            className="mb-s5 flex flex-wrap items-end gap-s3">
        <label className="flex flex-col gap-s2 text-sm text-text">
          Woche ab
          <input type="date" name="woche" defaultValue={von} className={feld} />
        </label>
        <label className="flex flex-col gap-s2 text-sm text-text">
          Person
          <select name="person" defaultValue={filter.personId ?? ''} className={feld}>
            <option value="">alle</option>
            {liste.auswahl.personen.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-s2 text-sm text-text">
          Objekt
          <select name="objekt" defaultValue={filter.objektId ?? ''} className={feld}>
            <option value="">alle</option>
            {liste.auswahl.objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-s2 text-sm text-text">
          <input type="checkbox" name="ohne_auftrag" value="1"
                 defaultChecked={filter.nurOhneAuftrag}
                 className="size-4 rounded border-line" />
          nur ohne Auftrag
        </label>
        <Button type="submit" variante="secondary">Filtern</Button>
      </form>

      <nav aria-label="Woche" className="mb-s5 flex flex-wrap gap-s3 text-sm">
        <a href={`${pfad}?${mitFilter({ woche: tagePlus(von, -7) })}`}
           className="text-text underline underline-offset-2">← Vorwoche</a>
        <a href={`${pfad}?${mitFilter({ woche: montag(heute) })}`}
           className="text-text underline underline-offset-2">Diese Woche</a>
        <a href={`${pfad}?${mitFilter({ woche: tagePlus(von, 7) })}`}
           className="text-text underline underline-offset-2">Folgewoche →</a>
      </nav>

      {liste.zeilen.length === 0 ? (
        <p data-cse="freigabe-leer"
           className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Woche wartet keine abgeschlossene Zeit auf eine Freigabe. Laufende
          Einträge stehen bewusst nicht hier: ein Eintrag ohne Ende hat keine Dauer, und
          eine Dauer ist der Abstand zweier Zeitpunkte (Invariante 2).
        </p>
      ) : (
        <form method="post" action="/api/zeit/abrechnungsfreigabe" data-cse="freigabe-formular">
          <input type="hidden" name="frage" value={lage} />

          {zuViele && (
            <Hinweis art="warnung" cse="freigabe-zu-viele" className="mb-s4 max-w-prose">
              Es stehen {liste.zeilen.length} Einträge in dieser Auswahl, und höchstens{' '}
              {FREIGABE_HOECHSTZAHL} gehen auf einmal. Grenzen Sie auf eine Person oder
              ein Objekt ein.
            </Hinweis>
          )}
          {gesperrt > 0 && (
            <Hinweis art="warnung" cse="freigabe-gesperrt" className="mb-s4 max-w-prose">
              {gesperrt} Eintrag/Einträge liegen in einem abgeschlossenen
              Stundenkonto-Monat. Eine Freigabe danach fliesst nicht mehr in die
              Monatsbuchung, sondern erscheint als Ausgleichsbuchung im ersten offenen
              Monat (§12.2) — sie sind deshalb gekennzeichnet und nicht gesperrt.
            </Hinweis>
          )}

          <DataTable
            beschriftung="Abgeschlossene, noch nicht freigegebene Zeiteinträge"
            zeilen={liste.zeilen}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'freigeben', kopf: 'Freigeben',
                zelle: (z) => (liste.darfFreigeben ? (
                  <input type="checkbox" name="zeiteintrag" value={z.id} defaultChecked
                         data-cse="freigabe-auswahl" className="size-4 rounded border-line"
                         aria-label={`${z.person}, ${z.beginnLokal} freigeben`} />
                ) : (
                  <span className="text-xs text-text-subtle">kein Recht</span>
                )),
              },
              {
                schluessel: 'person', kopf: 'Person',
                zelle: (z) => (darf['zeit.lesen'] === true ? (
                  <Link href={`/portal/${mandant}/zeiten/${z.id}`}
                        className="text-text underline-offset-2 hover:text-brand hover:underline">
                    {z.person}
                  </Link>
                ) : z.person),
              },
              {
                schluessel: 'zeit', kopf: 'Zeit',
                zelle: (z) => (
                  <span className="tabular-nums">
                    {z.beginnLokal} – {z.endeLokal ?? '—'}
                    {z.endeFolgetag && <span className="text-text-muted"> +1</span>}
                  </span>
                ),
              },
              {
                schluessel: 'objekt', kopf: 'Objekt',
                zelle: (z) => z.objekt ?? <span className="text-text-muted">—</span>,
              },
              {
                schluessel: 'auftrag', kopf: 'Auftrag',
                zelle: (z) => (z.ohneAuftrag ? (
                  <span className="text-warning" data-cse="ohne-auftrag">
                    ohne Auftrag
                  </span>
                ) : (
                  <span className="flex flex-col gap-s1">
                    <span className="text-text">{z.auftragsnummer}</span>
                    <span className="text-xs text-text-muted">{z.leistung}</span>
                  </span>
                )),
              },
              {
                schluessel: 'dauer', kopf: 'Netto', numerisch: true,
                zelle: (z) => (z.nettoMinuten === null
                  ? <span className="text-text-muted">—</span>
                  : stundenAusMinuten(z.nettoMinuten)),
              },
              {
                schluessel: 'merkmal', kopf: 'Merkmal',
                zelle: (z) => (
                  <span className="flex flex-wrap items-center gap-s2">
                    {z.nacherfasst && <StatusPill zustand="Wartet" />}
                    {z.nacherfasst && <span className="text-xs text-warning">nacherfasst</span>}
                    {z.monatGesperrt && (
                      <span className="text-xs text-warning" data-cse="monat-gesperrt">
                        Monat abgeschlossen
                      </span>
                    )}
                    {!z.nacherfasst && !z.monatGesperrt && (
                      <span className="text-sm text-text-muted">—</span>
                    )}
                  </span>
                ),
              },
            ]}
          />

          <div className="mt-s5 flex flex-wrap items-center gap-s3">
            <Button type="submit" variante="primary" data-cse="freigabe-absenden"
                    disabled={!liste.darfFreigeben}>
              Ausgewählte freigeben
            </Button>
            <p className="m-0 max-w-prose text-xs text-text-subtle">
              Alle Häkchen sind gesetzt — nehmen Sie heraus, was nicht freigegeben werden
              soll. Die Freigabe wird je Eintrag protokolliert (wer, wann, mit welcher
              Nettodauer) und ist nicht zurücknehmbar (Invariante 8, O-861).
              {ohneDauer > 0 && (
                <>
                  {' '}
                  <span data-cse="ohne-dauer">
                    {ohneDauer} Eintrag/Einträge tragen keine berechnete Nettodauer und
                    werden übersprungen — es gäbe nichts abzurechnen.
                  </span>
                </>
              )}
            </p>
          </div>
        </form>
      )}

      <p className="mt-s6 max-w-prose text-sm text-text-muted">
        Die Summe zählt GENAU die Zeilen darunter — dieselbe Abfrage, dasselbe Fenster
        (DSH-04). Jede Uhrzeit ist Berliner Ortszeit, gerechnet in der Datenbank; die
        Spalte „Zeit" trägt ein <code>+1</code>, wenn die Schicht über Mitternacht ging
        (Invariante 2). Weder Stundensatz noch Betrag stehen hier: diese Seite
        beantwortet „welche Zeit darf abgerechnet werden", nicht „wie viel ist sie wert"
        (K-05).
      </p>
    </PortalRahmen>
  );
}

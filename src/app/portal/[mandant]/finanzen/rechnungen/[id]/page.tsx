import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgres } from '@/server/services/finanz/menge';
import { ermittleSteuerfall } from '@/server/services/finanz/steuerfall';
import { ladeQuellen, pruefeZeiterfassung, type Fin18Befund, type QuelleZeile }
  from '@/server/services/finanz/positionsquelle';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]` — **Entwurfseditor ODER
 * festgeschriebene Ansicht, nie beides** (04-SEITENKARTE.md §5).
 *
 * Das ist keine Darstellungsfrage. Ein Formular auf einem festgeschriebenen
 * Beleg verspricht eine Aenderung, die die Datenbank anschliessend ablehnt —
 * und der Mensch, der es ausfuellt, lernt aus einer Fehlermeldung, was die
 * Oberflaeche ihm haette sagen muessen.
 *
 * **Eine Position laesst sich nicht ENTFERNEN, nur korrigieren.** Invariante 8
 * kennt in dieser Domaene keinen Hard Delete, und `rechnungsposition` traegt
 * keine Zustandsspalte. Wer neu anfangen will, verwirft den Entwurf — der
 * bleibt mit Grund stehen und kostet keine Nummer. Der Knopf dafuer steht
 * unten.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  festgeschrieben: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly abzug_brutto_cent: string;
  readonly reverse_charge: boolean;
  readonly reverse_charge_grundlage: string | null;
  readonly steuerhinweis: string | null;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly einbehalt_bauabzugsteuer_cent: string;
  readonly ueberweisungsbetrag_cent: string;
  readonly freistellung_nummer: string | null;
  readonly zahlbetrag_cent: string;
  readonly auftrag_id: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly faellig_am: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly kopftext: string | null;
  readonly verworfen_grund: string | null;
  readonly hash: string | null;
  readonly kette_position: string | null;
  readonly storniert_durch: string | null;
  readonly ersetzt_durch: string | null;
}

interface Pos {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly unece_code: string | null;
  readonly einzelpreis_cent: string | null;
  readonly netto_cent: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
}

interface Steuer {
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/**
 * Eine abgezogene Abschlagsrechnung, je Steuergruppe (FIN-08).
 *
 * Sie steht auf dem Beleg, weil der Kunde sonst einen Zahlbetrag sieht, den
 * er aus dem Sichtbaren nicht nachrechnen kann — Positionen, Summen, und
 * dazwischen eine Differenz ohne Erklaerung.
 */
interface Abzug {
  readonly nummer: string;
  readonly rechnungsdatum: string | null;
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

interface Leistung {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
}

interface Einheit { readonly schluessel: string; readonly bezeichnung: string;
  readonly ist_platzhalter: boolean }
interface Gruppe { readonly schluessel: string; readonly bezeichnung: string }

export default async function Rechnungsblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kopf: (await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart,
                k.name as kunde, k.id::text as kunde_id, o.bezeichnung as objekt,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von,
                to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis,
                r.zahlungsziel_tage, to_char(r.faellig_am, 'DD.MM.YYYY') as faellig_am,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
                r.abzug_brutto_cent::text, r.zahlbetrag_cent::text, r.auftrag_id,
                r.reverse_charge, r.reverse_charge_grundlage::text as reverse_charge_grundlage,
                r.steuerhinweis, r.bauabzugsteuer_pflichtig, r.bauabzugsteuer_satz_bp,
                r.einbehalt_bauabzugsteuer_cent::text, r.ueberweisungsbetrag_cent::text,
                fb.bescheinigung_nummer as freistellung_nummer,
                r.kopftext, r.verworfen_grund,
                h.hash, h.kette_position::text,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'storno' limit 1) as storniert_durch,
                (select s.nummer from rechnung_beziehung b
                   join rechnung s on s.id = b.von_rechnung_id
                  where b.zu_rechnung_id = r.id and b.art = 'ersetzt' limit 1) as ersetzt_durch
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
           left join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
           left join rechnung_hash h on h.rechnung_id = r.id
           left join freistellungsbescheinigung fb
                  on fb.mandant_id = r.mandant_id
                 and fb.id = r.freistellungsbescheinigung_id
          where r.id = $1`, [id]))[0] ?? null,
      positionen: await kontext.abfrage<Pos>(
        `select p.id, p.position_nr, p.bezeichnung, p.menge::text, p.einheit,
                e.unece_code, p.einzelpreis_cent::text, p.netto_cent::text,
                g.schluessel as gruppe, p.satz_bp
           from rechnungsposition p
           join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
           left join masseinheit e on e.id = p.masseinheit_id
          where p.rechnung_id = $1 order by p.position_nr`, [id]),
      /**
       * Die abgezogenen Abschlaege — nur die WIRKSAMEN. Eine unwirksam
       * gewordene Zeile (die Schlussrechnung wurde storniert) bleibt in der
       * Tabelle stehen (Invariante 8) und gehoert nicht mehr auf den Beleg.
       */
      abzuege: await kontext.abfrage<Abzug>(
        `select a.nummer, to_char(a.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                g.schluessel as gruppe,
                (select rs.satz_bp from rechnung_steuer rs
                  where rs.rechnung_id = b.abschlag_rechnung_id
                    and rs.steuersatz_gruppe_id = b.steuersatz_gruppe_id) as satz_bp,
                b.abzug_netto_cent::text as netto_cent,
                b.abzug_steuer_cent::text as steuer_cent
           from abschlagsrechnung_bezug b
           join rechnung a on a.mandant_id = b.mandant_id and a.id = b.abschlag_rechnung_id
           join steuersatz_gruppe g on g.id = b.steuersatz_gruppe_id
          where b.schluss_rechnung_id = $1 and b.wirksam
          order by a.rechnungsdatum, a.nummer, g.schluessel`, [id]),
      steuer: await kontext.abfrage<Steuer>(
        `select g.schluessel as gruppe, s.satz_bp, s.netto_cent::text, s.steuer_cent::text
           from rechnung_steuer s
           join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
          where s.rechnung_id = $1 and (s.netto_cent <> 0 or s.steuer_cent <> 0)
          order by g.schluessel`, [id]),
      einheiten: await kontext.abfrage<Einheit>(
        `select schluessel, bezeichnung, ist_platzhalter from masseinheit order by schluessel`),
      gruppen: await kontext.abfrage<Gruppe>(
        `select schluessel, bezeichnung from steuersatz_gruppe
          where app.berlin_heute() >= gueltig_von
            and (gueltig_bis is null or app.berlin_heute() <= gueltig_bis)
          order by satz_bp desc`),
      /**
       * Die Herkunft jeder Zeile (FIN-07, DSH-04) — mit Beschriftung, Ziel und
       * dem auf sie entfallenden Anteil. Gebildet wird das im DIENST, nicht
       * hier: dieselbe Zeile fuehrt aus der Rechnung, aus dem Bericht und aus
       * einem spaeteren Export an dieselbe Stelle, und drei Kopien eines
       * Pfades driften.
       */
      quellen: await ladeQuellen(kontext, id),
      /**
       * Der Steuerfall, NEU GERECHNET beim Anzeigen (FIN-09, FIN-10).
       *
       * Gespeichert sind die Folgen (`reverse_charge`, der Einbehalt); was
       * NICHT gespeichert ist, ist der Hinweis, wenn Kopf und Positionen
       * auseinandergehen — und genau der muss auf dem Bildschirm stehen,
       * bevor jemand festschreibt.
       */
      steuerfall: await ermittleSteuerfall(kontext, id),
      /**
       * Die Leistungszeilen des Auftrags — die eine Herkunft, die sich hier
       * OHNE Zeiterfassung belegen laesst, und zugleich der Anker der
       * Stundenzeile darunter. Ist die Rechnung keinem Auftrag zugeordnet,
       * bleibt die Liste leer und das Formular bietet nur „von Hand" an.
       */
      leistungen: await kontext.abfrage<Leistung>(
        `select al.id::text as id, al.position_nr, al.bezeichnung
           from auftrag_leistung al
           join rechnung r on r.mandant_id = al.mandant_id and r.auftrag_id = al.auftrag_id
          where r.id = $1
          order by al.position_nr`, [id]),
      /**
       * FIN-18 — und nur, wenn der Betrachter ueberhaupt festschreiben darf.
       *
       * `fin.auftrag_erfasste_minuten()` verlangt `finanzen.festschreiben` und
       * weist sonst ab. Den Aufruf ungeprueft zu wagen liesse diese Seite fuer
       * jeden abstuerzen, der eine Rechnung nur ANSEHEN darf.
       */
      fin18: (await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.festschreiben', app.aktiver_mandant()) as darf`,
      ))[0]?.darf === true
        ? await pruefeZeiterfassung(kontext, id)
        : null,
      /**
       * Darf dieser Mensch ueberhaupt stornieren?
       *
       * Die Frage MUSS hier gestellt werden und nicht erst an der Route.
       * `finanzen.stornieren` haelt heute nur `super_admin` (Katalog:
       * `gebunden: ['super_admin'], bindbar: ['admin','leitung']`) — und der
       * Vorgabewert ist ausdruecklich vorlaeufig, solange O-77 offen ist.
       * Das Formular stand trotzdem auf JEDEM festgeschriebenen Beleg: die
       * Verwaltung einer Gesellschaft tippte einen auditfaehigen Grund, drueckte
       * „Stornieren" und bekam die rohe Zeichenkette `{"fehler":"unbekannt"}`
       * ins Fenster — 404, weil dieses Projekt fehlende Rechte nicht
       * bestaetigt (AUT-06). Ein Bedienelement, das jeder sieht und niemand
       * benutzen kann, ist schlimmer als keines: es sagt, die Korrektur sei
       * moeglich, und nimmt dem Leser die eine Auskunft, die er braucht —
       * naemlich WER sie vornehmen kann.
       *
       * // TODO(client, O-77): Wer darf eine festgeschriebene Rechnung
       * stornieren — nur die Gruppenleitung, oder auch die Verwaltung einer
       * Gesellschaft? Invariante 4 legt den MECHANISMUS fest (Stornobuchung)
       * und sagt ueber die Befugnis nichts.
       */
      darfStornieren: ((await kontext.abfrage<{ darf: boolean }>(
        `select app.hat_recht('finanzen.stornieren', app.aktiver_mandant()) as darf`,
      ))[0]?.darf) === true,
    }))) as Promise<{
      kopf: Kopf | null; positionen: readonly Pos[]; steuer: readonly Steuer[];
      abzuege: readonly Abzug[];
      einheiten: readonly Einheit[]; gruppen: readonly Gruppe[];
      quellen: readonly QuelleZeile[]; leistungen: readonly Leistung[];
      fin18: Fin18Befund | null;
      steuerfall: Awaited<ReturnType<typeof ermittleSteuerfall>>;
      darfStornieren: boolean;
    }>);

  const k = daten.kopf;
  if (k === null) notFound();
  const entwurf = k.status === 'entwurf';
  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={k.nummer ?? 'Rechnungsentwurf'}
      bereich={mandant as BereichSchluessel}
      nurLesen={!entwurf}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3 flex flex-wrap gap-s4">
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Rechnungen
        </Link>
        {/*
          * Der §14-UStG-Vorabbericht (PR 47). Er steht auf einer EIGENEN
          * Seite und nicht als Kasten hier: er nennt jedes fehlende Feld auf
          * einmal, und diese Seite ist der Editor — zwei Aufgaben auf einem
          * Blatt heisst, dass man beim Tippen scrollt.
          */}
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/pruefung`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          §14-UStG-Prüfung ansehen
        </Link>
        {/*
          * Die XRechnung (PR 52). Auch sie auf einer eigenen Seite: sie zeigt
          * das erzeugte UBL und den Pruefstand, und beides gehoert nicht in
          * einen Editor. Der Verweis steht bei JEDEM Beleg und nicht nur bei
          * einem oeffentlichen Auftraggeber — wer wissen will, ob eine
          * Rechnung elektronisch zustellbar waere, findet die Antwort sonst
          * nur, indem er sie verschickt.
          */}
        <Link
          href={`/portal/${mandant}/finanzen/rechnungen/${k.id}/xrechnung`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          XRechnung ansehen
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">
          {k.nummer ?? 'Entwurf ohne Nummer'}
        </h1>
        <StatusPill zustand={PILLE[k.status] ?? 'Entwurf'} />
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div><dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{k.kunde}</dd></div>
        <div><dt className="text-xs text-text-muted">Leistungsort</dt>
          <dd className="text-sm text-text">{k.objekt ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">Leistungszeitraum</dt>
          <dd className="text-sm text-text">
            {k.leistung_von ?? '—'} – {k.leistung_bis ?? '—'}
          </dd></div>
        <div><dt className="text-xs text-text-muted">Rechnungsdatum</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd></div>
        <div><dt className="text-xs text-text-muted">Zahlungsziel</dt>
          <dd className="text-sm text-text">
            {k.zahlungsziel_tage === null
              ? <span className="text-warning">nicht hinterlegt (O-66)</span>
              : `${String(k.zahlungsziel_tage)} Tage`}
          </dd></div>
        <div><dt className="text-xs text-text-muted">Fällig</dt>
          <dd className="text-sm text-text">{k.faellig_am ?? '—'}</dd></div>
      </dl>

      {k.verworfen_grund === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          Verworfen: {k.verworfen_grund}
        </p>
      )}
      {k.storniert_durch === null ? null : (
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          Aufgehoben durch Stornorechnung {k.storniert_durch}
          {k.ersetzt_durch === null ? '' : `, neu ausgestellt als ${k.ersetzt_durch}`}.
          Dieser Beleg bleibt unverändert lesbar — korrigiert wird durch
          Gegenbuchung, nie durch Änderung.
        </p>
      )}

      <h2 className="mb-s3 text-h3 text-text">Positionen</h2>
      {daten.positionen.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Position. Ohne Leistungsposition gibt es nichts abzurechnen
          (§14 Abs. 4 Nr. 5 UStG).
        </p>
      ) : (
        <div className="mb-s5">
          <DataTable
            beschriftung="Positionen der Rechnung mit Menge, Einzelpreis und Steuersatz"
            zeilen={daten.positionen}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'nr', kopf: 'Nr.', numerisch: true,
                zelle: (p) => String(p.position_nr) },
              { schluessel: 'bez', kopf: 'Bezeichnung', zelle: (p) => p.bezeichnung },
              { schluessel: 'menge', kopf: 'Menge', numerisch: true,
                zelle: (p) => p.menge === null ? '—'
                  : `${formatiereMenge(mengeAusPostgres(p.menge))} ${p.einheit ?? ''}` },
              { schluessel: 'code', kopf: 'BT-130',
                zelle: (p) => p.unece_code ?? (
                  <span className="text-warning" title="Unbestätigter Wert (O-174)">
                    offen
                  </span>
                ) },
              { schluessel: 'preis', kopf: 'Einzelpreis', numerisch: true,
                zelle: (p) => p.einzelpreis_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.einzelpreis_cent))) },
              { schluessel: 'satz', kopf: 'USt', numerisch: true,
                zelle: (p) => `${(p.satz_bp / 100).toFixed(2).replace('.', ',')} %` },
              { schluessel: 'netto', kopf: 'Netto', numerisch: true,
                zelle: (p) => p.netto_cent === null ? '—'
                  : formatiereGeld(cent(BigInt(p.netto_cent))) },
            ]}
          />
        </div>
      )}

      {/*
        * **Die Herkunft jeder Zeile** (FIN-07, DSH-04, Abnahme 2).
        *
        * Sie steht als eigener Abschnitt und nicht als achte Spalte der
        * Tabelle: eine Zeile hat oft ein Dutzend Belege — auf einer
        * Reinigungsrechnung auch siebenundachtzig —, und eine Spalte, die
        * siebenundachtzig Verweise fassen soll, ist keine Spalte.
        *
        * Der Klick fuehrt an GENAU den Satz dahinter: an den Zeiteintrag, an
        * das Aufmassblatt, an den Nachtrag. Wo es (noch) keine Seite gibt,
        * steht der Beleg ohne Verweis da — ein Link ins Leere waere die
        * schlechtere Auskunft.
        */}
      {daten.quellen.length === 0 ? null : (
        <>
          <h2 className="mb-s3 text-h3 text-text">Herkunft der Positionen</h2>
          <div className="mb-s5 rounded-lg border border-line bg-surface p-s5">
            {daten.positionen.map((p) => {
              const belege = daten.quellen.filter((q) => q.positionId === p.id);
              if (belege.length === 0) return null;
              const summe = belege.reduce((a, q) => a + q.anteilCent, 0n);
              return (
                <section key={p.id} className="mb-s4 last:mb-0">
                  <h3 className="text-sm text-text">
                    Position {p.position_nr} · {p.bezeichnung}
                  </h3>
                  <ul className="mt-s2">
                    {belege.map((q) => (
                      <li
                        key={q.id}
                        className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s2 text-sm last:border-b-0"
                      >
                        <span className="text-text-muted">
                          {q.ziel === null ? q.bezeichnung : (
                            <Link
                              href={`/portal/${mandant}/${q.ziel}`}
                              className="text-text underline-offset-2 hover:underline"
                            >
                              {q.bezeichnung}
                            </Link>
                          )}
                          {q.mengeAnteil === null ? '' : ` · ${formatiereMenge(
                            mengeAusPostgres(q.mengeAnteil))} ${p.einheit ?? ''}`}
                          {q.wirksam ? '' : ' · Anspruch erloschen'}
                        </span>
                        <span className="cse-zahl text-text">
                          {formatiereGeld(cent(q.anteilCent))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {/*
                    * Die Probe, die Abnahme 2 verlangt: die Anteile summieren
                    * sich AUF DEN CENT zur Zeile. Sie steht sichtbar da und
                    * nicht nur im Test — wer sie einmal nicht aufgehen sieht,
                    * soll es sehen, statt es zu erfahren, wenn der Beleg
                    * draussen ist.
                    */}
                  <p className="mt-s2 text-xs text-text-muted">
                    Summe der Belege: {formatiereGeld(cent(summe))}
                    {p.netto_cent !== null && summe === BigInt(p.netto_cent)
                      ? ' — stimmt mit der Position überein.'
                      : ` — die Position trägt ${p.netto_cent === null ? '—'
                        : formatiereGeld(cent(BigInt(p.netto_cent)))}.`}
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}

      <h2 className="mb-s3 text-h3 text-text">Umsatzsteuer je Steuergruppe</h2>
      <table className="mb-s5 w-full max-w-prose border-collapse text-sm">
        <caption className="sr-only">
          Aufschlüsselung nach Steuersätzen (§14 Abs. 4 Nr. 8 UStG)
        </caption>
        <tbody>
          {daten.steuer.map((s) => (
            <tr key={s.gruppe} className="border-b border-line">
              <th scope="row" className="py-s2 text-left font-normal text-text-muted">
                {s.gruppe} ({(s.satz_bp / 100).toFixed(2).replace('.', ',')} %)
              </th>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.netto_cent)))}
              </td>
              <td className="cse-zahl py-s2 text-text">
                {formatiereGeld(cent(BigInt(s.steuer_cent)))}
              </td>
            </tr>
          ))}
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">Netto</th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
            </td>
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="py-s2 text-left font-normal text-text-muted">
              Umsatzsteuer
            </th>
            <td className="cse-zahl py-s2 text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.steuer_gesamt_cent)))}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-s2 text-left text-text">Brutto</th>
            <td className="cse-zahl py-s2 font-semibold text-text" colSpan={2}>
              {formatiereGeld(cent(BigInt(k.brutto_cent)))}
            </td>
          </tr>
        </tbody>
      </table>

      {/*
        * **Die Abzugstabelle** (FIN-08, Abnahme 5).
        *
        * Sie steht auf dem Beleg, weil der Kunde sonst einen Zahlbetrag saehe,
        * den er aus dem Sichtbaren nicht nachrechnen kann: Positionen, Summen,
        * und dazwischen eine Differenz ohne Erklaerung. Sie steht je Beleg UND
        * je Steuergruppe, weil §14 Abs. 4 Nr. 8 UStG die Umsatzsteuer je Satz
        * verlangt und ein Abzug in einer einzigen Zahl sich darauf nicht
        * abbilden liesse.
        */}
      {daten.abzuege.length > 0 && (
        <>
          <h2 className="mb-s3 text-h3 text-text">Abgezogene Abschlagsrechnungen</h2>
          <table
            data-cse="abzugstabelle"
            className="mb-s5 w-full max-w-prose border-collapse text-sm"
          >
            <caption className="sr-only">
              Bereits gestellte Abschläge, je Beleg und Steuersatz (FIN-08)
            </caption>
            <thead>
              <tr className="border-b border-line-strong text-text-muted">
                <th scope="col" className="py-s2 text-left font-normal">Beleg</th>
                <th scope="col" className="py-s2 text-left font-normal">Steuersatz</th>
                <th scope="col" className="py-s2 text-right font-normal">Netto</th>
                <th scope="col" className="py-s2 text-right font-normal">Umsatzsteuer</th>
              </tr>
            </thead>
            <tbody>
              {daten.abzuege.map((a) => (
                <tr key={`${a.nummer}-${a.gruppe}`} className="border-b border-line">
                  <th scope="row" className="py-s2 text-left font-normal text-text">
                    {a.nummer}
                    {a.rechnungsdatum === null ? '' : ` vom ${a.rechnungsdatum}`}
                  </th>
                  <td className="py-s2 text-text-muted">
                    {a.gruppe}
                    {a.satz_bp === null ? '' : ` (${(a.satz_bp / 100).toFixed(2).replace('.', ',')} %)`}
                  </td>
                  <td className="cse-zahl py-s2 text-right text-text">
                    −{formatiereGeld(cent(BigInt(a.netto_cent)))}
                  </td>
                  <td className="cse-zahl py-s2 text-right text-text">
                    −{formatiereGeld(cent(BigInt(a.steuer_cent)))}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" colSpan={2} className="py-s2 text-left text-text">
                  Zahlbetrag
                </th>
                <td
                  data-cse="zahlbetrag"
                  className="cse-zahl py-s2 text-right font-semibold text-text"
                  colSpan={2}
                >
                  {formatiereGeld(cent(BigInt(k.zahlbetrag_cent)))}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/*
        * **Der Steuerfall** (FIN-09, FIN-10).
        *
        * Er steht auf dem Bildschirm, weil beide Regeln Geld bewegen und
        * beide an einem Datum haengen: §13b verlagert die Steuerschuld (der
        * Beleg weist dann 0,00 € Umsatzsteuer aus und sagt warum), §48 behaelt
        * 15 % der Gegenleistung ein. Wer die Rechnung freigibt, soll beides
        * sehen — nicht erst der Steuerberater im naechsten Quartal.
        */}
      {(k.reverse_charge || k.bauabzugsteuer_pflichtig) && (
        <section
          data-cse="steuerfall"
          className="mb-s5 max-w-prose rounded-md border border-line bg-surface p-s4"
        >
          <h2 className="mb-s3 text-h3 text-text">Steuerfall</h2>
          {k.reverse_charge && (
            <p data-cse="reverse-charge" className="mb-s3 text-sm text-text">
              <strong className="text-text">§13b UStG:</strong>{' '}
              {k.steuerhinweis ?? 'Steuerschuldnerschaft des Leistungsempfängers'}
              {k.reverse_charge_grundlage === null ? '' : (
                k.reverse_charge_grundlage === 'bau'
                  ? ' (§13b Abs. 2 Nr. 4 — Bauleistung)'
                  : ' (§13b Abs. 2 Nr. 8 — Gebäudereinigung)'
              )}
            </p>
          )}
          {k.bauabzugsteuer_pflichtig && (
            <p data-cse="bauabzugsteuer" className="text-sm text-text">
              <strong className="text-text">§48 EStG:</strong>{' '}
              {k.bauabzugsteuer_satz_bp === null
                ? ''
                : `${(k.bauabzugsteuer_satz_bp / 100).toFixed(2).replace('.', ',')} % `}
              Bauabzugsteuer einbehalten —{' '}
              {formatiereGeld(cent(BigInt(k.einbehalt_bauabzugsteuer_cent)))}. An die
              Gesellschaft überwiesen werden{' '}
              {formatiereGeld(cent(BigInt(k.ueberweisungsbetrag_cent)))}.
              {k.freistellung_nummer === null
                ? ' Es liegt keine am Leistungsdatum gültige Freistellungsbescheinigung vor.'
                : ` Freistellungsbescheinigung ${k.freistellung_nummer}.`}
            </p>
          )}
          {!k.bauabzugsteuer_pflichtig && k.freistellung_nummer !== null && (
            <p className="text-sm text-text-muted">
              <strong className="text-text">§48 EStG:</strong> kein Einbehalt —
              Freistellungsbescheinigung {k.freistellung_nummer} gilt am Leistungsdatum.
            </p>
          )}
        </section>
      )}

      {daten.steuerfall.positionenHinweis !== null && (
        <p
          data-cse="steuerfall-hinweis"
          className="mb-s5 max-w-prose rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          {daten.steuerfall.positionenHinweis}
        </p>
      )}

      {/*
        * **Den Steuerfall bestimmen** — nur am Entwurf. Der Mensch sagt, WAS
        * geleistet wurde; ob daraus ein Reverse Charge folgt, entscheidet der
        * hinterlegte §13b-Status am Leistungsdatum. Ein aus dem Gewerk der
        * Gesellschaft abgeleiteter Reverse Charge waere genau der Fehler, den
        * `01-ORDNERSTRUKTUR.md` §8.6 beim Namen nennt.
        */}
      {entwurf && (
        <form
          method="post"
          action={`/api/rechnungen/steuerfall?mandant=${mandant}`}
          className="mb-s5 max-w-prose rounded-md border border-line bg-surface p-s4"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <label htmlFor="steuerfall-grundlage" className="text-xs text-text-muted">
            Art der Leistung (§13b Abs. 2 UStG)
          </label>
          <select
            id="steuerfall-grundlage"
            name="grundlage"
            data-cse="steuerfall-grundlage"
            defaultValue={k.reverse_charge_grundlage ?? ''}
            className={feld}
          >
            <option value="">weder Bauleistung noch Gebäudereinigung</option>
            <option value="bau">Bauleistung (§13b Abs. 2 Nr. 4)</option>
            <option value="gebaeudereinigung">
              Gebäudereinigungsleistung (§13b Abs. 2 Nr. 8)
            </option>
          </select>
          <p className="mt-s3 text-sm text-text-muted">
            Aus der Angabe folgt nicht automatisch eine Verlagerung: sie greift
            nur, wenn für diesen Kunden am Leistungsdatum ein §13b-Status
            hinterlegt ist. Ohne Nachweis wird die Umsatzsteuer ausgewiesen.
          </p>
          <button
            type="submit"
            data-cse="steuerfall-bestimmen"
            className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
          >
            Steuerfall bestimmen
          </button>
        </form>
      )}

      {/*
        * **Abschlaege abziehen** — nur an einem Entwurf, und nur bei einer
        * Schlussrechnung mit Auftrag. Nach dem Festschreiben waere derselbe
        * Knopf eine stille Aenderung an einem Beleg, den der Kunde schon hat
        * (Invariante 4); ohne Auftrag gibt es keine Frage, welche Abschlaege
        * gemeint sind, und geraten wird hier nichts.
        */}
      {entwurf && k.rechnungsart === 'schluss' && k.auftrag_id !== null && (
        <form
          method="post"
          action={`/api/rechnungen/abschlaege?mandant=${mandant}`}
          className="mb-s5 rounded-md border border-line bg-surface p-s4"
        >
          <input type="hidden" name="rechnungId" value={k.id} />
          <p className="mb-s3 max-w-prose text-sm text-text-muted">
            Zieht jeden festgeschriebenen Abschlag dieses Auftrags ab — je
            Steuergruppe, in den Beträgen, die auf den Abschlagsrechnungen
            stehen. Ohne diesen Schritt weist die Festschreibung den Beleg ab:
            eine Schlussrechnung, die einen gestellten Abschlag nicht abzieht,
            verlangt das Geld zweimal.
          </p>
          <button
            type="submit"
            data-cse="abschlaege-abziehen"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
          >
            Abschläge abziehen
          </button>
        </form>
      )}

      {entwurf ? (
        <>
          {/*
            * **Der Regelweg: eine Zeile AUS der Zeiterfassung** (TIM-12,
            * FIN-07). Er steht VOR der Handeingabe, weil er der bessere ist —
            * die Stunden kommen aus freigegebenen Eintraegen, jeder einzelne
            * haengt anschliessend als Beleg unter der Zeile, und niemand kann
            * sich vertippen. Er erscheint nur, wenn die Rechnung einem Auftrag
            * zugeordnet ist: ohne Auftrag gibt es keine Leistungszeile, an der
            * Zeit haengen koennte.
            */}
          {daten.leistungen.length === 0 ? null : (
            <>
              <h2 className="mb-s3 text-h3 text-text">Zeile aus der Zeiterfassung</h2>
              <form
                method="post"
                action={`/api/rechnungen?mandant=${mandant}`}
                className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
              >
                <input type="hidden" name="aktion" value="aus-zeiten" />
                <input type="hidden" name="rechnungId" value={k.id} />
                <p className="max-w-prose text-sm text-text-muted">
                  Nimmt jeden freigegebenen und noch nicht abgerechneten
                  Zeiteintrag der gewählten Leistungszeile, bildet daraus
                  <strong className="text-text"> eine</strong> Zeile und hängt
                  jeden Eintrag als Beleg darunter. Die Menge wird genau einmal
                  gerundet, am Ende.
                </p>

                <label className="mt-s4 block text-sm text-text" htmlFor="zeitLeistung">
                  Leistungszeile des Auftrags
                </label>
                <select
                  id="zeitLeistung" name="auftragLeistungId" required className={feld}
                >
                  {daten.leistungen.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.position_nr}. {l.bezeichnung}
                    </option>
                  ))}
                </select>

                <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm text-text" htmlFor="zeitBezeichnung">
                      Handelsübliche Bezeichnung
                    </label>
                    <input
                      id="zeitBezeichnung" name="bezeichnung" type="text" required
                      defaultValue="Geleistete Stunden" className={feld}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="stundensatzCent">
                      Stundensatz (Cent)
                    </label>
                    <input
                      id="stundensatzCent" name="stundensatzCent" type="number" step="1"
                      required className={feld}
                    />
                    <p className="mt-s1 text-xs text-text-muted">4250 = 42,50 €</p>
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="vonDatum">
                      Von (Berliner Kalendertag)
                    </label>
                    <input id="vonDatum" name="vonDatum" type="date" className={feld} />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="bisDatum">
                      Bis (einschließlich)
                    </label>
                    <input id="bisDatum" name="bisDatum" type="date" className={feld} />
                  </div>
                  <div>
                    <label className="block text-sm text-text" htmlFor="zeitSteuergruppe">
                      Steuergruppe
                    </label>
                    <select
                      id="zeitSteuergruppe" name="steuergruppe" required className={feld}
                    >
                      {daten.gruppen.map((g) => (
                        <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
                >
                  Stunden übernehmen
                </button>
              </form>
            </>
          )}

          <h2 className="mb-s3 text-h3 text-text">Position hinzufügen</h2>
          <form
            method="post"
            action={`/api/rechnungen?mandant=${mandant}`}
            className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="position" />
            <input type="hidden" name="rechnungId" value={k.id} />

            <label className="block text-sm text-text" htmlFor="bezeichnung">
              Handelsübliche Bezeichnung
            </label>
            <input id="bezeichnung" name="bezeichnung" type="text" required className={feld} />

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                {/*
                  * Die Menge wird in TAUSENDSTELN eingegeben, der Preis in
                  * CENT. Beides sind ganze Zahlen — K-16 und Invariante 1 —
                  * und eine Umrechnung in der Oberflaeche waere genau die
                  * Gleitkommastelle, die diese Plattform nicht hat.
                  */}
                <label className="block text-sm text-text" htmlFor="menge">
                  Menge (Tausendstel)
                </label>
                <input id="menge" name="menge" type="number" step="1" required className={feld} />
                <p className="mt-s1 text-xs text-text-muted">30870 = 30,870</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einheit">Einheit</label>
                <select id="einheit" name="einheit" required className={feld}>
                  {daten.einheiten.map((e) => (
                    <option key={e.schluessel} value={e.schluessel}>
                      {e.bezeichnung}{e.ist_platzhalter ? ' — unbestätigter Wert' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="einzelpreisCent">
                  Einzelpreis (Cent)
                </label>
                <input
                  id="einzelpreisCent" name="einzelpreisCent" type="number" step="1" required
                  className={feld}
                />
                <p className="mt-s1 text-xs text-text-muted">1999 = 19,99 €</p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="steuergruppe">
                  Steuergruppe
                </label>
                <select id="steuergruppe" name="steuergruppe" required className={feld}>
                  {daten.gruppen.map((g) => (
                    <option key={g.schluessel} value={g.schluessel}>{g.bezeichnung}</option>
                  ))}
                </select>
              </div>
            </div>

            {/*
              * **Die Herkunft ist Pflicht** (FIN-07, §4.4). Es gibt genau zwei
              * Wege und keinen dritten: eine Vertragszeile als Beleg oder
              * ausdruecklich „von Hand" MIT Begruendung. Ein „ohne Angabe"
              * faende die Datenbank beim COMMIT — dann aber erst, nachdem
              * jemand das ganze Formular ausgefuellt hat.
              */}
            <fieldset className="mt-s5 rounded-md border border-line p-s4">
              <legend className="px-s2 text-sm text-text">Herkunft dieser Zeile</legend>
              {daten.leistungen.length === 0 ? (
                <input type="hidden" name="herkunft" value="manuell" />
              ) : (
                <>
                  <label className="block text-sm text-text" htmlFor="herkunft">Beleg</label>
                  <select id="herkunft" name="herkunft" defaultValue="vertrag" className={feld}>
                    <option value="vertrag">Vertragsposition des Auftrags</option>
                    <option value="manuell">Von Hand — mit Begründung</option>
                  </select>

                  <label className="mt-s4 block text-sm text-text" htmlFor="auftragLeistungId">
                    Vertragsposition
                  </label>
                  <select id="auftragLeistungId" name="auftragLeistungId" className={feld}>
                    {daten.leistungen.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.position_nr}. {l.bezeichnung}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label className="mt-s4 block text-sm text-text" htmlFor="herkunftNotiz">
                Begründung, falls von Hand erfasst
              </label>
              {/*
                * `required` genau dann, wenn es KEINE andere Herkunft gibt:
                * ohne Auftrag bleibt nur „von Hand", und dann ist die
                * Begründung die einzige Angabe, die die Zeile belegt. Mit
                * Auftrag steht sie daneben und wird nur für den Fall gebraucht,
                * dass jemand bewusst „von Hand" wählt — das kann HTML allein
                * nicht bedingen, und der Dienst weist es sauber ab.
                */}
              <input
                id="herkunftNotiz" name="herkunftNotiz" type="text" minLength={3}
                required={daten.leistungen.length === 0} className={feld}
              />
              <p className="mt-s1 text-xs text-text-muted">
                Eine Zeile ohne Beleg entsteht nicht — auch nicht versehentlich.
              </p>
            </fieldset>

            <button
              type="submit"
              className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
            >
              Position hinzufügen
            </button>
          </form>

          <div className="flex flex-wrap gap-s5">
            <form
              method="post"
              action={`/api/rechnungen/festschreiben?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Festschreiben</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                Vergibt die nächste Nummer aus dem Kreis dieser Gesellschaft und
                schreibt den Kettensatz — in derselben Transaktion.
                <strong className="text-text"> Danach ist der Beleg unveränderlich.</strong>
                {' '}Eine Korrektur ist dann ein Storno mit Neuausstellung.
              </p>

              {/*
                * **FIN-18 — blockierend, und sie fällt VOR der Nummer**
                * (Abnahme 3). Der Knopf bleibt bedienbar, aber die
                * Festschreibung weist ab, solange keine Begründung dasteht;
                * das ist der Unterschied zwischen einer Warnung, die man
                * wegklickt, und einer, die man beantwortet. Die Begründung
                * landet im Audit-Log und im Schnappschuss und ist danach
                * unveränderlich.
                */}
              {daten.fin18 === null ? null : (
                <div className="mt-s4 max-w-prose rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning">
                  <p>
                    <strong>Auftrag {daten.fin18.auftragsnummer}</strong> („
                    {daten.fin18.bezeichnung}") ist abgeschlossen, aber es ist
                    keine einzige Minute erfasst (FIN-18). Entweder fehlt die
                    Zeiterfassung, oder diese Rechnung gehört zu einem anderen
                    Auftrag.
                  </p>
                  <label className="mt-s3 block" htmlFor="fin18Begruendung">
                    Begründung, um trotzdem festzuschreiben (mind. zehn Zeichen)
                  </label>
                  <input
                    id="fin18Begruendung" name="fin18Begruendung" type="text" minLength={10}
                    className={feld}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={daten.positionen.length === 0}
                className="mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Rechnung festschreiben
              </button>
            </form>

            <form
              method="post"
              action={`/api/rechnungen/verwerfen?mandant=${mandant}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Verwerfen</h2>
              <p className="mt-s2 max-w-prose text-sm text-text-muted">
                Der Entwurf wird nicht gelöscht — er bleibt mit Grund stehen und
                kostet keine Nummer.
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="grund">Grund</label>
              <input id="grund" name="grund" type="text" required className={feld} />
              <button
                type="submit"
                className="mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                Entwurf verwerfen
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-s3 text-h3 text-text">Kettenbindung</h2>
          <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {k.hash === null ? 'Kein Kettensatz — das darf nicht vorkommen.' : (
              <>
                Position {k.kette_position} der Kette,{' '}
                <code className="break-all text-xs text-text">{k.hash}</code>
              </>
            )}
          </p>

          {k.status === 'festgeschrieben' && k.storniert_durch === null
           && !daten.darfStornieren ? (
             <p className="max-w-prose text-sm text-text-muted">
               Eine festgeschriebene Rechnung wird nicht geändert, sondern durch
               eine Stornobuchung aufgehoben. Dieses Konto hält das Recht
               <span className="text-text"> finanzen.stornieren </span>
               nicht — wer es hält, ist noch offen (O-77).
             </p>
           ) : null}

          {k.status === 'festgeschrieben' && k.storniert_durch === null
           && daten.darfStornieren ? (
            <form
              method="post"
              action={`/api/rechnungen/storno?mandant=${mandant}`}
              className="max-w-prose rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="rechnungId" value={k.id} />
              <h2 className="text-h3 text-text">Korrigieren</h2>
              <p className="mt-s2 text-sm text-text-muted">
                Eine festgeschriebene Rechnung wird nicht geändert. Die
                stornierende Buchung erzeugt einen eigenen Beleg mit eigener
                Nummer; die Neuausstellung einen zweiten.
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="stornogrund">
                Grund (mindestens zehn Zeichen, auditfähig)
              </label>
              <input
                id="stornogrund" name="grund" type="text" required minLength={10}
                className={feld}
              />
              <label className="mt-s4 block text-sm text-text" htmlFor="form">Form</label>
              <select id="form" name="form" defaultValue="korrektur" className={feld}>
                <option value="korrektur">Storno und Neuausstellung</option>
                <option value="nur_storno">Nur Storno</option>
              </select>
              <button
                type="submit"
                className="mt-s5 min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
              >
                Stornieren
              </button>
            </form>
          ) : null}
        </>
      )}
    </PortalRahmen>
  );
}

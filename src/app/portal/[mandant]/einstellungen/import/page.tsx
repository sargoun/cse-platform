import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { STAND_TEXT } from '@/server/registry/integrationen';
import {
  altsystemStand, ladeLaeufe, type LaufZeile,
} from '@/server/services/migration/uebernahme';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/import` — die Uebernahme aus Aplano,
 * Lexware und den Excel-Dateien (ROADMAP Phase 10, 07-INTEGRATIONEN §25.3,
 * O-128).
 *
 * **Diese Seite nimmt keine Datei an, und sie sagt warum.** O-128 ist
 * unbeantwortet: in welchem Format die drei Altsysteme exportieren, welcher
 * Zeitraum uebernommen wird, und ob die historischen Daten revisionssicher
 * ins GoBD-Archiv muessen. Ohne Format gibt es keinen Parser — und ein
 * geratener Parser ist bei § 17-MiLoG-Zeitnachweisen und GoBD-Rechnungen kein
 * Komfortfehler, sondern ein Compliance-Fehler. Ein Hochladefeld, das eine
 * Datei annimmt, die niemand lesen kann, waere eine vorgetaeuschte
 * Anbindung; der Port wirft stattdessen (CLAUDE.md „No fake integrations").
 *
 * **Was schon feststeht, steht hier** — nicht erst im Parser: Zeiten kommen
 * als historische Zeilen mit `quelle = 'migration'` und ohne
 * Serveruhr-Anspruch (Invariante 5), Rechnungen kommen als Beleg und nie in
 * einen Nummernkreis und nie in die Hashkette. Beides sind Zusagen, die der
 * Import einhalten MUSS, und sie hier zu lesen ist der Unterschied zwischen
 * einer offenen Frage und einer offenen Baustelle.
 *
 * **Der Zustand kommt aus dem Port** (`server/integrationen/migration.ts`),
 * also aus derselben Stelle, die eine Datei annehmen wuerde — nicht aus einer
 * zweiten Liste, die den Tag verpasst, an dem ein Parser dazukommt. Die
 * Laufliste kommt aus `migration_lauf` (0202): heute leer, und das sagt die
 * Tabelle, nicht ein fester Text.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILLE: Readonly<Record<LaufZeile['status'], PillZustand>> = {
  entwurf: 'Entwurf',
  geprueft: 'In Prüfung',
  uebernommen: 'Abgeschlossen',
  verworfen: 'Abgelehnt',
};

export default async function Import(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/import`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const laeufe = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeLaeufe(kontext)),
  ) as Promise<readonly LaufZeile[]>);
  const stand = altsystemStand(laeufe);
  const verbunden = stand.filter((s) => s.verbunden).length;

  return (
    <PortalRahmen
      titel="Übernahme aus Altsystemen"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Übernahme aus Altsystemen</h1>
      <p data-cse="import-zaehler" data-verbunden={String(verbunden)}
         data-anzahl={String(stand.length)}
         className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        {String(verbunden)} von {String(stand.length)} Quellen sind angebunden. Was nicht
        angebunden ist, wird nicht vorgetäuscht: es gibt kein Hochladefeld, und der
        Übernahmeweg lehnt jede Datei ab, statt einen Erfolg zu melden.
      </p>

      <Hinweis art="warnung" cse="import-o128" className="mb-s7 max-w-[72ch]">
        <strong>Der Übernahmeweg wartet auf eine Antwort, nicht auf Code (O-128).</strong>{' '}
        Offen ist: in welchem Format Aplano, Lexware und die bestehenden Excel-Dateien
        exportieren, welcher Zeitraum übernommen wird, und ob die historischen Daten
        revisionssicher ins GoBD-Archiv müssen oder die Aufbewahrung im Altsystem
        genügt. Ein geratener Parser ist hier kein Komfortfehler: Zeitnachweise nach
        § 17 MiLoG und Rechnungen nach GoBD sehen auch dann plausibel aus, wenn eine
        Spalte in die falsche gelaufen ist — und niemand findet die Stelle später.
      </Hinweis>

      <section aria-labelledby="quellen-titel" className="mb-s7">
        <h2 id="quellen-titel" className="mb-s3 text-h2 text-text">Die drei Quellen</h2>
        <div data-cse="import-quellen">
          <DataTable
            beschriftung="Altsysteme, ihr Anbindungszustand und die Regel, die beim Import gilt"
            zeilen={stand}
            schluessel={(s) => s.schluessel}
            spalten={[
              { schluessel: 'name', kopf: 'Quelle', zelle: (s) => s.name },
              { schluessel: 'umfang', kopf: 'Umfang', zelle: (s) => s.umfang },
              { schluessel: 'stand', kopf: 'Zustand',
                zelle: (s) => (
                  <span className="flex items-center gap-s2"
                        data-stand={s.verbunden ? 'verbunden' : 'nicht_verbunden'}>
                    <StatusPill zustand={s.verbunden ? 'Aktiv' : 'Inaktiv'} />
                    <span className="text-xs text-text-muted">
                      {s.verbunden ? STAND_TEXT.verbunden : STAND_TEXT.nicht_verbunden}
                    </span>
                  </span>
                ) },
              { schluessel: 'regel', kopf: 'Was beim Import gelten wird',
                zelle: (s) => <span className="text-sm text-text-muted">{s.regel}</span> },
              { schluessel: 'offen', kopf: 'Offene Frage',
                zelle: (s) => <code className="text-xs">{s.offen}</code> },
              { schluessel: 'laeufe', kopf: 'Läufe', numerisch: true,
                zelle: (s) => String(s.laeufe) },
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="laeufe-titel" className="mb-s7">
        <h2 id="laeufe-titel" className="mb-s3 text-h2 text-text">Übernahmeläufe</h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Ein Lauf entsteht mit einer Datei und ihrer Prüfsumme, wird geprüft und erst
          danach übernommen — Vorschau vor Übernahme, wie beim Raumbuch. Verworfen wird
          über den Zustand, nie durch Löschen: der Lauf ist der Nachweis, woher ein
          historischer Datensatz kommt.
        </p>
        {laeufe.length === 0 ? (
          <p data-cse="import-laeufe-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Lauf vorhanden. Das ist der erwartete Zustand, solange O-128 offen ist —
            die Tabelle existiert, der Weg dorthin nicht.
          </p>
        ) : (
          <div data-cse="import-laeufe">
            <DataTable
              beschriftung="Übernahmeläufe mit Quelle, Datei, Zustand und Zeilenzahlen"
              zeilen={[...laeufe]}
              schluessel={(l) => l.id}
              spalten={[
                { schluessel: 'quelle', kopf: 'Quelle', zelle: (l) => l.quelleName },
                { schluessel: 'datei', kopf: 'Datei',
                  zelle: (l) => (
                    <span>
                      {l.dateiName}
                      <code className="ml-s2 text-xs text-text-subtle">
                        {l.dateiSha256.slice(0, 12)}
                      </code>
                    </span>
                  ) },
                { schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (l) => <StatusPill zustand={STATUS_PILLE[l.status]} /> },
                { schluessel: 'gesamt', kopf: 'Zeilen', numerisch: true,
                  zelle: (l) => String(l.zeilenGesamt) },
                { schluessel: 'gueltig', kopf: 'gültig', numerisch: true,
                  zelle: (l) => String(l.zeilenGueltig) },
                { schluessel: 'fehlerhaft', kopf: 'fehlerhaft', numerisch: true,
                  zelle: (l) => (l.zeilenFehlerhaft === 0
                    ? '0'
                    : <span className="text-warning">{String(l.zeilenFehlerhaft)}</span>) },
                { schluessel: 'bemerkung', kopf: 'Bemerkung',
                  zelle: (l) => l.bemerkung ?? '—' },
                { schluessel: 'erstellt', kopf: 'Angelegt', zelle: (l) => l.erstelltAm },
              ]}
            />
          </div>
        )}
      </section>

      <Hinweis art="hinweis" cse="import-weg" className="max-w-[72ch]">
        <strong>Sobald das Format bekannt ist, ändert sich genau eine Stelle.</strong>{' '}
        <code>migrationPort()</code> gibt dann den echten Parser zurück statt des
        ablehnenden; Tabellen, Rechte und dieser Bildschirm bleiben, wie sie sind, und
        der Weg ist der bekannte: Datei mit Prüfsumme anlegen → Vorschau mit
        Fehlerbericht → Übernahme mit benanntem Menschen. Dieselbe Datei zweimal
        hochzuladen ist ein Nichtereignis — die Prüfsumme ist je Quelle eindeutig.
      </Hinweis>
    </PortalRahmen>
  );
}

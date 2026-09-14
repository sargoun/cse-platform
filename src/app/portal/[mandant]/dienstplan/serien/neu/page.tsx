import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { WOCHENTAGE } from '@/lib/datum/rrule';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/dienstplan/serien/neu` — eine Serie anlegen, und die
 * Schichten entstehen sofort (TIM-01, TIM-02, CLN-02, SEC-04, D-487).
 *
 * Reinigung: ein Turnus fuer ein Revier (Leistung, Wochentage, Beginn,
 * Dauer, Geltung, Feiertagsregel). Sicherheit: die Serie zu einem Posten,
 * der Dienstzeiten traegt — ein neuer Posten entsteht unter
 * Sicherheit → Posten. Bau und Operations planen nicht in Serien; die Seite
 * sagt es, statt ein leeres Formular zu zeigen.
 */
export const dynamic = 'force-dynamic';

const TAG_TEXT: Readonly<Record<string, string>> = {
  MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So',
};

interface Revier { readonly id: string; readonly bezeichnung: string; readonly objekt: string }
interface Leistung { readonly id: string; readonly oz: string; readonly kurztext: string }
interface Posten {
  readonly id: string; readonly bezeichnung: string; readonly objekt: string;
  readonly rrule: string; readonly beginn: string | null; readonly dauer: number | null; readonly serie: boolean;
}

export default async function SerieNeu({ params }: { params: Promise<{ mandant: string }> }) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/dienstplan/serien/neu`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const reviere = await kontext.abfrage<Revier>(
        `select r.id, r.bezeichnung, o.bezeichnung as objekt
           from revier r join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
          where r.archiviert_am is null and o.archiviert_am is null and o.kunde_id is not null
          order by o.bezeichnung, r.sortierung, r.bezeichnung`);
      const leistungen = await kontext.abfrage<Leistung>(
        `select id, oz, kurztext from leistungskatalog_position order by oz, kurztext limit 200`);
      const posten = await kontext.abfrage<Posten>(
        `select p.id, p.bezeichnung, o.bezeichnung as objekt, p.abdeckung_rrule as rrule,
                to_char(p.dtstart_lokal, 'HH24:MI') as beginn, p.dauer_minuten as dauer,
                exists (select 1 from planungsserie ps where ps.posten_id = p.id and ps.archiviert_am is null) as serie
           from posten p join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
          where p.archiviert_am is null and p.abdeckung_rrule is not null
          order by o.bezeichnung, p.bezeichnung`);
      return { heute: heute?.tag ?? '2026-01-01', reviere, leistungen, posten };
    })) as Promise<{ heute: string; reviere: readonly Revier[]; leistungen: readonly Leistung[]; posten: readonly Posten[] }>);

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const istReinigung = mandant === 'reinigung';
  const istSecurity = mandant === 'security';
  const offenePosten = daten.posten.filter((p) => !p.serie);

  return (
    <PortalRahmen
      titel="Neue Serie"
      wurzelTitel="Dienstplan"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Neue Serie</h1>
        <Link href={`/portal/${mandant}/dienstplan/serien`} className={knopf}>Zu den Serien</Link>
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Eine Serie beschreibt, wann eine Leistung wiederkehrt. Beim Anlegen entstehen die Schichten der
        nächsten acht Wochen sofort; danach schreibt der nächtliche Generator weiter. Wer die Schichten
        besetzt, entscheidet die Einteilung je Schicht — mit Qualifikations- und ArbZG-Prüfung.
      </p>

      {istReinigung ? (
        <form method="post" action="/api/dienstplan/serien" data-cse="serie-formular"
              className="flex max-w-form flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="art" value="turnus" />
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Revier</span>
            <select name="revier" required className={feld} data-cse="serie-revier">
              {daten.reviere.map((r) => <option key={r.id} value={r.id}>{r.objekt} · {r.bezeichnung}</option>)}
            </select>
            {daten.reviere.length === 0 ? (
              <span className="mt-s1 block text-xs text-warning">
                Kein Revier mit Kunde am Objekt — zuerst unter Reinigung → Reviere anlegen.
              </span>
            ) : null}
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Leistung (Katalogposition)</span>
            <select name="leistung" required className={feld} data-cse="serie-leistung">
              {daten.leistungen.map((l) => <option key={l.id} value={l.id}>{l.oz} · {l.kurztext}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">Bezeichnung</span>
            <input name="bezeichnung" required maxLength={120} className={feld} placeholder="Unterhaltsreinigung früh" />
          </label>
          <fieldset>
            <legend className="mb-s1 text-sm text-text">Wochentage</legend>
            <div className="flex flex-wrap gap-s3">
              {WOCHENTAGE.map((w) => (
                <label key={w} className="inline-flex min-h-11 items-center gap-s2 text-sm text-text">
                  <input type="checkbox" name="wochentag" value={w} defaultChecked={['MO', 'TU', 'WE', 'TH', 'FR'].includes(w)} />
                  {TAG_TEXT[w]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Beginn (Uhrzeit)</span>
              <input name="beginn" type="time" required defaultValue="06:00" className={feld} />
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Dauer (Minuten)</span>
              <input name="dauer" type="number" min={15} max={1440} step={15} required defaultValue={240} className={feld} />
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Gültig ab</span>
              <input name="gueltig_ab" type="date" required defaultValue={daten.heute} className={feld} />
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Gültig bis (leer = offen)</span>
              <input name="gueltig_bis" type="date" className={feld} />
            </label>
          </div>
          <label className="block">
            <span className="mb-s1 block text-sm text-text">An Berliner Feiertagen</span>
            <select name="feiertage" className={feld} defaultValue="ausfall">
              <option value="ausfall">fällt aus</option>
              <option value="unveraendert">findet statt</option>
            </select>
          </label>
          <div>
            <Button type="submit" variante="primary" data-cse="serie-anlegen">Serie anlegen und Schichten erzeugen</Button>
          </div>
        </form>
      ) : null}

      {istSecurity ? (
        <div className="flex max-w-form flex-col gap-s4">
          <form method="post" action="/api/dienstplan/serien" data-cse="serie-formular"
                className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="art" value="posten" />
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Posten mit Dienstzeiten</span>
              <select name="posten" required className={feld} data-cse="serie-posten">
                {offenePosten.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.objekt} · {p.bezeichnung} — {p.rrule}{p.beginn === null ? '' : `, ${p.beginn}`}{p.dauer === null ? '' : `, ${String(p.dauer)} min`}
                  </option>
                ))}
              </select>
              {offenePosten.length === 0 ? (
                <span className="mt-s1 block text-xs text-text-muted" data-cse="serie-kein-posten">
                  Jeder Posten mit Dienstzeiten hat schon eine Serie — oder es gibt noch keinen.
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">An Berliner Feiertagen</span>
              <select name="feiertage" className={feld} defaultValue="unveraendert">
                <option value="unveraendert">findet statt</option>
                <option value="ausfall">fällt aus</option>
              </select>
            </label>
            <div>
              <Button type="submit" variante="primary" data-cse="serie-anlegen" disabled={offenePosten.length === 0}>
                Serie anlegen und Schichten erzeugen
              </Button>
            </div>
          </form>
          <Hinweis art="hinweis" cse="serie-posten-hinweis" className="max-w-prose">
            Ein neuer Posten mit Dienstzeiten (Regel, Beginn, Dauer, Besetzung) entsteht unter{' '}
            <Link href={`/portal/${mandant}/security/posten/neu`} className="underline underline-offset-2">Sicherheit → Posten → Neu</Link>;
            mit Dienstzeiten bekommt er seine Serie und seine Schichten dort sofort.
          </Hinweis>
        </div>
      ) : null}

      {!istReinigung && !istSecurity ? (
        <Hinweis art="hinweis" cse="serie-nicht-hier" className="max-w-prose">
          <strong>Dieser Bereich plant nicht in Serien.</strong> Bauprojekte führen Bautage und Kolonnen je
          Projekt; Operations hat keinen Dienstplan. Schichten für Reinigung und Sicherheit entstehen in
          deren Bereich.
        </Hinweis>
      ) : null}
    </PortalRahmen>
  );
}

import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { AUFTRAG_TEXTE } from '@/lib/i18n/verwaltung/auftrag';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { PFLEGE_GESPERRT } from '@/server/services/auftrag/aendern';
import { waehlbareLeitungen, type LeitungsWahl } from '@/server/services/auftrag/angaben';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/auftraege/[id]/bearbeiten` — Stammdaten eines Auftrags
 * pflegen (V-173, OPS-05, OPS-10).
 *
 * **Warum eine eigene Seite und kein Formular auf dem Auftragsblatt.** Das
 * Blatt ist die Übersicht; wer dort nachschlägt, soll nicht in einem
 * Änderungsmodus stehen — dieselbe Begründung wie beim Objekt (V-020).
 *
 * **Was hier fehlt, fehlt mit Absicht:** Nummer, Kunde, Art, Start und Objekt.
 * Sie tragen Rechnungen, Einsätze und Leistungsnachweise; ein anderer
 * Vertragspartner oder Ort ist ein anderer Auftrag. Der Wert eines Auftrags
 * aus einem Angebot steht nur zum Lesen da — er ist `angebot.netto_cent`, und
 * eine Änderung des Vertragswerts ist ein Nachtrag.
 *
 * Zahlen erscheinen in deutscher Schreibweise und gehen so zurück: der
 * Dienst liest sie mit demselben Leser wie der Assistent.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'auftrag.schreiben';

interface Kopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly status: string;
  readonly angebotsnummer: string | null;
  readonly angebot_id: string | null;
  readonly verantwortlich: string;
  readonly verantwortlich_name: string | null;
  readonly laufzeit_bis: string | null;
  readonly wert: string | null;
  readonly personalbedarf: number | null;
  readonly wochenstunden: string | null;
  readonly ausstattung: string | null;
}

const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm '
  + 'text-text';

export default async function AuftragBearbeiten(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id: roh } = await params;
  const id = kennungOder404(roh);
  const pfad = `/portal/${mandant}/auftraege/${id}/bearbeiten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(AUFTRAG_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, 'auftrag.schreiben', 'auftrag.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const geladen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.auftragsnummer, a.bezeichnung, a.beschreibung,
                a.status::text as status, ang.angebotsnummer, a.angebot_id::text,
                a.verantwortlich_benutzer_id::text as verantwortlich,
                b.name as verantwortlich_name,
                to_char(a.laufzeit_bis, 'YYYY-MM-DD') as laufzeit_bis,
                a.auftragswert_netto_cent::text as wert,
                a.personalbedarf_anzahl as personalbedarf,
                a.wochenstunden_soll::text as wochenstunden,
                a.ausstattung_hinweis as ausstattung
           from auftrag a
           left join angebot ang on ang.id = a.angebot_id
           left join benutzer b on b.id = a.verantwortlich_benutzer_id
          where a.id = $1::uuid and a.archiviert_am is null`, [id]);
      // Dieselbe Frage wie Dienst und Auslöser (V-177): wer HEUTE Mitglied ist.
      const leitungen = await waehlbareLeitungen(kontext);
      return { kopf, leitungen };
    })) as Promise<{ kopf: Kopf | undefined; leitungen: readonly LeitungsWahl[] }>);

  if (geladen.kopf === undefined) notFound();
  const k = geladen.kopf;
  const gesperrt = PFLEGE_GESPERRT.includes(k.status);
  /*
   * Die aktuelle Leitung bleibt wählbar, auch wenn sie inzwischen nicht mehr
   * Mitglied ist — sonst stünde im Formular stillschweigend jemand anderes,
   * und „Speichern" hätte die Leitung gewechselt, ohne dass jemand es wollte.
   * Der Dienst prüft die Mitgliedschaft nur bei einem Wechsel (V-177); die
   * Zeile sagt, dass sie hier nicht mehr arbeitet.
   */
  const leitungAusgeschieden = !geladen.leitungen.some((b) => b.id === k.verantwortlich);
  const leitungen = leitungAusgeschieden
    ? [{ id: k.verantwortlich,
         name: t.leitungAusgeschieden(k.verantwortlich_name ?? '—') }, ...geladen.leitungen]
    : geladen.leitungen;
  const wertText = k.wert === null ? '' : formatiereGeld(cent(BigInt(k.wert))).replace(/\s*€$/u, '');
  const stundenText = k.wochenstunden === null
    ? '' : formatiereMenge(mengeAusPostgresOderNull(k.wochenstunden));

  return (
    <PortalRahmen
      titel={t.bearbeitenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['auftrag.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/auftraege/${id}`, text: t.zumAuftrag } }
        : {})}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{k.bezeichnung}</h1>
      <p className="mb-s5 mt-0 font-mono text-sm text-text-muted">{k.auftragsnummer}</p>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="auftrag-pflege-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.nichtGespeichert}</strong>
          {eigenerEintrag(t.fehler, fehler) ?? null}
        </Hinweis>
      )}

      {darf['auftrag.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : gesperrt ? (
        <Hinweis art="hinweis" cse="auftrag-gesperrt" className="max-w-prose">
          {t.gesperrt(t.zustand[k.status] ?? k.status)}
        </Hinweis>
      ) : (
        <form method="post" action="/api/auftrag/aendern" data-cse="auftrag-pflege"
              className="flex max-w-prose flex-col gap-s5">
          <input type="hidden" name="auftragId" value={k.id} />
          <input type="hidden" name="zurueck" value={pfad} />
          <p className="m-0 text-sm text-text-muted">{t.festBleibt}</p>

          <Card>
            <label className="block text-sm text-text" htmlFor="bezeichnung">
              {t.bezeichnung}
            </label>
            <input id="bezeichnung" name="bezeichnung" required defaultValue={k.bezeichnung}
                   className={FELD} />

            <label className="mt-s4 block text-sm text-text" htmlFor="verantwortlichBenutzerId">
              {t.leitung}
            </label>
            <select id="verantwortlichBenutzerId" name="verantwortlichBenutzerId" required
                    defaultValue={k.verantwortlich} className={FELD}>
              {leitungen.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <label className="mt-s4 block text-sm text-text" htmlFor="laufzeitBis">
              {t.laufzeitBis}
            </label>
            <input id="laufzeitBis" name="laufzeitBis" type="date"
                   defaultValue={k.laufzeit_bis ?? ''} className={FELD} />
            <p className="mt-s1 text-xs text-text-muted">{t.unbefristet}</p>
          </Card>

          <Card>
            <label className="block text-sm text-text" htmlFor="auftragswertNetto">
              {t.wert}
            </label>
            {k.angebot_id === null ? (
              <>
                <input id="auftragswertNetto" name="auftragswertNetto" inputMode="decimal"
                       defaultValue={wertText} data-cse="auftrag-wert" className={FELD} />
                <p className="mt-s1 text-xs text-text-muted">{t.wertHinweis}</p>
              </>
            ) : (
              <>
                {/* Mitgeschickt, damit der Dienst den Vergleich sieht — und nichts ändert. */}
                <input type="hidden" name="auftragswertNetto" value={wertText} />
                <p className="mt-s2 text-sm tabular-nums text-text" data-cse="auftrag-wert-fest">
                  {k.wert === null ? '—' : formatiereGeld(cent(BigInt(k.wert)))}
                </p>
                <p className="mt-s1 text-xs text-text-muted">
                  {t.wertAusAngebot(k.angebotsnummer ?? '—')}
                </p>
              </>
            )}

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="personalbedarfAnzahl">
                  {t.personalbedarf}
                </label>
                <input id="personalbedarfAnzahl" name="personalbedarfAnzahl"
                       inputMode="numeric" className={FELD}
                       defaultValue={k.personalbedarf === null ? '' : String(k.personalbedarf)} />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="wochenstundenSoll">
                  {t.wochenstunden}
                </label>
                <input id="wochenstundenSoll" name="wochenstundenSoll" inputMode="decimal"
                       defaultValue={stundenText} className={FELD} />
              </div>
            </div>

            <label className="mt-s4 block text-sm text-text" htmlFor="ausstattungHinweis">
              {t.ausstattung}
            </label>
            <textarea id="ausstattungHinweis" name="ausstattungHinweis" rows={2}
                      defaultValue={k.ausstattung ?? ''}
                      className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />

            <label className="mt-s4 block text-sm text-text" htmlFor="beschreibung">
              {t.beschreibung}
            </label>
            <textarea id="beschreibung" name="beschreibung" rows={3}
                      defaultValue={k.beschreibung ?? ''}
                      className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
          </Card>

          <div>
            <Button type="submit" variante="primary" data-cse="auftrag-speichern">
              {t.speichern}
            </Button>
          </div>
        </form>
      )}
    </PortalRahmen>
  );
}

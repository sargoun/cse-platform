import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '../../../rechte';
import { Hinweis } from '@/components/ui/Hinweis';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { AUFTRAG_TEXTE } from '@/lib/i18n/verwaltung/auftrag';

/**
 * `/portal/[mandant]/auftraege/neu` — der Auftragsassistent (OPS-10).
 *
 * OPS-10 zaehlt auf, was ein neuer Vertrag SICHTBAR machen muss: Ort,
 * Personalbedarf, Stunden, Ausstattung, Startdatum, verantwortliche Leitung.
 * Diese Seite fragt genau das — in EINEM Formular und nicht in fuenf
 * Schritten: ein Assistent, der die Frage nach dem Personalbedarf auf Seite
 * vier versteckt, bekommt sie auf Seite vier auch nicht beantwortet.
 *
 * **Nichts wird geraten.** Kein vorausgefuellter Personalbedarf, keine
 * geschaetzten Wochenstunden. Eine Zahl, die der Assistent erfindet,
 * hinterfragt spaeter niemand mehr.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }
interface ObjektAuswahl { readonly id: string; readonly name: string;
  readonly kunde_id: string | null }

export default async function AuftragAssistent(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /*
   * Die Abweisung des Assistenten kommt als Schlüssel zurück (V-172, D-599)
   * — nicht mehr als weisse JSON-Seite.
   */
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/auftraege` verlangt laut Manifest `auftrag.lesen`; dieser Assistent
   * oeffnet mit `auftrag.schreiben`. Wer anlegen darf, darf die Liste
   * nicht zwangslaeufig lesen — der Rueckverweis fuehrte dann auf 404 und
   * verriet, was er nicht zeigen darf (AUT-06, Copilot-Runde auf PR 16 /
   * D-581).
   */
  const darf = await haeltRechte(sitzung, 'auftrag.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kunden: await kontext.abfrage<Auswahl>(
        `select id, name from kunde where archiviert_am is null order by name`),
      objekte: await kontext.abfrage<ObjektAuswahl>(
        `select id, bezeichnung as name, kunde_id from objekt
          where archiviert_am is null order by bezeichnung`),
      leitungen: await kontext.abfrage<Auswahl>(
        `select b.id, b.name from benutzer b
           join benutzer_mandant bm on bm.benutzer_id = b.id
          where bm.mandant_id = app.aktiver_mandant() and b.status = 'aktiv'
          order by b.name`),
    }))) as Promise<{
      kunden: readonly Auswahl[]; objekte: readonly ObjektAuswahl[];
      leitungen: readonly Auswahl[];
    }>);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const ta = nachSprache(AUFTRAG_TEXTE, zugang.sprache);

  return (
    <PortalRahmen
      titel="Neuer Auftrag"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['auftrag.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/auftraege`, text: 'Alle Aufträge' } }
        : {})}
    >
      <h1 className="mb-s5 text-h1 text-text">Neuer Auftrag</h1>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="auftrag-neu-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{ta.nichtAngelegt}</strong>
          {ta.fehler[fehler] ?? ta.nichtGespeichert}
        </Hinweis>
      )}

      {daten.kunden.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Ohne Kunden kein Auftrag. Zuerst einen Kunden anlegen.
        </p>
      ) : (
        <form
          method="post"
          action="/api/auftrag"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <label className="block text-sm text-text" htmlFor="kundeId">Kunde</label>
          <select id="kundeId" name="kundeId" required className={feld}>
            {daten.kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="objektId">
            Ort (Objekt)
          </label>
          <select id="objektId" name="objektId" className={feld}>
            <option value="">— ohne festen Ort (Rahmenvertrag) —</option>
            {daten.objekte.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
            Bezeichnung
          </label>
          <input id="bezeichnung" name="bezeichnung" type="text" required className={feld} />

          <label className="mt-s4 block text-sm text-text" htmlFor="art">Art</label>
          <select id="art" name="art" defaultValue="rahmenvertrag" className={feld}>
            <option value="einzelauftrag">Einzelauftrag</option>
            <option value="rahmenvertrag">Rahmenvertrag</option>
            <option value="dauerauftrag">Dauerauftrag</option>
            <option value="projekt">Projekt</option>
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="verantwortlichBenutzerId">
            Verantwortliche Leitung
          </label>
          <select
            id="verantwortlichBenutzerId"
            name="verantwortlichBenutzerId"
            required
            className={feld}
          >
            {daten.leitungen.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="startDatum">Start</label>
              <input id="startDatum" name="startDatum" type="date" required className={feld} />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="laufzeitBis">
                Laufzeit bis
              </label>
              <input id="laufzeitBis" name="laufzeitBis" type="date" className={feld} />
              <p className="mt-s1 text-xs text-text-muted">leer = unbefristet</p>
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="personalbedarfAnzahl">
                Personalbedarf (Personen)
              </label>
              <input
                id="personalbedarfAnzahl"
                name="personalbedarfAnzahl"
                type="number"
                min="0"
                step="1"
                className={feld}
              />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="wochenstundenSoll">
                Wochenstunden
              </label>
              <input
                id="wochenstundenSoll"
                name="wochenstundenSoll"
                type="text"
                inputMode="decimal"
                className={feld}
              />
            </div>
          </div>

          <label className="mt-s4 block text-sm text-text" htmlFor="ausstattungHinweis">
            Ausstattung
          </label>
          <textarea id="ausstattungHinweis" name="ausstattungHinweis" rows={2}
                    className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />

          <label className="mt-s4 block text-sm text-text" htmlFor="beschreibung">
            Beschreibung
          </label>
          <textarea id="beschreibung" name="beschreibung" rows={3}
                    className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />

          <p className="mt-s4 text-xs text-text-muted">
            Personalbedarf und Wochenstunden bleiben leer, wenn Sie sie nicht
            eintragen — es wird nichts geschätzt. Eine Zahl, die hier
            entstünde, ohne dass jemand sie gesetzt hat, hinterfragt später
            niemand mehr.
          </p>

          <button
            type="submit"
            data-cse="auftrag-anlegen"
            className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            Auftrag anlegen
          </button>
        </form>
      )}
    </PortalRahmen>
  );
}

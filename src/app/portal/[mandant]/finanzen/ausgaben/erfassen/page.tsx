import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { AUSGABE_ERFASSEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/ausgabe-erfassen';
import {
  kassen, kategorien, steuergruppen,
  type KasseZeile, type Kategorie, type Steuergruppe,
} from '@/server/services/finanz/ausgabe';

/**
 * `/portal/[mandant]/finanzen/ausgaben/erfassen` — eine Ausgabe erfassen
 * (V-011, FIN-14, FIN-17, ACC-01, ACC-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Seite fehlte — und was das im Betrieb hiess.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0180` baut die Tabelle vollständig: vier Zustände, ein Übergangsauslöser,
 * die Belegpflicht ab `freigegeben`, die Unveränderlichkeit ab `gebucht`, die
 * Steueraufteilung je Satzgruppe. Zwei Seiten lasen das alles und zeigten es.
 *
 * **Schreiben konnte es niemand.** Eine Tankquittung, eine Parkgebühr,
 * Material aus dem Baumarkt — im Betrieb der häufigste Beleg überhaupt —
 * liess sich nicht erfassen. Nicht weil etwas fehlte, sondern weil zwischen
 * Tabelle und Oberfläche kein Dienst stand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Das Formular verlangt NETTO je Satz, und das ist eine Zumutung mit
 * Grund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Auf dem Kassenbon steht beides, und abgetippt wird das Netto. Aus dem
 * Bruttobetrag allein liesse sich der Satz nicht zurückrechnen, ohne einen
 * Mischsatz zu erfinden — und Invariante 1 verbietet ihn: die Umsatzsteuer
 * entsteht je Steuersatzgruppe. Ein Bon mit Kraftstoff zu 19 % und
 * Verpflegung zu 7 % ist der gewöhnliche Fall, nicht die Ausnahme.
 *
 * Die Steuer selbst rechnet `anteilInBasisPunkten` — eine geprüfte Funktion,
 * keine Zeile in dieser Datei (Invariante 6).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ausgabe erfassen — Finanzen' };

const RECHT = 'eingang.schreiben';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

/** Drei Zeilen — ein Bon mit mehr als drei Sätzen ist die seltene Ausnahme. */
const STEUERZEILEN = [0, 1, 2] as const;

interface Auswahl { readonly id: string; readonly text: string }

export default async function AusgabeErfassen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/ausgaben/erfassen`;
  const liste = `/portal/${mandant}/finanzen/ausgaben`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(AUSGABE_ERFASSEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      kategorien: await kategorien(kontext),
      gruppen: await steuergruppen(kontext),
      kassen: await kassen(kontext),
      /*
       * Nur Belege OHNE Ausgabe: ein Beleg, der schon an einer Zeile hängt,
       * ein zweites Mal angehängt hiesse, denselben Aufwand zweimal zu
       * buchen. Die Datenbank hält das nicht — hier ist es billiger.
       */
      belege: await kontext.abfrage<Auswahl>(
        `select b.id, coalesce(b.belegnummer, to_char(b.belegdatum, 'DD.MM.YYYY'),
                               b.typ::text) as text
           from beleg b
          where b.mandant_id = app.aktiver_mandant()
            and not exists (select 1 from ausgabe a where a.beleg_id = b.id)
          order by b.eingegangen_am desc
          limit 100`),
      objekte: await kontext.abfrage<Auswahl>(
        `select id, objektnummer || ' · ' || bezeichnung as text from objekt
          where mandant_id = app.aktiver_mandant() and archiviert_am is null
          order by objektnummer limit 300`),
      auftraege: await kontext.abfrage<Auswahl>(
        `select id, auftragsnummer || ' · ' || bezeichnung as text from auftrag
          where mandant_id = app.aktiver_mandant() and status <> 'abgeschlossen'
          order by auftragsnummer desc limit 300`),
      projekte: await kontext.abfrage<Auswahl>(
        `select id, nummer || ' · ' || bezeichnung as text from projekt
          where mandant_id = app.aktiver_mandant()
          order by nummer desc limit 300`),
    }))) as Promise<{
      kategorien: readonly Kategorie[]; gruppen: readonly Steuergruppe[];
      kassen: readonly KasseZeile[]; belege: readonly Auswahl[];
      objekte: readonly Auswahl[]; auftraege: readonly Auswahl[];
      projekte: readonly Auswahl[];
    }>);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: liste, text: t.abbrechen }}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="ausgabe-warum" className="mb-s6 max-w-prose">
        {t.warum}
      </Hinweis>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="ausgabe-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? fehler}
        </Hinweis>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : daten.kategorien.length === 0 ? (
        <Hinweis art="warnung" cse="keine-kategorien" className="max-w-prose">
          <strong className="block">{t.keineKategorien}</strong>
          {t.keineKategorienErklaerung}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/finanzen/ausgaben"
                data-cse="ausgabe-formular"
                className="flex max-w-[64ch] flex-col gap-s5">
            <input type="hidden" name="aktion" value="erfassen" />
            <input type="hidden" name="zurueck" value={liste} />
            <input type="hidden" name="fehlerweg" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.bezeichnung}
              <input type="text" name="bezeichnung" required maxLength={200}
                     className={FELD} placeholder={t.bezeichnungBeispiel}
                     data-cse="ausgabe-bezeichnung" />
            </label>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-[2] flex-col gap-s2 text-sm text-text">
                {t.kategorie}
                <select name="kategorie" required className={FELD} defaultValue=""
                        data-cse="ausgabe-kategorie">
                  <option value="" disabled>{t.kategorieWaehlen}</option>
                  {daten.kategorien.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.bezeichnung}{k.istPlatzhalter ? ` ${t.kategoriePlatzhalter}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.ausgabedatum}
                <input type="date" name="ausgabedatum" required className={FELD}
                       data-cse="ausgabe-datum" />
                <span className="text-xs text-text-muted">{t.ausgabedatumErklaerung}</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.zahlungsmittel}
                <select name="zahlungsmittel" required className={FELD}
                        defaultValue="ueberweisung" data-cse="ausgabe-zahlungsmittel">
                  {Object.entries(t.zahlungsmittelListe).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.kasse}
                <select name="kasse" className={FELD} defaultValue=""
                        data-cse="ausgabe-kasse">
                  <option value="">{t.ohne}</option>
                  {daten.kassen.map((k) => (
                    <option key={k.id} value={k.id}>{k.bezeichnung}</option>
                  ))}
                </select>
                <span className="text-xs text-text-muted">
                  {daten.kassen.length === 0 ? t.keineKasse : t.kasseErklaerung}
                </span>
              </label>
            </div>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">{t.steuer}</legend>
              <p className="m-0 mb-s3 max-w-prose text-xs text-text-muted">
                {t.steuerErklaerung}
              </p>
              <div className="flex flex-col gap-s3">
                {STEUERZEILEN.map((i) => (
                  <div key={i} className="flex flex-wrap items-end gap-s3">
                    <label className="flex min-w-0 flex-[2] flex-col gap-s2 text-xs text-text-muted">
                      {t.steuerGruppe}
                      <select name="steuer_gruppe" className={FELD}
                              defaultValue={i === 0 ? (daten.gruppen[0]?.schluessel ?? '') : ''}
                              data-cse={`ausgabe-steuer-gruppe-${String(i)}`}>
                        <option value="">{t.steuerZeileLeer}</option>
                        {daten.gruppen.map((g) => (
                          <option key={g.schluessel} value={g.schluessel}>
                            {g.bezeichnung}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-s2 text-xs text-text-muted">
                      {t.steuerNetto}
                      {/*
                        * `type=’text’` und `inputMode=’decimal’`: ein
                        * `type=’number’` verlangt den PUNKT als Dezimalzeichen
                        * und wirft ein deutsches „82,50“ still weg — das Feld
                        * wäre leer, und niemand sähe warum. Gelesen wird es
                        * von `parseGeld`.
                        */}
                      <input type="text" inputMode="decimal" name="steuer_netto"
                             className={`${FELD} tabular-nums`} placeholder="0,00"
                             data-cse={`ausgabe-steuer-netto-${String(i)}`} />
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.beleg}
              <select name="beleg" className={FELD} defaultValue=""
                      data-cse="ausgabe-beleg">
                <option value="">{t.ohneBeleg}</option>
                {daten.belege.map((b) => (
                  <option key={b.id} value={b.id}>{b.text}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t.belegErklaerung}</span>
            </label>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-s2 text-sm font-semibold text-text">{t.zuordnung}</legend>
              <p className="m-0 mb-s3 max-w-prose text-xs text-text-muted">
                {t.zuordnungErklaerung}
              </p>
              <div className="flex flex-wrap gap-s3">
                <label className="flex min-w-0 flex-1 flex-col gap-s2 text-xs text-text-muted">
                  {t.objekt}
                  <select name="objekt" className={FELD} defaultValue=""
                          data-cse="ausgabe-objekt">
                    <option value="">{t.ohne}</option>
                    {daten.objekte.map((o) => (
                      <option key={o.id} value={o.id}>{o.text}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-s2 text-xs text-text-muted">
                  {t.auftrag}
                  <select name="auftrag" className={FELD} defaultValue=""
                          data-cse="ausgabe-auftrag">
                    <option value="">{t.ohne}</option>
                    {daten.auftraege.map((a) => (
                      <option key={a.id} value={a.id}>{a.text}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-s2 text-xs text-text-muted">
                  {t.projekt}
                  <select name="projekt" className={FELD} defaultValue=""
                          data-cse="ausgabe-projekt">
                    <option value="">{t.ohne}</option>
                    {daten.projekte.map((p) => (
                      <option key={p.id} value={p.id}>{p.text}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-s3 flex min-h-11 items-start gap-s2 text-sm text-text">
                <input type="checkbox" name="weiterberechenbar" value="ja"
                       className="mt-s2 h-4 w-4 accent-[var(--farbe-brand)]"
                       data-cse="ausgabe-weiterberechenbar" />
                <span>
                  {t.weiterberechenbar}
                  <span className="block text-xs text-text-muted">
                    {t.weiterberechenbarErklaerung}
                  </span>
                </span>
              </label>
            </fieldset>

            <div>
              <Button type="submit" variante="primary" data-cse="ausgabe-speichern">
                {t.speichern}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}

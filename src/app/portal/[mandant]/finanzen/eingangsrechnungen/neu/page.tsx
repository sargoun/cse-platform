import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { EINGANGSRECHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/eingangsrechnungen';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen/neu` — erfassen (FIN-14,
 * ACC-03, ACC-05).
 *
 * **Zwei Wege zum Beleg, und beide sind echt.** Eine Rechnung kommt als PDF
 * per Mail (dann wird sie hier hochgeladen) oder sie liegt bereits im Archiv,
 * weil sie über Scan oder Postfach hereinkam (dann wird sie ausgewählt).
 * ACC-05 nennt vier Eingangswege; die Maske erfindet keinen fünften und
 * verschweigt keinen der vorhandenen.
 *
 * **Ohne Belegspeicher wird NICHTS gespeichert.** Ist kein Speicher
 * konfiguriert, sagt die Route das und legt keine Zeile an — eine
 * Eingangsrechnung ohne ihr Dokument wäre nach ACC-03 kein Beleg, sondern
 * eine Behauptung.
 *
 * **Die Dublettenwarnung kommt vor dem Speichern.** Die Route prüft
 * (Lieferant, Nummer, Jahr) und weist mit der vorhandenen Belegnummer ab,
 * statt eine zweite Zahlung entstehen zu lassen. Es gibt kein „trotzdem":
 * dieselbe Rechnung zweimal zu bezahlen ist genau der Schaden, den der Riegel
 * verhindert.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }
interface BelegAuswahl { readonly id: string; readonly bezeichnung: string }
interface GruppeAuswahl { readonly schluessel: string; readonly bezeichnung: string }

/** Die Vorbelegung aus einem Vorschlag (`?von=<freigabe>`) — Zeichenketten fuer Felder, nie Zahlen. */
interface Vorbelegung {
  readonly freigabeId: string;
  readonly titel: string;
  readonly lieferantId: string;
  readonly rechnungsnummer: string;
  readonly rechnungsdatum: string;
  readonly leistungsdatum: string;
  readonly faelligAm: string;
  readonly netto: string;
  readonly steuer: string;
  readonly steuergruppe: string;
  readonly belegId: string;
}

/** `119000` → `1190,00` — die Form, die `parseGeld` liest; keine Tausenderpunkte. */
function euroFeld(c: unknown): string {
  if (typeof c !== 'number' || !Number.isSafeInteger(c)) return '';
  const abs = Math.abs(c);
  return `${c < 0 ? '-' : ''}${String(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export default async function NeueEingangsrechnung(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/eingangsrechnungen/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(EINGANGSRECHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const vonRoh = typeof suche['von'] === 'string' && UUID.test(suche['von']) ? suche['von'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      /*
       * Die Vorbelegung aus einem E-Rechnungs-Vorschlag (PR 63): die Werte der
       * Nutzlast als Zeichenketten in die Felder — der Mensch prueft, aendert,
       * erfasst. Der Beleg des Vorschlags wird uebernommen, damit die Datei
       * nicht zweimal abgelegt wird. Ohne `freigabe.lesen` gibt es keine Zeile
       * und damit keine Vorbelegung; die Maske bleibt leer und sagt nichts Falsches.
       */
      vorbelegung: vonRoh === null ? null : (await kontext.abfrage<{
        id: string; titel: string | null; p: Record<string, unknown> | null;
      }>(
        `select id, titel, vorschau_payload as p from freigabe
          where id = $1::uuid and aktion = 'eingangsrechnung_uebernehmen'`, [vonRoh]))
        .map((z): Vorbelegung | null => {
          const p = z.p ?? {};
          const zeilen = Array.isArray(p['steuerzeilen']) ? (p['steuerzeilen'] as Record<string, unknown>[]) : [];
          const erste = zeilen[0] ?? {};
          return {
            freigabeId: z.id,
            titel: z.titel ?? t.vorschlag,
            lieferantId: typeof p['lieferantId'] === 'string' ? p['lieferantId'] : '',
            rechnungsnummer: typeof p['rechnungsnummer'] === 'string' ? p['rechnungsnummer'] : '',
            rechnungsdatum: typeof p['rechnungsdatum'] === 'string' ? p['rechnungsdatum'] : '',
            leistungsdatum: typeof p['leistungBis'] === 'string' ? p['leistungBis']
              : typeof p['leistungVon'] === 'string' ? p['leistungVon'] : '',
            faelligAm: typeof p['faelligAm'] === 'string' ? p['faelligAm'] : '',
            netto: euroFeld(p['nettoCent']),
            steuer: euroFeld(p['steuerCent']),
            steuergruppe: typeof erste['steuergruppe'] === 'string' ? erste['steuergruppe'] : '',
            belegId: typeof p['belegId'] === 'string' ? p['belegId'] : '',
          };
        })[0] ?? null,
      lieferanten: await kontext.abfrage<Auswahl>(
        `select id, name from lieferant where archiviert_am is null order by name`),
      /*
       * Nur Belege, an denen noch keine Eingangsrechnung hängt: ein Beleg,
       * der schon einer gehört, ein zweites Mal angeboten, ist die Einladung
       * zur Doppelerfassung.
       */
      belege: await kontext.abfrage<BelegAuswahl>(
        `select b.id,
                coalesce(b.belegnummer, to_char(b.eingegangen_am, 'DD.MM.YYYY'))
                  || ' · ' || b.typ::text as bezeichnung
           from beleg b
          where b.typ = 'eingangsrechnung'
            and not exists (select 1 from eingangsrechnung er
                             where er.beleg_id = b.id and er.mandant_id = b.mandant_id)
          order by b.eingegangen_am desc
          limit 50`),
      gruppen: await kontext.abfrage<GruppeAuswahl>(
        `select schluessel, bezeichnung from steuersatz_gruppe
          where gueltig_bis is null order by satz_bp desc, schluessel`),
    }))) as Promise<{
      vorbelegung: Vorbelegung | null;
      lieferanten: readonly Auswahl[]; belege: readonly BelegAuswahl[];
      gruppen: readonly GruppeAuswahl[];
    }>);
  const v = daten.vorbelegung;

  const hinweis = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={t.erfassenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label={g.zurueck} className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {t.titel}
        </Link>
      </nav>

      <h1 className="mb-s5 text-h1 text-text">{t.erfassenTitel}</h1>

      {/*
        * **Der E-Rechnungs-Weg zuerst** (ACC-05, PR 63): XRechnung (XML) oder
        * ZUGFeRD (PDF mit factur-x.xml). Daraus wird KEINE Rechnung, sondern
        * ein Vorschlag im Freigabe-Posteingang — mit jedem Feld, seiner
        * Quelle und seiner Pruefung. Ein gescanntes PDF ohne XML bleibt beim
        * Formular darunter: die Belegerkennung hat keinen Anbieter (O-135),
        * und die Maske sagt das, statt zu raten.
        */}
      <form
        method="post"
        action={`/api/finanzen/eingangsrechnungen?mandant=${mandant}`}
        encType="multipart/form-data"
        data-cse="erechnung-formular"
        className="mb-s6 max-w-prose rounded-lg border border-line bg-surface-2 p-s5"
      >
        <input type="hidden" name="aktion" value="erechnung" />
        <h2 className="text-h3 text-text">{t.erechnungTitel}</h2>
        <p className="mt-s2 text-sm text-text-muted">
          {t.erechnungErklaerung}
        </p>
        <label className="mt-s3 block text-sm text-text" htmlFor="erechnung">
          {t.erechnungDatei}
        </label>
        <input
          id="erechnung" name="datei" type="file" required
          accept=".xml,application/xml,text/xml,application/pdf" className={feld}
        />
        <button
          type="submit" data-cse="erechnung-einlesen"
          className="mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          {t.erechnungKnopf}
        </button>
      </form>

      {v !== null ? (
        <p data-cse="vorbelegung-hinweis"
           className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          {t.vorbelegtVor} <strong className="text-text">{v.titel}</strong>{t.vorbelegtNach}
        </p>
      ) : null}

      {hinweis === null ? null : (
        <p
          role="alert"
          data-cse="eingang-hinweis"
          className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          {meldung ?? hinweis}
        </p>
      )}

      {daten.lieferanten.length === 0 ? (
        <p className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {t.keinLieferantAngelegt}
        </p>
      ) : null}

      <form
        method="post"
        action={`/api/finanzen/eingangsrechnungen?mandant=${mandant}`}
        encType="multipart/form-data"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-semibold text-text">{t.belegLegende}</legend>

          <label className="mt-s3 block text-sm text-text" htmlFor="datei">
            {t.pdfHochladen}
          </label>
          <input
            id="datei" name="datei" type="file" accept="application/pdf" className={feld}
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="belegId">
            {t.belegWaehlen}
          </label>
          <select id="belegId" name="belegId" className={feld} defaultValue={v?.belegId ?? ''}>
            <option value="">{g.keineAuswahl}</option>
            {v !== null && v.belegId !== '' && !daten.belege.some((b) => b.id === v.belegId) ? (
              <option value={v.belegId}>{t.belegDesVorschlags}</option>
            ) : null}
            {daten.belege.map((b) => (
              <option key={b.id} value={b.id}>{b.bezeichnung}</option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">
            {t.einesVonBeidem}
          </p>
        </fieldset>

        <hr className="my-s5 border-line" />

        <label className="block text-sm text-text" htmlFor="lieferantId">{t.lieferant}</label>
        <select id="lieferantId" name="lieferantId" required className={feld}
                defaultValue={v?.lieferantId ?? ''}>
          {/* Ein Vorschlag OHNE Zuordnung waehlt keinen Lieferanten vor: die Maske
              behauptet nicht den ersten der Liste, sie fragt. */}
          {v !== null && v.lieferantId === '' ? (
            <option value="">{t.bitteWaehlen}</option>
          ) : null}
          {daten.lieferanten.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-text" htmlFor="rechnungsnummer">
              {t.rechnungsnummerLieferant}
            </label>
            <input id="rechnungsnummer" name="rechnungsnummer" type="text" required
              defaultValue={v?.rechnungsnummer ?? ''} className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="rechnungsdatum">
              {t.rechnungsdatum}
            </label>
            <input id="rechnungsdatum" name="rechnungsdatum" type="date" required
              defaultValue={v?.rechnungsdatum ?? ''} className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="leistungsdatum">
              {t.leistungsdatum}
            </label>
            <input id="leistungsdatum" name="leistungsdatum" type="date"
              defaultValue={v?.leistungsdatum ?? ''} className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="faelligAm">
              {t.faelligAm}
            </label>
            <input id="faelligAm" name="faelligAm" type="date"
              defaultValue={v?.faelligAm ?? ''} className={feld} />
          </div>
        </div>

        <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-3">
          <div>
            <label className="block text-sm text-text" htmlFor="netto">{t.nettoInEuro}</label>
            <input id="netto" name="netto" type="text" inputMode="decimal" required
              placeholder="1000,00" defaultValue={v?.netto ?? ''} className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="steuer">
              {t.umsatzsteuerInEuro}
            </label>
            <input id="steuer" name="steuer" type="text" inputMode="decimal" required
              placeholder="190,00" defaultValue={v?.steuer ?? ''} className={feld} />
          </div>
          <div>
            <label className="block text-sm text-text" htmlFor="steuergruppe">{t.steuersatz}</label>
            {/*
              * Die Schlüssel kommen aus `steuersatz_gruppe` und werden hier
              * NICHT erfunden: `ust_0_13b_bau` und `ust_0_13b_reinigung` sind
              * zwei verschiedene Fälle des §13b (Abs. 2 Nr. 4 gegen Nr. 8),
              * und eine Maske, die sie zu „§13b" zusammenzieht, liesse den
              * Erfassenden den falschen wählen.
              */}
            <select id="steuergruppe" name="steuergruppe" required className={feld}
                    defaultValue={v?.steuergruppe ?? ''}>
              {daten.gruppen.map((gruppe) => (
                <option key={gruppe.schluessel} value={gruppe.schluessel}>
                  {gruppe.bezeichnung}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-s1 max-w-prose text-xs text-text-muted">
          {t.bruttoHinweis}
        </p>

        <button
          type="submit"
          className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          {t.erfassen}
        </button>
      </form>
    </PortalRahmen>
  );
}

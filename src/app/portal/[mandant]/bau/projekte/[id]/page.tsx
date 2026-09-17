import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { findeProjektDetail, type ProjektDetailZeile } from '@/server/services/bau/lv';
import { ladeProjektMarge, type ProjektMarge } from '@/server/services/bau/uebersicht';
import { ladeAusserhalbLv, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { AusserhalbLvWarnungen } from '../../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/bau/projekte/[id]` — das Bauprojekt (OPS-05, REP-05,
 * Seitenkarte §5.9).
 *
 * **Die Vertragsgrundlage steht gross da, und das ist keine Typografie.**
 * VOB/B oder BGB entscheidet über Nachtragsanspruch (§ 2 VOB/B gegen § 650b/c
 * BGB), Behinderung (§ 6), Abnahme (§ 12) und Gewährleistungsfrist (4 gegen 5
 * Jahre) — also über alle vier Vorgänge, die von dieser Seite abgehen. Wer die
 * falsche annimmt, führt vier Vorgänge nach dem falschen Gesetz.
 *
 * **Geld erscheint hier auf ZWEI Wegen, mit zwei Rechten, und beide Wege sind
 * vorsichtig:**
 *
 *  - Die **Auftragssumme** und der **Sicherheitseinbehalt** kommen über
 *    `app.projekt_summe_lesen` (0213) und verlangen `bau.preis_lesen`. Ein
 *    direkter `select` auf die Spalten scheitert hart mit „permission denied
 *    for table projekt": 0089 hat das Tabellenrecht ganz entzogen und eine
 *    erschöpfende Spaltenliste ohne sie erteilt. Ohne das Recht steht hier der
 *    Satz und nie eine 0 €.
 *  - Die **Marge** kommt aus `app.projekt_kennzahlen` und verlangt
 *    `kalkulation.lesen` — ein ANDERES Recht, weil es die eigene Kostenseite
 *    ist und nicht die Vertragssumme des Kunden. Die Funktion WIRFT, wenn das
 *    Recht fehlt; deshalb wird es vorher in SQL gefragt und die Funktion nur
 *    dann gerufen. Eine Ausnahme in der einen gebundenen Transaktion dieser
 *    Seite bräche sie ganz ab, statt einen Hinweis zu zeigen.
 *
 * **`gewaehrleistung_bis` wird NICHT gerechnet.** Die Frist je Vertragsregime
 * ist offen (O-154), und ein geratenes Datum liesse einen Anspruch
 * verjähren, ohne dass es auffällt. Steht die Spalte leer, sagt die Seite,
 * warum sie leer ist.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  // DESIGN §5 kennt „Abgenommen" nicht; 03-GEWERKE §3.5 hat die Zeile
  // beantragt. Bis sie dort steht, trägt die Pille das nächstliegende Wort
  // des geschlossenen Vokabulars und der Text daneben das genaue.
  abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  geplant: 'Geplant', in_arbeit: 'In Arbeit', abgenommen: 'Abgenommen',
  abgeschlossen: 'Abgeschlossen', archiviert: 'Archiviert',
};

const ART_TEXT: Readonly<Record<string, string>> = {
  hochbau: 'Hochbau', ausbau: 'Ausbau', rueckbau: 'Rückbau',
};

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  vob_b: 'VOB/B', bgb: 'BGB',
};

/**
 * Cent kommen als TEXT aus dem Treiber und gehen als `bigint` weiter — nie
 * als `number`: ab 2^53 verlöre er Cent (Invariante 1). Dieselbe Hilfe steht
 * in `bericht/kennzahlen.ts`, aus demselben Grund.
 */
const geld = (roh: string | null): Cent => cent(roh === null ? 0n : BigInt(roh));

const GRUNDLAGE_ERLAEUTERUNG: Readonly<Record<string, string>> = {
  vob_b:
    'Nachtrag nach § 2, Behinderung nach § 6, Abnahme nach § 12, '
    + 'Gewährleistung nach § 13 Abs. 4 VOB/B.',
  bgb:
    'Nachtrag nach §§ 650b/650c, Abnahme nach § 640, Gewährleistung nach '
    + '§ 634a BGB.',
};

export default async function ProjektDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/bau/projekte/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjektDetail(kontext, id);
      if (projekt === null) return null;
      return {
        projekt,
        // NUR wenn das Recht gehalten wird — sonst wirft die Funktion und
        // reisst die ganze Transaktion mit.
        marge: projekt.darf_kalkulation_lesen
          ? await ladeProjektMarge(kontext, id)
          : null,
        warnungen: await ladeAusserhalbLv(kontext, { projektId: id }),
      };
    }),
  ) as Promise<{
    projekt: ProjektDetailZeile;
    marge: ProjektMarge | null;
    warnungen: readonly AusserhalbLvWarnung[];
  } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();
  const { projekt: p } = daten;

  /**
   * Die Marge entsteht aus GANZZAHLIGEN CENT, nicht aus Prozenten (Invariante
   * 1): erst die Differenz in Cent, dann — nur für die ANZEIGE — das
   * Verhältnis. Wer umgekehrt rechnete, hätte einen Prozentwert als Wahrheit
   * und einen Betrag als Schätzung.
   */
  const summeCent: bigint | null = daten.marge === null
    ? null : geld(daten.marge.auftragssumme_cent);
  const kostenCent: bigint | null = daten.marge === null
    ? null
    : geld(daten.marge.lohn_cent) + geld(daten.marge.fremd_cent);
  const deckungCent: bigint | null = summeCent === null || kostenCent === null
    ? null : summeCent - kostenCent;
  const margeProzent = summeCent === null || summeCent === 0n || deckungCent === null
    ? null
    // Erst in Cent multiplizieren, dann teilen: eine Gleitkommadivision auf
    // Cent-Beträgen liefert bei grossen Summen eine andere Stelle.
    : Number((deckungCent * 1000n) / summeCent) / 10;

  const karten: readonly {
    readonly schluessel: string;
    readonly titel: string;
    readonly ziel: string;
    readonly wert: string;
    readonly hinweis: string;
    readonly ton?: 'warnung';
  }[] = [
    {
      schluessel: 'lv',
      titel: 'Leistungsverzeichnisse',
      ziel: `/portal/${mandant}/bau/projekte/${id}/lv`,
      wert: String(p.lv_anzahl),
      hinweis: 'OZ-Baum, Mengen, Einheitspreise (BAU-01)',
    },
    {
      schluessel: 'aufmass',
      titel: 'Aufmaße',
      ziel: `/portal/${mandant}/bau/projekte/${id}/aufmass`,
      wert: String(p.aufmass_anzahl),
      hinweis: 'Rechenansatz und Ergebnis nebeneinander (BAU-02)',
    },
    {
      schluessel: 'nachtraege',
      titel: 'Nachträge',
      ziel: `/portal/${mandant}/bau/projekte/${id}/nachtraege`,
      wert: `${String(p.nachtraege_offen)} / ${String(p.nachtraege_gesamt)}`,
      hinweis: 'offen (angemeldet, nicht eingereicht) von insgesamt (BAU-04)',
      ...(p.nachtraege_offen > 0 ? { ton: 'warnung' as const } : {}),
    },
    {
      schluessel: 'behinderungen',
      titel: 'Behinderungen',
      ziel: `/portal/${mandant}/bau/projekte/${id}/behinderungen`,
      wert: String(p.behinderungen_laufend),
      hinweis: 'laufend, ohne angezeigten Wegfall (BAU-06)',
      ...(p.behinderungen_laufend > 0 ? { ton: 'warnung' as const } : {}),
    },
    {
      schluessel: 'bautagebuch',
      titel: 'Bautagebuch',
      ziel: `/portal/${mandant}/bau/projekte/${id}/bautagebuch`,
      wert: String(p.bautage),
      hinweis: 'erfasste Bautage (BAU-07)',
    },
    {
      schluessel: 'abnahme',
      titel: 'Abnahme',
      ziel: `/portal/${mandant}/bau/projekte/${id}/abnahme`,
      wert: p.abgenommen_lokal ?? String(p.abnahmen),
      hinweis: p.abgenommen_lokal === null
        ? 'Protokolle nach § 12 VOB/B — noch keine Abnahme'
        : 'abgenommen; Gefahr, Frist und Fälligkeit sind umgeschlagen',
    },
  ];

  return (
    <PortalRahmen
      titel={`Projekt ${p.nummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/bau/projekte`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Bauprojekte
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">
            {p.nummer} · {p.bezeichnung}
          </h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {p.kunde}
            {p.objekt !== null && ` · ${p.objekt}`}
            {' · '}{ART_TEXT[p.art] ?? p.art}
          </p>
        </div>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={PILLE[p.status] ?? 'Geplant'} />
          <span className="text-sm text-text-muted">
            {STATUS_TEXT[p.status] ?? p.status}
          </span>
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Die Vertragsgrundlage — sie entscheidet über vier Vorgänge.         */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <div className="rounded-lg border border-line bg-surface p-s5" data-cse="vertragsgrundlage">
          <p className="m-0 text-micro uppercase tracking-[0.08em] text-text-subtle">
            Vertragsgrundlage
          </p>
          <p className="m-0 mt-s1 text-h3 text-text">
            {GRUNDLAGE_TEXT[p.vertragsgrundlage] ?? p.vertragsgrundlage}
          </p>
          <p className="m-0 mt-s2 max-w-prose text-sm text-text-muted">
            {GRUNDLAGE_ERLAEUTERUNG[p.vertragsgrundlage]
              ?? 'Das Vertragsregime dieses Projekts.'}
            {' '}Sie ist beim Anlegen festgelegt worden und wird nicht
            angenommen — ob BGB-Bauverträge überhaupt vorkommen, ist eine offene
            Frage (O-154), und ein Vorgabewert hätte sie stillschweigend
            beantwortet.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Termine und Verantwortung.                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Termine und Verantwortung</h2>
        <dl className="m-0 grid grid-cols-2 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Soll-Beginn</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.soll_beginn_lokal ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Soll-Ende</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.soll_ende_lokal ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Ist-Beginn</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.ist_beginn_lokal ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Ist-Ende</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.ist_ende_lokal ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Abnahme</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.abgenommen_lokal ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Bauleitung</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.verantwortlich ?? '—'}</dd>
          </div>
        </dl>

        <p className="mt-s3 max-w-prose text-sm text-text-muted" data-cse="gewaehrleistung">
          <strong className="text-text">Gewährleistung bis:</strong>{' '}
          {p.gewaehrleistung_bis_lokal ?? (
            <>
              <span className="text-warning">offen (O-154)</span> — die Frist
              wird <em>gespeichert</em>, nicht berechnet. Ob vier Jahre (§ 13
              Abs. 4 VOB/B) oder fünf (§ 634a BGB) gelten und ab welchem
              Ereignis sie läuft, ist nicht entschieden; ein geratenes Datum
              liesse einen Anspruch verjähren, ohne dass es auffällt.
            </>
          )}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Geld — zwei Rechte, zwei Wege, nie eine 0 € als Ersatz.             */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="projekt-geld">
        <h2 className="mb-s3 text-h3 text-text">Vertragssumme</h2>
        {p.darf_preis_lesen ? (
          <dl className="m-0 grid grid-cols-2 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Auftragssumme (netto)
              </dt>
              <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="auftragssumme">
                {p.auftragssumme_cent === null
                  ? <span className="text-text-subtle">nicht eingetragen</span>
                  : formatiereGeld(cent(BigInt(p.auftragssumme_cent)))}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Sicherheitseinbehalt
              </dt>
              <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="einbehalt">
                {p.sicherheitseinbehalt_bp === null
                  ? <span className="text-text-subtle">nicht vereinbart</span>
                  /*
                   * Basispunkte, nie Gleitkomma: 250 bp sind 2,50 %. Die
                   * Anzeige teilt durch 100 und rechnet damit nichts —
                   * gespeichert bleibt die ganze Zahl (Invariante 1,
                   * 03-GEWERKE §7.1).
                   */
                  : `${(p.sicherheitseinbehalt_bp / 100).toLocaleString('de-DE', {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })} % (${String(p.sicherheitseinbehalt_bp)} bp)`}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Deckungsbeitrag
              </dt>
              <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="marge">
                {deckungCent === null
                  ? <span className="text-text-subtle">Recht kalkulation.lesen</span>
                  : `${formatiereGeld(cent(deckungCent))}${
                    margeProzent === null ? '' : ` · ${margeProzent.toLocaleString('de-DE', {
                      minimumFractionDigits: 1, maximumFractionDigits: 1,
                    })} %`}`}
              </dd>
            </div>
          </dl>
        ) : (
          <p
            className="rounded-lg border border-line bg-surface p-s5 text-sm text-warning"
            data-cse="preis-gesperrt"
          >
            Auftragssumme und Sicherheitseinbehalt sind für Ihre Rolle nicht
            lesbar (Recht <code>bau.preis_lesen</code>). Sie fehlen hier, statt
            als 0 € zu erscheinen: die Vertragssumme des Kunden gehört nicht in
            jede Ansicht, und eine Null wäre eine Angabe — eine falsche.
          </p>
        )}

        {p.darf_preis_lesen && !p.darf_kalkulation_lesen && (
          <p className="mt-s3 text-sm text-text-muted">
            Der Deckungsbeitrag braucht zusätzlich <code>kalkulation.lesen</code>
            {' '}— die eigene Kostenseite ist ein anderes Recht als die
            Vertragssumme des Kunden.
          </p>
        )}
        {daten.marge !== null && (
          <p className="mt-s3 max-w-prose text-xs text-text-subtle">
            Deckungsbeitrag = Auftragssumme − Lohn − Fremdleistung, in ganzen
            Cent gerechnet; der Prozentwert ist nur die Anzeige. Berechnet und
            noch nicht abgerechnet zeigt der Bericht{' '}
            <Link
              href={`/portal/${mandant}/berichte/projekte`}
              className="underline-offset-2 hover:text-text hover:underline"
            >
              Projekte
            </Link>.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-05: Leistung ausserhalb des LV — dieses Projekt.                */}
      {/* ------------------------------------------------------------------ */}
      <AusserhalbLvWarnungen
        warnungen={daten.warnungen}
        mandant={mandant}
        projektId={id}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Die sechs Vorgänge, jeder mit seiner Zahl.                          */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-s3 text-h3 text-text">Vorgänge</h2>
        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          {karten.map((k) => (
            /**
             * Ein gewöhnliches `<a>` und kein `next/link` — dieselbe
             * Begründung wie im `KachelRaster`: `typedRoutes` prüft `href`
             * gegen die bekannten Routenmuster, und ein zur Laufzeit
             * zusammengesetztes Ziel ist für den Typ kein bekanntes Muster.
             * Ein Cast hätte die Prüfung ausgeschaltet, statt sie zu erfüllen.
             */
            <a
              key={k.schluessel}
              href={k.ziel}
              data-cse="projekt-karte"
              data-karte={k.schluessel}
              className="block rounded-lg border border-line bg-surface p-s5 hover:border-line-strong"
            >
              <p className="m-0 text-micro uppercase tracking-[0.08em] text-text-subtle">
                {k.titel}
              </p>
              <p
                className={`m-0 mt-s1 text-h3 tabular-nums ${k.ton === 'warnung' ? 'text-warning' : 'text-text'}`}
              >
                {k.wert}
              </p>
              <p className="m-0 mt-s2 text-xs text-text-muted">{k.hinweis}</p>
            </a>
          ))}
        </div>
      </section>
    </PortalRahmen>
  );
}

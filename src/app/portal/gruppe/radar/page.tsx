import Link from 'next/link';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import {
  gruppenRadar, type BereichRadar, type GruppenRadarZeile, type RadarZelle,
} from '@/server/services/gruppe/radar';
import { alleQuellStaende } from '@/server/services/radar/quelle';
import { fristKlasse, fristText, KNAPP_TAGE } from '../../[mandant]/radar/frist';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, KeinRecht,
  type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/radar` — die Vergabepipeline über alle Gesellschaften
 * (RAD-07, REP-06, TEN-05), **lesend** (Invariante 10).
 *
 * **Sie fasst zusammen, sie bewertet nicht.** Jede Punktzahl auf dieser Seite
 * stammt aus dem Suchprofil GENAU EINER Gesellschaft; die Gruppe bildet
 * daraus keinen Mittelwert und keine zweite Rangfolge (`gruppe/radar.ts`).
 * Die Spalten stehen nebeneinander, nicht übereinander.
 *
 * **Wofür es die Seite überhaupt gibt.** Ein Bereich sieht seine eigene
 * Bewertung. Dass die Reinigung und die Security DIESELBE Bekanntmachung im
 * Blick haben, sieht keiner von beiden — und genau daran hängt, ob zwei
 * Gesellschaften derselben Gruppe gegeneinander bieten. Die Seite macht es
 * sichtbar; was daraus folgt, entscheidet der Auftraggeber (O-870).
 *
 * **Gehandelt wird im Bereich.** Es gibt hier keinen Stand-setzen-Knopf und
 * keine Mappe: jeder Verweis führt in die Gesellschaft, der die Vergabe
 * gehört. Ohne genau einen aktiven Mandanten läuft kein Schreibpfad
 * (Invariante 10), und `gruppenLesen` gibt einen `LeseKontext` — ein
 * Schreibversuch wäre ein Compilerfehler.
 */
export const dynamic = 'force-dynamic';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const VORGANG: Readonly<Record<string, string>> = {
  neu: 'neu', geprueft: 'geprüft', verworfen: 'verworfen', in_bearbeitung: 'in Bearbeitung',
  eingereicht: 'eingereicht', zuschlag: 'Zuschlag', nicht_beruecksichtigt: 'nicht berücksichtigt',
  verfahren_aufgehoben: 'Verfahren aufgehoben',
};

/** Der Wert einer Vergabe — oder die Fremdwährung, die NICHT umgerechnet wird (O-47). */
function Wert({ zeile }: { readonly zeile: GruppenRadarZeile }) {
  if (zeile.wertCent === null) return <span className="text-text-subtle">—</span>;
  if (zeile.fremdwaehrung) {
    return (
      <span title="Fremdwährung — nicht umgerechnet (O-47)" data-cse="radar-fremdwaehrung">
        {zeile.wertCent.toString()} {zeile.waehrung ?? ''}
      </span>
    );
  }
  return <span>{formatiereGeld(cent(zeile.wertCent))}</span>;
}

/**
 * Was ein Bereich zu einer Bekanntmachung sagt — in einer Zelle.
 *
 * Drei Zustände, und sie sehen verschieden aus, weil sie verschieden sind:
 * kein Leserecht (Strich mit Titel), kein Bezug (leerer Strich), oder
 * Punktzahl plus Stand. Eine Zelle, die alle drei gleich zeigte, verwandelte
 * „darf ich nicht sehen" in „da ist nichts".
 */
function Zelle({ zelle }: { readonly zelle: RadarZelle }) {
  if (!zelle.sichtbar) return <KeinRecht />;
  if (zelle.punkte === null && zelle.vorgangStatus === null) {
    return <span className="text-text-subtle">·</span>;
  }
  return (
    <span className="flex flex-col gap-s1" data-cse="radar-zelle" data-bereich={zelle.slug}>
      {zelle.punkte === null ? null : (
        <span title={zelle.begruendung ?? undefined} className="text-sm tabular-nums text-text">
          {zelle.ausgeschlossen
            ? <span className="text-text-subtle">ausgeschlossen</span>
            : `${String(zelle.punkte)} / ${String(zelle.skalaMax ?? 0)}`}
        </span>
      )}
      {zelle.vorgangStatus === null ? null : (
        <span className="text-xs text-text-muted">
          {VORGANG[zelle.vorgangStatus] ?? zelle.vorgangStatus}
        </span>
      )}
      {/*
        * RAD-09 in der GRUPPENZEILE: die Freischaltung gilt je Gesellschaft.
        * Dass die Reinigung auf dieser Plattform registriert ist, sagt nichts
        * über die Security — und eine Gruppensicht, die das verschwiege,
        * liesse genau den Bereich bieten, der es nicht kann.
        */}
      {zelle.vorgangStatus !== null && zelle.freigeschaltet === false ? (
        <span data-cse="radar-nicht-freigeschaltet"
              className="text-xs font-semibold text-danger">
          nicht freigeschaltet
        </span>
      ) : null}
      {zelle.istPlatzhalterProfil ? (
        <span className="text-xs text-text-subtle" title="Suchprofil mit unbestätigten Gewichten (O-98)">
          Platzhalterprofil
        </span>
      ) : null}
    </span>
  );
}

export default async function GruppenRadar({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/radar');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const suche = await searchParams;
  const auchAbgelaufene = suche['alle'] === '1';

  const { bereiche, aktiv, radar } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const radar = await gruppenRadar(kontext, {
      knappTage: KNAPP_TAGE,
      auchAbgelaufene,
      mandantIds: mandantIdsFuer(kontext, aktiv),
    });
    return { bereiche, aktiv, radar };
  });

  const gezeigt = radar.bereiche.filter(
    (b) => aktiv === null || b.slug === aktiv.slug);
  const quellen = alleQuellStaende();
  const ohneQuelle = quellen.every((q) => !q.verbunden);
  /*
   * Die Adresse traegt BEIDES — Bereich und Fristenschalter. Der Schalter
   * hatte den Bereich abgeworfen: wer die Security ansah und „Auch
   * abgelaufene" druckte, bekam wieder alle vier Gesellschaften.
   */
  const adresse = (alle: boolean): string => {
    const q = new URLSearchParams();
    if (alle) q.set('alle', '1');
    if (aktiv !== null) q.set('bereich', aktiv.slug);
    const text = q.toString();
    return text === '' ? '/portal/gruppe/radar' : `/portal/gruppe/radar?${text}`;
  };
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2';

  const matrixSpalten: readonly Spalte<GruppenRadarZeile>[] = [
    {
      schluessel: 'titel', kopf: 'Bekanntmachung',
      zelle: (z) => (
        <div className="min-w-0">
          <span className="text-text">{z.titel}</span>
          <div className="mt-s1 text-xs text-text-subtle">
            {z.vergabestelle ?? 'Vergabestelle unbekannt'}
            {z.ort === null ? '' : ` · ${z.ort}`}
            {z.cpvHaupt === null ? '' : ` · CPV ${z.cpvHaupt}`}
            {z.oberhalbSchwellenwert === true ? ' · oberhalb Schwellenwert' : ''}
          </div>
          {z.mehrfach ? (
            <div className="mt-s1 text-xs font-semibold text-warning" data-cse="radar-mehrfach">
              in {String(z.imBlick.length)} Gesellschaften im Blick: {z.imBlick.join(', ')}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      schluessel: 'frist', kopf: 'Abgabe',
      zelle: (z) => (
        <span className="flex flex-col gap-s1" data-cse="radar-frist" data-rest={String(z.restTage ?? '')}>
          {z.restTage !== null && z.restTage < 0
            ? <StatusPill zustand="Überfällig" />
            : <span className={`text-sm ${fristKlasse(z.restTage)}`}>{fristText(z.restTage)}</span>}
          <span className="text-xs text-text-subtle">
            {z.fristAngebot === null ? '—' : BERLIN.format(z.fristAngebot)}
          </span>
        </span>
      ),
    },
    { schluessel: 'wert', kopf: 'Wert', numerisch: true, zelle: (z) => <Wert zeile={z} /> },
    {
      schluessel: 'plattform', kopf: 'Plattform',
      zelle: (z) => (z.plattformName === null
        ? <span className="text-xs text-text-subtle">{z.plattformHinweis ?? 'unbekannt'}</span>
        : <span className="text-xs text-text-muted">{z.plattformName}</span>),
    },
    /*
     * Die Spalte findet ihre Zelle ueber den SLUG und nicht ueber den Index.
     * Beide Listen entstehen aus derselben sichtbaren Menge und stimmen heute
     * ueberein — aber eine Spalte, die beim ersten Auseinanderlaufen die
     * Punktzahl der Nachbargesellschaft zeigt, faellt niemandem auf.
     */
    ...gezeigt.map((b) => ({
      schluessel: `bereich-${b.slug}`,
      kopf: b.name,
      zelle: (z: GruppenRadarZeile) => {
        const zelle = z.zellen.find((c) => c.slug === b.slug);
        return zelle === undefined ? <KeinRecht /> : <Zelle zelle={zelle} />;
      },
    })),
  ];

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Radar" aktiverTab="radar">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="m-0 text-h1 text-text">Vergaberadar</h1>
          <p className="mt-s1 max-w-prose text-sm text-text-muted">
            Dieselbe Bekanntmachung, nebeneinander mit der Bewertung jeder Gesellschaft.
            Eingereicht wird nie hier — und auch sonst nirgends automatisch (D-07).
          </p>
        </div>
        <nav aria-label="Fristen" className="flex flex-wrap gap-s2">
          <a href={adresse(!auchAbgelaufene)}
             className={knopf} data-cse="radar-umschalten">
            {auchAbgelaufene ? 'Nur offene' : 'Auch abgelaufene'}
          </a>
        </nav>
      </div>

      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/radar" />

      <div data-cse="radar-kennzahlen" className="mb-s6 grid grid-cols-2 gap-s3 lg:grid-cols-5">
        <KpiStat label="Im Blick" wert={String(radar.summe.imBlick)} icon="uebersicht" />
        <KpiStat label="Offene Fristen" wert={String(radar.summe.offeneFristen)} icon="zeit" />
        <KpiStat label={`Unter ${String(KNAPP_TAGE)} Tagen`} wert={String(radar.summe.knapp)}
                 ton={radar.summe.knapp > 0 ? 'danger' : 'muted'} icon="warnung" />
        <KpiStat label="Ohne Freischaltung" wert={String(radar.summe.ohneFreischaltung)}
                 ton={radar.summe.ohneFreischaltung > 0 ? 'warning' : 'muted'} icon="schloss" />
        <KpiStat label="Mehrfach im Blick" wert={String(radar.summe.mehrfach)}
                 ton={radar.summe.mehrfach > 0 ? 'warning' : 'muted'} icon="gruppe" />
      </div>

      {radar.summe.bereiche === 0 ? null : (
        <p className="mb-s5 text-sm text-text-subtle" data-cse="radar-reichweite">
          Die Summen gehen über {String(radar.summe.bereiche)} von{' '}
          {String(gezeigt.length)} gezeigten Gesellschaften — in den übrigen fehlt
          das Leserecht für den Radar.
        </p>
      )}

      {ohneQuelle ? (
        <Hinweis art="warnung" cse="radar-quellen" className="mb-s5 max-w-prose">
          <strong>Keine Quelle verbunden.</strong> Der Radar liest{' '}
          {quellen.map((q) => q.name).join(' und ')}. Was fehlt, ist die Abfrage, die dieser
          Betrieb stellen will — welche CPV-Gruppen, welche Region, welches Zeitfenster
          (offene Frage O-366). Bis dahin stehen hier nur die Bekanntmachungen, die bereits
          in der Datenbank liegen; es wird keine erfunden.
        </Hinweis>
      ) : null}

      {/* TODO(client, O-870): Wenn zwei Gesellschaften der Gruppe dieselbe Bekanntmachung hoch bewerten — wer bietet? Eine allein, beide getrennt, oder eine Bietergemeinschaft; und wer entscheidet das? Bis zur Antwort zeigt die Seite den Sachverhalt und schlägt nichts vor. */}
      {radar.summe.mehrfach > 0 ? (
        <Hinweis art="warnung" cse="radar-zustaendigkeit" className="mb-s6 max-w-prose">
          <strong>{String(radar.summe.mehrfach)} Bekanntmachungen sind in mehr als einer
          Gesellschaft im Blick.</strong> Wer davon bietet, ob gemeinsam als Bietergemeinschaft
          oder ob eine Gesellschaft zurücktritt, ist eine Regel des Hauses und keine, die diese
          Plattform sich gibt: <strong>offen (O-870)</strong>. Bis sie beantwortet ist, zeigt
          die Seite den Sachverhalt und schlägt nichts vor.
        </Hinweis>
      ) : null}

      <h2 className="mb-s3 text-h2 text-text">Je Gesellschaft</h2>
      <div data-cse="radar-bereiche">
        <DataTable<BereichRadar>
          beschriftung="Vergaberadar je Gesellschaft"
          zeilen={gezeigt}
          schluessel={(b) => b.slug}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (b) => <BereichMarke slug={b.slug} name={b.name} /> },
            { schluessel: 'bewertet', kopf: 'Bewertet', numerisch: true,
              zelle: (b) => (b.bewertet === null ? <KeinRecht /> : b.bewertet) },
            { schluessel: 'offen', kopf: 'Offene Fristen', numerisch: true,
              zelle: (b) => (b.offeneFristen === null ? <KeinRecht /> : b.offeneFristen) },
            { schluessel: 'knapp', kopf: `Unter ${String(KNAPP_TAGE)} Tagen`, numerisch: true,
              zelle: (b) => (b.knapp === null ? <KeinRecht />
                : <span className={b.knapp > 0 ? 'text-danger' : ''}>{b.knapp}</span>) },
            { schluessel: 'freischaltung', kopf: 'Ohne Freischaltung', numerisch: true,
              zelle: (b) => (b.ohneFreischaltung === null ? <KeinRecht />
                : <span className={b.ohneFreischaltung > 0 ? 'text-warning' : ''}>
                    {b.ohneFreischaltung}
                  </span>) },
            { schluessel: 'bearbeitung', kopf: 'In Bearbeitung', numerisch: true,
              zelle: (b) => (b.inBearbeitung === null ? <KeinRecht /> : b.inBearbeitung) },
            { schluessel: 'eingereicht', kopf: 'Eingereicht', numerisch: true,
              zelle: (b) => (b.eingereicht === null ? <KeinRecht /> : b.eingereicht) },
            { schluessel: 'zuschlag', kopf: 'Zuschlag', numerisch: true,
              zelle: (b) => (b.zuschlag === null ? <KeinRecht /> : b.zuschlag) },
            { schluessel: 'zuschlagswert', kopf: 'Zuschlagswert', numerisch: true,
              zelle: (b) => (b.zuschlagswertCent === null
                ? <KeinRecht /> : formatiereGeld(b.zuschlagswertCent)) },
            { schluessel: 'profile', kopf: 'Suchprofile', numerisch: true,
              zelle: (b) => (b.profileAktiv === null ? <KeinRecht /> : (
                <span title={b.profilePlatzhalter === null || b.profilePlatzhalter === 0
                        ? undefined
                        : `${String(b.profilePlatzhalter)} davon mit unbestätigten Gewichten (O-98)`}>
                  {b.profileAktiv}
                  {b.profilePlatzhalter !== null && b.profilePlatzhalter > 0
                    ? <span className="text-text-subtle"> ({b.profilePlatzhalter} Platzhalter)</span>
                    : null}
                </span>
              )) },
          ]}
        />
      </div>
      <GruppenHinweis text="„Eingereicht“ fasst zusammen, was das Haus verlassen hat — eingereicht, bezuschlagt, nicht berücksichtigt und aufgehoben (dieselbe Menge wie „geboten“ im Bericht, D-720). „Ohne Freischaltung“ zählt offene Fristen auf einer Plattform, auf der diese Gesellschaft kein Konto hat: die Registrierung dauert Tage bis Wochen (RAD-09), wer es am Abgabetag merkt, hat die Chance verloren." />

      <h2 className="mb-s3 mt-s6 text-h2 text-text">
        {auchAbgelaufene ? 'Alle Bekanntmachungen' : 'Offene Bekanntmachungen'}
      </h2>
      {radar.zeilen.length === 0 ? (
        <LeereListe text={auchAbgelaufene
          ? 'Keine bewertete Bekanntmachung in dieser Auswahl.'
          : 'Keine offene Bekanntmachung in dieser Auswahl. Abgelaufene blendet der Schalter oben ein.'} />
      ) : (
        <div data-cse="radar-matrix">
          <DataTable<GruppenRadarZeile>
            beschriftung="Bekanntmachungen mit der Bewertung jeder Gesellschaft"
            zeilen={radar.zeilen}
            schluessel={(z) => z.ausschreibungId}
            spalten={matrixSpalten}
          />
        </div>
      )}

      {/*
        * Der Weg in die Gesellschaft — EINER je Bereich, der die Vergabe im
        * Blick hat. Ein Verweis von der Gruppenseite direkt auf
        * `/portal/<slug>/radar/<id>` fuehrt ueber das Wechselblatt: ein GET
        * wechselt den Mandanten nie (§4.5).
        */}
      {radar.zeilen.length === 0 ? null : (
        <div className="mt-s5" data-cse="radar-wege">
          <h3 className="mb-s3 text-h3 text-text">Öffnen im Bereich</h3>
          <ul className="flex flex-col gap-s2">
            {radar.zeilen.slice(0, 20).map((z) => (
              <li key={z.ausschreibungId} className="text-sm text-text-muted">
                <span className="text-text">{z.titel}</span>
                {' — '}
                {z.zellen.filter((c) => c.sichtbar
                    && (c.punkte !== null || c.vorgangStatus !== null)).length === 0
                  ? <span className="text-text-subtle">in keinem lesbaren Bereich</span>
                  : z.zellen
                      .filter((c) => c.sichtbar && (c.punkte !== null || c.vorgangStatus !== null))
                      .map((c) => (
                        <Link key={c.slug} href={`/portal/${c.slug}/radar/${z.ausschreibungId}`}
                              className="me-s3 text-text underline-offset-2 hover:text-brand hover:underline">
                          {c.name}
                        </Link>
                      ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <GruppenHinweis text="Jede Punktzahl gehört dem Suchprofil einer Gesellschaft; die Gruppe rechnet sie nicht zusammen und bildet keine zweite Bewertung. Stand setzen, Mappe anlegen und Unterlagen hochladen geschieht im Bereich — eingereicht wird auf der Vergabeplattform von Hand, weil keine deutsche Plattform dafür eine Schnittstelle anbietet (D-07)." />
    </GruppenRahmen>
  );
}

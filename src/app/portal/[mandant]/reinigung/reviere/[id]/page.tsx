import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import {
  findeRevier, ladeZugeordneteRaeume, mitLesekontext, type RevierRaumZeile,
} from '../../daten';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { LeistungsankerFeld } from '@/components/portal/LeistungsankerFeld';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LEISTUNGSANKER_TEXTE } from '@/lib/i18n/verwaltung/leistungsanker';
import { REVIER_FEHLER_TEXTE } from '@/lib/i18n/verwaltung/reinigung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { listeAnkerbareLeistungen } from '@/server/services/dienstplan/leistungsanker';

/**
 * `/portal/[mandant]/reinigung/reviere/[id]` — eine Zone und ihr Rechenweg
 * (CLN-01, OPS-03, OPS-07, K-16(c)).
 *
 * **Die Seite zeigt den Rechenweg, nicht nur das Ergebnis.** Je Raum stehen
 * die Fläche und der Leistungswert, mit denen gerechnet wurde — beides
 * SCHNAPPSCHÜSSE vom Kalkulationszeitpunkt, nicht der heutige Katalogwert. Nur
 * so lässt sich ein abgegebenes Angebot Monate später nachrechnen; ein
 * nachgezogener Wert machte genau das unmöglich, und zwar rückwirkend und
 * lautlos.
 *
 * **Die Zeile „Summe" unten ist die Probe.** Sie muss exakt die Sollzeit des
 * Kopfes ergeben. Tut sie es nicht, ist zwischen den beiden Trägern zweimal
 * gerundet worden — ein Fehler, der keine Ausnahme wirft und sich nur so
 * zeigt.
 */
export const dynamic = 'force-dynamic';

function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

export default async function RevierBlatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/reinigung/reviere/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: die Zuordnung `…/reviere/[id]/raeume` verlangt laut Manifest
     `reinigung.schreiben`, dieses Blatt nur `reinigung.lesen` — wer nur lesen
     darf, sah „Räume zuordnen und neu kalkulieren" und bekam dahinter ein
     404. Ein Verweis auf 404 verraet, was er nicht zeigen darf (Copilot-Runde
     auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'reinigung.schreiben', 'auftrag.lesen');

  /*
   * Die Leistungszeile des Reviers (V-352): die Auswahl nur mit
   * `auftrag.lesen` — ohne steht ein Satz und KEIN Feld, damit kein Speichern
   * einen Anker löst, den der Betrachter nicht sieht (LeistungsankerFeld).
   */
  const { revier, raeume, anker } = await mitLesekontext(sitzung, async (kontext) => {
    const gefunden = await findeRevier(kontext, id);
    return {
      revier: gefunden,
      raeume: await ladeZugeordneteRaeume(kontext, id),
      anker: gefunden !== null && darf['reinigung.schreiben'] === true
        && darf['auftrag.lesen'] === true
        ? await listeAnkerbareLeistungen(kontext, gefunden.auftragLeistungId) : null,
    };
  });
  // AUT-06: eine fremde Zone ist nicht vorhanden, nicht verboten.
  if (revier === null) notFound();

  /*
   * Rückweg der Route (`aktion=leistung`): ein abgewiesener Anker als Grund
   * aus `LEISTUNGSANKER_TEXTE`, ein Revierfehler aus `REVIER_FEHLER_TEXTE` —
   * nur als eigener Eintrag nachgeschlagen, nie das Wort aus der Adresse.
   */
  const suche = await searchParams;
  const tL = nachSprache(LEISTUNGSANKER_TEXTE, zugang.sprache);
  const tF = nachSprache(REVIER_FEHLER_TEXTE, zugang.sprache);
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const fehlerText = fehler === null ? null
    : (eigenerEintrag(tL.fehler, fehler) ?? eigenerEintrag(tF.fehler, fehler) ?? tL.fehlerSonst);
  const gesetzt = fehler === null
    ? (suche['leistung'] === 'gesetzt' ? tL.gesetzt
      : suche['leistung'] === 'nachtlauf' ? tL.gesetztNachtlauf : null)
    : null;

  const stimmt = revier.summeRaeume === null
    ? raeume.length === 0
    : revier.summeRaeume === revier.sollzeitMinuten;

  return (
    <PortalRahmen
      titel={revier.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/reinigung/reviere`, text: 'Alle Reviere' }}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{revier.bezeichnung}</h1>
        <p className="m-0 text-sm text-text-muted">
          {revier.objekt}
          {revier.kurzzeichen !== null && ` · ${revier.kurzzeichen}`}
        </p>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 md:grid-cols-2">
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Sollzeit je Durchgang — berechneter Zielwert
          </div>
          <div className="mt-s1 text-h2 tabular-nums text-text">
            {deutsch(revier.sollzeitMinuten)} Min.
          </div>
          <p className="mt-s3 m-0 text-sm text-text-muted">
            Aus Fläche ÷ Leistungswert. <strong className="text-text">Keine gemessene
            Dauer</strong> — gearbeitete Minuten sind ganzzahlig und stehen im
            Zeitbereich.
          </p>
        </Card>
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Summe der Räume
          </div>
          <div
            className={`mt-s1 text-h2 tabular-nums ${stimmt ? 'text-text' : 'text-danger'}`}
          >
            {deutsch(revier.summeRaeume)} Min.
          </div>
          <p className="mt-s3 m-0 text-sm text-text-muted">
            {stimmt ? (
              <>
                <Icon
                  name="ok"
                  groesse="sm"
                  className="mr-s2 inline-block align-[-2px] text-success"
                />
                Stimmt mit dem Kopf überein — zwischen beiden wurde nicht zweimal
                gerundet.
              </>
            ) : (
              <>
                <Icon
                  name="warnung"
                  groesse="sm"
                  className="mr-s2 inline-block align-[-2px] text-danger"
                />
                Weicht vom Kopf ab. Die Zone bitte neu kalkulieren — die Zahlen
                stammen aus zwei verschiedenen Läufen.
              </>
            )}
          </p>
        </Card>
      </div>

      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h2 className="m-0 text-h3 text-text">Räume</h2>
        {darf['reinigung.schreiben'] === true && (
          <Link href={`/portal/${mandant}/reinigung/reviere/${id}/raeume`} className="text-sm underline hover:text-text">
            Räume zuordnen und neu kalkulieren
          </Link>
        )}
      </div>

      {raeume.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Dieser Zone ist noch kein Raum zugeordnet. Bis dahin ist die Sollzeit
          oben ein gesetzter, kein gerechneter Wert.
        </p>
      ) : (
        <DataTable<RevierRaumZeile>
          beschriftung="Räume der Zone mit Fläche, Leistungswert und Zeitanteil"
          zeilen={raeume}
          schluessel={(r) => r.raumId}
          spalten={[
            {
              schluessel: 'raum',
              kopf: 'Raum',
              zelle: (r) => `${r.raumnummer ?? '—'}${r.bezeichnung === null ? '' : ` · ${r.bezeichnung}`}`,
            },
            { schluessel: 'etage', kopf: 'Etage', zelle: (r) => r.etage ?? '—' },
            {
              schluessel: 'flaeche',
              kopf: 'Fläche (m², Stand Kalkulation)',
              numerisch: true,
              zelle: (r) => deutsch(r.flaecheQm),
            },
            {
              schluessel: 'lw',
              kopf: 'Leistungswert (m²/h, Stand Kalkulation)',
              numerisch: true,
              zelle: (r) => deutsch(r.leistungswert),
            },
            {
              schluessel: 'anteil',
              kopf: 'Zeitanteil (Min.)',
              numerisch: true,
              zelle: (r) => deutsch(r.sollzeitMinuten),
            },
          ]}
        />
      )}

      {/*
        **Die Leistungszeile des Reviers** (V-352, O-927 (2)). Ein Turnus ohne
        eigene Zeile übernimmt sie; nach dem Speichern schreibt der Generator
        sie auf die künftigen Schichten ohne erfasste Zeit.
      */}
      {darf['reinigung.schreiben'] === true && (
        <section data-cse="revier-leistung"
                 className="mt-s6 rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s3 mt-0 text-h3 text-text">{tL.feld}</h2>
          {fehlerText !== null && (
            <Hinweis art="warnung" rolle="alert" cse="revier-leistung-fehler"
                     className="mb-s4 max-w-prose">
              {fehlerText}
            </Hinweis>
          )}
          {gesetzt !== null && (
            <Hinweis art="erfolg" rolle="status" cse="revier-leistung-gesetzt"
                     className="mb-s4 max-w-prose">
              {gesetzt}
            </Hinweis>
          )}
          <form method="post" action="/api/reinigung/reviere"
                className="flex max-w-[60ch] flex-col gap-s4">
            <input type="hidden" name="aktion" value="leistung" />
            <input type="hidden" name="id" value={revier.id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <LeistungsankerFeld leistungen={anker} gewaehlt={revier.auftragLeistungId}
                                sprache={zugang.sprache} erklaerung={tL.revierErklaerung}
                                feldKlasse="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text" />
            {anker !== null && (
              <div>
                <Button type="submit" variante="secondary" data-cse="revier-leistung-knopf">
                  {tL.speichern}
                </Button>
              </div>
            )}
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}

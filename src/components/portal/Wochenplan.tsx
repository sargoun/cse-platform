import type { ReactNode } from 'react';
import {
  stundenText, tagesanteil, verspure, type RasterSchicht,
} from '@/server/services/dienstplan/wochenraster';

/**
 * Die Wochenansicht des Dienstplans (TIM-01, TIM-04, DSH-04).
 *
 * **Der Fall, der den Entwurf bestimmt, ist TIM-04:** zehn Wachen, die zur
 * selben Sekunde an einem Objekt anfangen. Ein Plan, der Schichten nach
 * Anfangszeit gruppiert, zeigt dann eine Zeile — und dass neun fehlen, sieht
 * niemand, weil nichts fehlt aussieht wie nichts ist. Deshalb bekommt jede
 * Schicht ihre eigene Spur (`wochenraster.ts`), und die Spalte wird schmal,
 * nicht leer.
 *
 * **Eine Nachtschicht steht an beiden Tagen.** 22:00–06:00 laeuft am ersten
 * Tag bis Mitternacht und am zweiten ab Mitternacht weiter; beide Haelften
 * tragen dieselbe Dauer, weil die Dauer der Schicht gehoert und nicht dem
 * Kalendertag. Der Pfeil am Rand sagt, in welche Richtung sie weitergeht —
 * ein abgeschnittener Block ohne Zeichen liest sich als Fehler.
 *
 * **Angezeigt wird Europe/Berlin, immer** (Invariante 2). Die Uhrzeiten
 * kommen bereits als Ortszeit-Zeichenketten aus der Datenbank; dieser Baum
 * formatiert keinen Zeitpunkt selbst, damit `TZ` des Servers nichts
 * verschieben kann.
 */

export interface PlanSchicht extends RasterSchicht {
  /** `HH:MM` Ortszeit — aus der Datenbank, nicht hier gerechnet. */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly objekt: string;
  readonly revier: string | null;
  readonly besetzt: number;
  readonly soll: number;
  readonly status: string;
  /**
   * Befunde zu dieser Schicht — ArbZG, abgelaufener Nachweis, Unterbesetzung.
   * DESIGN §9: sie tragen **Text**, nie nur eine Farbe.
   */
  readonly befunde: readonly PlanBefund[];
}

export interface PlanBefund {
  readonly art: 'sperre' | 'warnung' | 'hinweis';
  readonly text: string;
}

export interface PlanTag {
  /** `JJJJ-MM-TT`, Berliner Kalendertag. */
  readonly datum: string;
  /** Beschriftung, fertig formatiert — z. B. „Mo 04.01.". */
  readonly beschriftung: string;
  /** Die Instants der Ortszeit-Mitternachten dieses Tages, aus der Datenbank. */
  readonly beginn: Date;
  readonly ende: Date;
  readonly feiertag: string | null;
}

export interface WochenplanProps {
  readonly tage: readonly PlanTag[];
  readonly schichten: readonly PlanSchicht[];
  /** Wohin eine Schicht fuehrt — DSH-04 verlangt einen Weg zu den Zeilen. */
  readonly zielFuer: (schicht: PlanSchicht) => string;
}

/** Von wann bis wann das Raster zeichnet. Nachts ist Dienstplan, nicht Pause. */
const VON_STUNDE = 0;
const BIS_STUNDE = 24;
const PIXEL_PRO_STUNDE = 44;
/**
 * Die schmalste Spur, die noch etwas zeigt.
 *
 * Ein Block ist `box-sizing: border-box` und kann darum **nie schmaler
 * werden als sein eigener Innenabstand plus Rahmen**. Bei zehn Spuren in
 * einer 128px-Spalte waeren 12,8px je Spur vorgesehen, gezeichnet wurden
 * 18px — die Bloecke ueberlappten einander, und aus zehn sichtbaren Spalten
 * wurden optisch wieder weniger. Genau der Fall, den TIM-04 verbietet.
 *
 * Die Spalte waechst deshalb mit der Zahl ihrer Spuren; das Raster steht
 * ohnehin in einem waagerecht scrollenden Rahmen.
 */
const PIXEL_PRO_SPUR = 38;
const SPALTE_MINDESTBREITE = 120;

const TON: Record<PlanBefund['art'], string> = {
  sperre: 'bg-danger-soft text-danger',
  warnung: 'bg-warning-soft text-warning',
  hinweis: 'bg-info-soft text-info',
};

/** Das Wort zum Ton — §9: die Farbe allein traegt die Bedeutung nicht. */
const WORT: Record<PlanBefund['art'], string> = {
  sperre: 'Gesperrt',
  warnung: 'Warnung',
  hinweis: 'Hinweis',
};

export function Wochenplan({ tage, schichten, zielFuer }: WochenplanProps) {
  const hoehe = (BIS_STUNDE - VON_STUNDE) * PIXEL_PRO_STUNDE;

  return (
    <div data-cse="wochenplan" className="overflow-x-auto">
      <div className="flex min-w-[52rem] items-start gap-s2">
        <div className="w-10 shrink-0 pt-[2.4rem]">
          <Stundenleiste hoehe={hoehe} />
        </div>
        {tage.map((tag) => (
          <Tagesspalte
            key={tag.datum}
            tag={tag}
            hoehe={hoehe}
            schichten={schichten}
            zielFuer={zielFuer}
          />
        ))}
      </div>
    </div>
  );
}

function Stundenleiste({ hoehe }: { readonly hoehe: number }) {
  /**
   * Die Beschriftung sitzt UNTER ihrer Linie, nicht mittig darauf.
   *
   * Mittig zentriert ragte die erste zur Haelfte ueber den Rand des Rasters
   * hinaus und wurde abgeschnitten — die Leiste begann sichtbar bei `01`, und
   * eine Stunde des Tages sah aus, als gaebe es sie nicht.
   */
  return (
    <div aria-hidden="true" className="relative w-full" style={{ height: hoehe }}>
      {Array.from({ length: BIS_STUNDE - VON_STUNDE }, (_, i) => VON_STUNDE + i).map((h) => (
        <div
          key={h}
          className="absolute right-0 text-micro leading-none tabular-nums text-text-subtle"
          style={{ top: (h - VON_STUNDE) * PIXEL_PRO_STUNDE + 2 }}
        >
          {String(h).padStart(2, '0')}
        </div>
      ))}
    </div>
  );
}

function Tagesspalte({
  tag, hoehe, schichten, zielFuer,
}: {
  readonly tag: PlanTag; readonly hoehe: number;
  readonly schichten: readonly PlanSchicht[];
  readonly zielFuer: (s: PlanSchicht) => string;
}) {
  // Erst auf den Tag schneiden, DANN verspuren: eine Nacht, die nur mit
  // ihrem Rest in diesen Tag reicht, konkurriert auch nur mit dem Rest.
  const anteile = schichten
    .map((s) => ({ schicht: s, anteil: tagesanteil(s, tag.beginn, tag.ende) }))
    .filter((a): a is { schicht: PlanSchicht; anteil: NonNullable<typeof a.anteil> } =>
      a.anteil !== null);
  const raster = verspure(anteile.map((a) => a.schicht));
  const spurVon = new Map(raster.map((r) => [r.schicht.id, r]));
  const meisteSpuren = raster.reduce((m, r) => Math.max(m, r.spuren), 1);

  return (
    <div
      data-cse="plantag"
      data-datum={tag.datum}
      data-spuren={String(meisteSpuren)}
      className="flex-1"
      style={{ minWidth: Math.max(SPALTE_MINDESTBREITE, meisteSpuren * PIXEL_PRO_SPUR) }}
    >
      {/*
        Datum und Anzahl UNTEREINANDER, nicht nebeneinander.
        Rechtsbuendig in einer breiten Spalte stand die Anzahl direkt neben
        dem Datum des NAECHSTEN Tages und las sich, als gehoerte sie dorthin.
      */}
      <div className="mb-s2">
        <span className="block text-sm font-semibold text-text">{tag.beschriftung}</span>
        <span className="block text-micro text-text-muted">
          {anteile.length === 0
            ? 'keine Schicht'
            : `${String(anteile.length)} ${anteile.length === 1 ? 'Schicht' : 'Schichten'}`}
        </span>
      </div>
      {tag.feiertag !== null && (
        <p
          data-cse="feiertag"
          className="mb-s2 rounded-md bg-info-soft px-s2 py-s1 text-micro text-info"
        >
          Feiertag: {tag.feiertag}
        </p>
      )}
      <div
        className="relative rounded-md border border-line bg-surface-2"
        style={{ height: hoehe }}
      >
        {Array.from({ length: BIS_STUNDE - VON_STUNDE }, (_, i) => i).map((i) => (
          <div
            key={i}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-line/60"
            style={{ top: i * PIXEL_PRO_STUNDE }}
          />
        ))}
        {anteile.map(({ schicht, anteil }) => {
          const spur = spurVon.get(schicht.id);
          const spuren = spur?.spuren ?? 1;
          const index = spur?.spur ?? 0;
          return (
            <Schichtblock
              key={schicht.id}
              schicht={schicht}
              anteil={anteil}
              spur={index}
              spuren={spuren}
              ziel={zielFuer(schicht)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Schichtblock({
  schicht, anteil, spur, spuren, ziel,
}: {
  readonly schicht: PlanSchicht;
  readonly anteil: { vonMinute: number; bisMinute: number; reichtZurueck: boolean; reichtVor: boolean };
  readonly spur: number; readonly spuren: number; readonly ziel: string;
}) {
  const oben = (anteil.vonMinute / 60 - VON_STUNDE) * PIXEL_PRO_STUNDE;
  const hoehe = Math.max(18, ((anteil.bisMinute - anteil.vonMinute) / 60) * PIXEL_PRO_STUNDE);
  const breite = 100 / spuren;
  const schwerster = schwersterBefund(schicht.befunde);
  const unterbesetzt = schicht.besetzt < schicht.soll;

  return (
    <a
      href={ziel}
      data-cse="schicht"
      data-schicht={schicht.id}
      data-spur={String(spur)}
      className={`absolute overflow-hidden rounded-md border px-s1 py-s1 text-micro leading-tight
        ${schicht.status === 'storniert'
          ? 'border-line bg-surface-3 text-text-subtle line-through'
          : 'border-line-strong bg-surface text-text hover:border-brand'}`}
      style={{
        top: oben,
        height: hoehe,
        left: `calc(${String(spur * breite)}% + 2px)`,
        width: `calc(${String(breite)}% - 4px)`,
      }}
    >
      <span className="block truncate font-semibold tabular-nums">
        {anteil.reichtZurueck ? '↑ ' : ''}
        {schicht.beginnLokal}–{schicht.endeLokal}
        {anteil.reichtVor ? ' ↓' : ''}
      </span>
      <span className="block truncate">{schicht.objekt}</span>
      {schicht.revier !== null && (
        <span className="block truncate text-text-muted">{schicht.revier}</span>
      )}
      <span className="block tabular-nums text-text-muted">
        {stundenText(schicht)} · {String(schicht.besetzt)}/{String(schicht.soll)}
        {unterbesetzt ? ' unbesetzt' : ''}
      </span>
      {schwerster !== null && (
        <span
          data-cse="befund"
          data-art={schwerster.art}
          className={`mt-s1 block truncate rounded px-s1 ${TON[schwerster.art]}`}
        >
          {WORT[schwerster.art]}: {schwerster.text}
        </span>
      )}
    </a>
  );
}

function schwersterBefund(befunde: readonly PlanBefund[]): PlanBefund | null {
  return befunde.find((b) => b.art === 'sperre')
    ?? befunde.find((b) => b.art === 'warnung')
    ?? befunde.find((b) => b.art === 'hinweis')
    ?? null;
}

/** Die Monatsansicht — dieselben Daten, ohne Raster (DESIGN §8: 375px). */
export function Monatsplan({
  tage, schichten, zielFuer,
}: WochenplanProps): ReactNode {
  return (
    <ul data-cse="monatsplan" className="m-0 grid list-none gap-s2 p-0 sm:grid-cols-2 lg:grid-cols-4">
      {tage.map((tag) => {
        const desTages = schichten.filter((s) => tagesanteil(s, tag.beginn, tag.ende) !== null);
        return (
          <li
            key={tag.datum}
            data-cse="monatstag"
            data-datum={tag.datum}
            className="rounded-md border border-line bg-surface p-s3"
          >
            <div className="mb-s2">
              <span className="block text-sm font-semibold text-text">{tag.beschriftung}</span>
              <span className="block text-micro text-text-muted">
                {desTages.length === 0
                  ? 'keine Schicht'
                  : `${String(desTages.length)} ${desTages.length === 1 ? 'Schicht' : 'Schichten'}`}
              </span>
            </div>
            {tag.feiertag !== null && (
              <p className="m-0 mb-s2 text-micro text-info">Feiertag: {tag.feiertag}</p>
            )}
            <ul className="m-0 list-none p-0">
              {desTages.slice(0, 4).map((s) => (
                <li key={s.id} className="border-t border-line py-s1 first:border-t-0">
                  <a
                    href={zielFuer(s)}
                    data-cse="schicht"
                    data-schicht={s.id}
                    className="block text-micro text-text hover:text-brand"
                  >
                    <span className="tabular-nums">{s.beginnLokal}–{s.endeLokal}</span>
                    {' · '}
                    <span className="text-text-muted">{s.objekt}</span>
                  </a>
                </li>
              ))}
              {desTages.length > 4 && (
                <li className="border-t border-line pt-s1 text-micro text-text-muted">
                  und {String(desTages.length - 4)} weitere
                </li>
              )}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

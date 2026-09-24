'use client';

/**
 * Der Bereichsumschalter — DESIGN §6, die Signaturinteraktion.
 *
 * Zwei Regeln von dort tragen die ganze Komponente:
 *
 *  1. **Bei einem Bereich wird gar nichts gerendert** — kein Chevron, kein
 *     Dropdown im DOM. Nicht `hidden`, nicht `display:none`: ein Auslöser, den
 *     man nicht sehen, aber finden kann, ist eine Einladung an jeden, der die
 *     Seite liest.
 *  2. **Die Gruppenübersicht trägt sichtbar `NUR LESEN`** — hier und im
 *     Header, sobald sie aktiv ist. Sie ist nie ein Ort, an dem etwas entsteht.
 *
 * **Die Wörter kommen von aussen** (V-165): das interne Portal spricht zwei
 * Sprachen (D-592), und der Umschalter steht seit V-165 auf jeder seiner
 * Seiten. Ohne Angabe gilt Deutsch — die Vorschau unter `/dev/portal`.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BereichsAvatar } from '@/components/ui/AreaBadge';
import { StatusPill } from '@/components/ui/StatusPill';
import { Marke } from '@/components/marke/Marke';
import { ausloeserName, BEREICHSWECHSEL_TEXTE } from '@/lib/i18n/verwaltung/bereichswechsel';
import type { UmschalterBereich, UmschalterTexte } from './typen';

export interface BereichsUmschalterProps {
  readonly bereiche: readonly UmschalterBereich[];
  readonly aktiv: string | null;
  /** `true`, wenn die Gruppenübersicht der aktive Kontext ist. */
  readonly gruppenansicht?: boolean;
  /** Darf der Benutzer die Gruppenübersicht überhaupt sehen? */
  readonly gruppeSichtbar?: boolean;
  readonly onWechsel: (mandantId: string | null) => void;
  readonly texte?: UmschalterTexte;
  /** Die Sitzungssprache — für die `NUR LESEN`-Pille. */
  readonly sprache?: string | null;
  /**
   * In der Kopfzeile des Portals steht neben dem Auslöser schon der
   * Seitentitel; unter `lg` trägt der Auslöser dann nur Zeichen und Chevron,
   * der Name erscheint ab `lg` (DESIGN §8: keine Zeile über den Rand).
   *
   * **Ab `lg` und nicht ab `sm`.** Zwischen 640 und 1024 px steht rechts die
   * ganze Sitzungsnavigation (Bereich, Konto, Website, Sprache, Abmelden) —
   * dazu ein Auslöser mit vollem Firmennamen, und die Zeile lief über den
   * Rand. Der Name steht dort trotzdem: als Seitentitel daneben.
   */
  readonly knapp?: boolean;
}

/** Das Zeichen einer Zeile: der Avatar im Hue — oder, ohne eigenen Hue, das der Gruppe. */
function Zeichen({ bereich, aktiv = false }: {
  readonly bereich: UmschalterBereich['bereich']; readonly aktiv?: boolean;
}) {
  if (bereich !== null) return <BereichsAvatar bereich={bereich} aktiv={aktiv} />;
  return (
    <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center">
      <Marke art="gruppe" groesse="md" />
    </span>
  );
}

export function BereichsUmschalter({
  bereiche, aktiv, gruppenansicht = false, gruppeSichtbar = true, onWechsel,
  texte = BEREICHSWECHSEL_TEXTE.de, sprache = null, knapp = false,
}: BereichsUmschalterProps) {
  const [offen, setOffen] = useState(false);
  const [fokus, setFokus] = useState(0);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const zeilen: readonly (string | null)[] = [
    ...bereiche.map((b) => b.id),
    ...(gruppeSichtbar ? [null] : []),
  ];
  /*
   * Wo der Fokus beim Öffnen steht — als ZAHL (V-169). `zeilen` entsteht bei
   * jedem Rendern neu; als Abhängigkeit meldete es den globalen ⌘K-Listener
   * bei jedem Rendern ab und wieder an. Die Zahl ändert sich nur, wenn sich
   * der aktive Bereich oder die Liste wirklich ändert.
   */
  const startFokus = Math.max(0, zeilen.indexOf(aktiv));

  const schliessen = useCallback(() => {
    setOffen(false);
    knopfRef.current?.focus();
  }, []);

  // ⌘K öffnet — DESIGN §6 Regel 5. Global, weil der Umschalter der eine
  // Ortswechsel der Anwendung ist und nicht erst gesucht werden soll.
  useEffect(() => {
    function beiTaste(e: KeyboardEvent): void {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOffen((o) => !o);
        setFokus(startFokus);
      }
    }
    window.addEventListener('keydown', beiTaste);
    return () => { window.removeEventListener('keydown', beiTaste); };
  }, [startFokus]);

  useEffect(() => {
    if (!offen) return undefined;
    function beiKlick(e: MouseEvent): void {
      if (!listeRef.current?.contains(e.target as Node)
          && !knopfRef.current?.contains(e.target as Node)) setOffen(false);
    }
    document.addEventListener('mousedown', beiKlick);
    return () => { document.removeEventListener('mousedown', beiKlick); };
  }, [offen]);

  useEffect(() => {
    if (offen) listeRef.current?.querySelector<HTMLElement>('[data-fokus="true"]')?.focus();
  }, [offen, fokus]);

  const aktiverBereich = bereiche.find((b) => b.id === aktiv);
  /* Dieselbe Regel, nach der der Rahmen entscheidet, ob daneben noch ein Logo steht. */
  const name = ausloeserName(bereiche, aktiv, gruppenansicht, texte);

  /**
   * Regel 1. Ein Bereich und keine Gruppenübersicht: ein statisches Logo.
   * Der Rest der Komponente wird nicht gerendert, nicht versteckt.
   */
  if (bereiche.length <= 1 && !gruppeSichtbar) {
    const einziger = bereiche[0];
    return (
      <div className="flex h-11 items-center gap-s2 px-s2" data-cse="logo-statisch">
        {einziger !== undefined && <Zeichen bereich={einziger.bereich} />}
        <span className="text-sm font-semibold text-text">
          {einziger?.name ?? 'CSE'}
        </span>
      </div>
    );
  }

  function waehle(id: string | null): void {
    setOffen(false);
    onWechsel(id);
  }

  function beiListenTaste(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); schliessen(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFokus((f) => (f + 1) % zeilen.length); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault(); setFokus((f) => (f - 1 + zeilen.length) % zeilen.length); return;
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehle(zeilen[fokus] ?? null); }
  }

  return (
    /*
     * `min-w-0` hier, `max-w-full` am Knopf und `truncate` am Namen: ein
     * langer Firmenname (ein fünfter Bereich, TEN-08) wird gekürzt, statt die
     * Kopfzeile über den Rand zu schieben (DESIGN §8).
     */
    <div className="relative min-w-0">
      <button
        ref={knopfRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-controls={offen ? menuId : undefined}
        onClick={() => { setOffen((o) => !o); setFokus(startFokus); }}
        aria-label={`${texte.ausloeser}: ${name}`}
        className="flex h-11 min-w-11 max-w-full items-center gap-s2 rounded-md px-s2
                   hover:bg-surface-2"
        data-cse="umschalter-ausloeser"
      >
        {gruppenansicht || aktiverBereich === undefined
          ? <Zeichen bereich={null} />
          : <Zeichen bereich={aktiverBereich.bereich} />}
        <span className={`truncate text-sm font-semibold text-text ${knapp ? 'hidden lg:inline' : ''}`}>
          {name}
        </span>
        {gruppenansicht && !knapp && <StatusPill zustand="Nur Lesen" sprache={sprache} />}
        <span aria-hidden className="text-text-muted" data-cse="chevron">⌄</span>
      </button>

      {offen && (
        <div
          ref={listeRef}
          id={menuId}
          role="menu"
          aria-label={texte.kopf}
          onKeyDown={beiListenTaste}
          data-cse="umschalter-menue"
          className="cse-klappmenue absolute start-0 z-50 mt-s2 w-[320px] rounded-lg
                     bg-surface-2 p-s2 shadow-pop"
        >
          <p className="px-s2 py-s1 text-micro uppercase tracking-[0.08em] text-text-subtle">
            {texte.kopf}
          </p>

          {bereiche.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              data-fokus={fokus === i}
              tabIndex={fokus === i ? 0 : -1}
              onFocus={() => { setFokus(i); }}
              onClick={() => { waehle(b.id); }}
              aria-current={b.id === aktiv && !gruppenansicht ? 'true' : undefined}
              className={`flex w-full items-center gap-s3 rounded-md p-s2 text-left hover:bg-surface-3
                ${b.id === aktiv && !gruppenansicht ? 'bg-surface-3' : ''}`}
            >
              <Zeichen bereich={b.bereich} aktiv={b.id === aktiv && !gruppenansicht} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-text">{b.name}</span>
                {/* Der Zähler ist LIVE (0417). `null` heisst: kein Gewerk und
                    kein Zähler, den dieser Mensch lesen darf — dann steht dort
                    nichts, und keine erfundene Null. */}
                {b.unterzeile !== null && (
                  <span className="truncate text-xs text-text-muted" data-cse="umschalter-zaehler">
                    {b.unterzeile}
                  </span>
                )}
              </span>
              {b.id === aktiv && !gruppenansicht && (
                <span aria-hidden className="ml-auto text-brand">✓</span>
              )}
            </button>
          ))}

          {gruppeSichtbar && (
            <>
              <hr className="my-s2 border-0 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                data-fokus={fokus === bereiche.length}
                tabIndex={fokus === bereiche.length ? 0 : -1}
                onFocus={() => { setFokus(bereiche.length); }}
                onClick={() => { waehle(null); }}
                aria-current={gruppenansicht ? 'true' : undefined}
                data-cse="gruppenuebersicht"
                className="flex w-full items-center gap-s3 rounded-md p-s2 text-left hover:bg-surface-3"
              >
                <span aria-hidden className="text-text-muted">⊞</span>
                <span className="text-sm text-text-muted">{texte.gruppenuebersicht}</span>
                <span className="ms-auto"><StatusPill zustand="Nur Lesen" sprache={sprache} /></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

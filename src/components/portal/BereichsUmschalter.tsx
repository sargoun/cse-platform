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
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BereichsAvatar } from '@/components/ui/AreaBadge';
import { StatusPill } from '@/components/ui/StatusPill';
import type { UmschalterBereich } from './typen';

export interface BereichsUmschalterProps {
  readonly bereiche: readonly UmschalterBereich[];
  readonly aktiv: string | null;
  /** `true`, wenn die Gruppenübersicht der aktive Kontext ist. */
  readonly gruppenansicht?: boolean;
  /** Darf der Benutzer die Gruppenübersicht überhaupt sehen? */
  readonly gruppeSichtbar?: boolean;
  readonly onWechsel: (mandantId: string | null) => void;
}

export function BereichsUmschalter({
  bereiche, aktiv, gruppenansicht = false, gruppeSichtbar = true, onWechsel,
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
        setFokus(Math.max(0, zeilen.indexOf(aktiv)));
      }
    }
    window.addEventListener('keydown', beiTaste);
    return () => { window.removeEventListener('keydown', beiTaste); };
  }, [aktiv, zeilen]);

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

  /**
   * Regel 1. Ein Bereich und keine Gruppenübersicht: ein statisches Logo.
   * Der Rest der Komponente wird nicht gerendert, nicht versteckt.
   */
  if (bereiche.length <= 1 && !gruppeSichtbar) {
    const einziger = bereiche[0];
    return (
      <div className="flex h-11 items-center gap-s2 px-s2" data-cse="logo-statisch">
        {einziger !== undefined && <BereichsAvatar bereich={einziger.bereich} />}
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
    <div className="relative">
      <button
        ref={knopfRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-controls={offen ? menuId : undefined}
        onClick={() => { setOffen((o) => !o); setFokus(Math.max(0, zeilen.indexOf(aktiv))); }}
        className="flex h-11 items-center gap-s2 rounded-md px-s2 hover:bg-surface-2"
        data-cse="umschalter-ausloeser"
      >
        {aktiverBereich !== undefined && <BereichsAvatar bereich={aktiverBereich.bereich} />}
        <span className="text-sm font-semibold text-text">
          {gruppenansicht ? 'Gruppenübersicht' : aktiverBereich?.name ?? 'Bereich wählen'}
        </span>
        {gruppenansicht && <StatusPill zustand="Nur Lesen" />}
        <span aria-hidden className="text-text-muted" data-cse="chevron">⌄</span>
      </button>

      {offen && (
        <div
          ref={listeRef}
          id={menuId}
          role="menu"
          aria-label="Bereich wechseln"
          onKeyDown={beiListenTaste}
          data-cse="umschalter-menue"
          className="absolute left-0 z-50 mt-s2 w-[320px] rounded-lg bg-surface-2 p-s2 shadow-pop"
        >
          <p className="px-s2 py-s1 text-micro uppercase tracking-[0.08em] text-text-subtle">
            Bereich wechseln
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
              <BereichsAvatar bereich={b.bereich} aktiv={b.id === aktiv && !gruppenansicht} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-text">{b.name}</span>
                <span className="truncate text-xs text-text-muted">
                  {b.gewerk}
                  {/* Der Zähler ist LIVE. `null` heisst: der Benutzer hält
                      `gruppe.bericht.lesen` nicht — dann steht dort nichts,
                      und keine erfundene Null. */}
                  {b.zaehler !== null && ` · ${b.zaehler} ${b.zaehlerWort}`}
                </span>
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
                <span className="text-sm text-text-muted">Gruppenübersicht</span>
                <span className="ml-auto"><StatusPill zustand="Nur Lesen" /></span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import type { SchrittZeile } from '@/server/agent/laufzeit';
import { beschriftung } from '@/lib/i18n/beschriftung/basis';
import { WERKZEUG_TEXT } from '@/lib/i18n/beschriftung/agent';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Die Schrittkette als Tabelle — dieselbe auf dem Aufgaben- und auf dem
 * Protokollbildschirm.
 *
 * Zweimal geschrieben wären es zwei Tabellen, die sich beim nächsten Feld
 * unterscheiden; und ausgerechnet hier ist die Gleichheit der Punkt: der
 * Nachweis, was gelaufen ist, sieht überall gleich aus.
 */

const PILLE: Readonly<Record<string, PillZustand>> = {
  erfolg: 'Abgeschlossen',
  fehler: 'Fehler',
  abgelehnt_richtlinie: 'Abgelehnt',
  uebersprungen: 'Archiviert',
};

/** Millisekunden, wie ein Mensch sie liest: `840 ms`, `2,4 s`, `1:05 min`. */
export function dauerText(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const sekunden = Math.round(ms / 1000);
  return `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')} min`;
}

export function Schrittkette({ zeilen }: { readonly zeilen: readonly SchrittZeile[] }) {
  if (zeilen.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
        Kein Schritt protokolliert.
      </p>
    );
  }

  return (
    <DataTable
      beschriftung="Schritte mit Werkzeug, Modell, Tokens, Kosten und Dauer"
      zeilen={zeilen}
      schluessel={(s) => s.id}
      spalten={[
        { schluessel: 'nr', kopf: 'Nr.', numerisch: true, zelle: (s) => String(s.nummer) },
        {
          schluessel: 'werkzeug',
          kopf: 'Werkzeug',
          zelle: (s) => (s.werkzeug === null
            ? <span className="text-text-subtle">—</span>
            : <span title={s.werkzeug}>{beschriftung(WERKZEUG_TEXT, s.werkzeug)}</span>),
        },
        {
          schluessel: 'modell',
          kopf: 'Modell',
          zelle: (s) => s.modell ?? <span className="text-text-subtle">—</span>,
        },
        {
          schluessel: 'tokens',
          kopf: 'Tokens',
          numerisch: true,
          zelle: (s) => `${s.tokensEingabe} / ${s.tokensAusgabe}`,
        },
        {
          schluessel: 'kosten',
          kopf: 'Kosten',
          numerisch: true,
          zelle: (s) => formatiereGeld(cent(s.kostenCent)),
        },
        { schluessel: 'dauer', kopf: 'Dauer', numerisch: true, zelle: (s) => dauerText(s.dauerMs) },
        { schluessel: 'wann', kopf: 'Begonnen', zelle: (s) => s.begonnenAm },
        {
          schluessel: 'status',
          kopf: 'Zustand',
          zelle: (s) => (
            <span className="inline-flex flex-wrap items-center gap-s2">
              <StatusPill zustand={eigenerEintrag(PILLE, s.status) ?? 'Abgeschlossen'} />
              {s.injektionsverdacht
                ? <span className="text-xs text-danger">Injektionsverdacht</span>
                : null}
              {s.nutzlastGeloescht
                ? <span className="text-xs text-text-subtle">Nutzlast geschwärzt</span>
                : null}
            </span>
          ),
        },
      ]}
    />
  );
}

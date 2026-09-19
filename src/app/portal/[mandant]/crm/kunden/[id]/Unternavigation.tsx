import Link from 'next/link';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';

/**
 * Die Unternavigation des Kundenblatts — Übersicht · Konditionen · Steuer ·
 * Portalzugang (04-SEITENKARTE §5.2).
 *
 * **Warum es diese Datei gibt und nicht viermal denselben Absatz.** Die
 * Seitenkarte führt für `/crm/kunden/[id]` die Reiter „Übersicht ·
 * Ansprechpartner · Objekte · Aufträge · … · Portalzugang". Drei davon sind
 * eigene Adressen; ohne Verweise wären sie nur über die Adresszeile
 * erreichbar — gebaut und unauffindbar.
 *
 * **Jeder Reiter kennt sein RECHT.** Die drei Unterseiten öffnen mit
 * verschiedenen Rechten (`crm_entgelt.lesen`, `abrechnung.lesen`,
 * `system.benutzer_verwalten`), und wer eines nicht hält, bekommt hinter dem
 * Verweis ein 404. Ein Menüpunkt, der auf 404 führt, ist schlechter als
 * keiner — er verrät die Existenz dessen, was er nicht zeigen darf (AUT-06,
 * dieselbe Begründung wie in `app/portal/rechte.ts`). Der Aufrufer fragt die
 * Rechte mit `haeltRechte` und übergibt sie hier.
 */
export interface UnternavigationProps {
  readonly mandant: string;
  readonly kundeId: string;
  /** Welcher Reiter ist die aktuelle Seite? */
  readonly aktiv: 'uebersicht' | 'konditionen' | 'steuer' | 'zugang';
  /** Je Rechteschlüssel: hält diese Sitzung es? Aus `haeltRechte`. */
  readonly rechte: Readonly<Record<string, boolean>>;
}

const REITER = [
  { schluessel: 'uebersicht', titel: 'Übersicht', pfad: '', recht: null },
  {
    schluessel: 'konditionen', titel: 'Konditionen', pfad: '/konditionen',
    recht: 'crm_entgelt.lesen',
  },
  { schluessel: 'steuer', titel: 'Steuer', pfad: '/steuer', recht: 'abrechnung.lesen' },
  {
    schluessel: 'zugang', titel: 'Portalzugang', pfad: '/zugang',
    recht: 'system.benutzer_verwalten',
  },
] as const;

export function Unternavigation({
  mandant, kundeId, aktiv, rechte,
}: UnternavigationProps) {
  const wurzel = `/portal/${mandant}/crm/kunden/${kundeId}`;
  const sichtbar = REITER.filter(
    (r) => r.recht === null || rechte[r.recht] === true || r.schluessel === aktiv,
  );
  return (
    <nav aria-label="Kundenblatt" className="mb-s5" data-cse="kunde-unternavigation">
      <ul className="m-0 flex list-none flex-wrap gap-s4 border-b border-line p-0 pb-s2">
        {sichtbar.map((r) => (
          <li key={r.schluessel}>
            <Link
              href={alsRoute(`${wurzel}${r.pfad}`)}
              aria-current={r.schluessel === aktiv ? 'page' : undefined}
              data-cse={`reiter-${r.schluessel}`}
              className={r.schluessel === aktiv
                ? 'text-sm font-semibold text-text'
                : 'text-sm text-text-muted underline-offset-2 hover:text-text hover:underline'}
            >
              {r.titel}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TABLEISTEN, type TabZiel } from '../../src/server/registry/tableiste.js';
import { ROUTEN } from '../../src/server/registry/routen.generiert.js';

/**
 * **Jedes Ziel einer Tab-Leiste muss auf eine GEBAUTE Seite führen.**
 *
 * **Der Befund, der diese Datei nötig machte — wieder ein Nutzerbericht.** Ein
 * Nutzer öffnete am Telefon als Mitarbeiter die untere Leiste und landete auf
 * „Dieses Modul wird noch gebaut" — zweimal. Nachgezählt: **zwei von fünf**
 * Zielen des Arbeiterportals führten ins Leere (`Nachrichten` →
 * `/portal/mein/nachrichten`, Phase 3; `Profil` → `/portal/konto/profil`,
 * Phase 1), und in der Gruppenleiste ein drittes (`Radar`, Phase 8).
 *
 * Unter 768 px IST diese Leiste die ganze Navigation (SEITENKARTE §11.2). Ein
 * Fünftel davon, das zuverlässig auf eine Bauzustandsseite führt, ist für die
 * Reinigungskraft im Treppenhaus keine halbe App — es ist eine kaputte.
 *
 * **Warum es nirgends rot wurde.** Die Leisten sind von Hand gepflegt, das
 * Seitenverzeichnis wächst getrennt davon, und keine Prüfung verband beides.
 * Jede Datei einzeln richtig; zusammen ein totes Ziel. Dieselbe Sorte Lücke
 * wie beim Job-Register (D-540) — nur eine Ebene weiter vorn, wo sie jeder
 * Nutzer sieht und niemand meldet, weil sie aussieht wie Absicht.
 *
 * **Die Ausnahmeliste schrumpft und rostet nicht.** Was hier steht, ist
 * begründet und wird von der zweiten Prüfung überwacht: sobald eine Seite
 * gebaut ist, MUSS ihr Eintrag hier verschwinden. Eine Ausnahmeliste, die
 * stehen bleibt, nachdem der Grund weg ist, ist genau die stille Lüge, gegen
 * die diese Datei geschrieben ist.
 */
const WURZEL = resolve(import.meta.dirname, '../..');

/**
 * Ziele, die heute bewusst offen sind — mit dem Kästchen, das sie deckt.
 *
 * Jeder Eintrag nennt die ROADMAP-Stelle, die noch offen ist. Steht dort kein
 * offenes Kästchen, gehört das Ziel nicht hierher, sondern gebaut.
 */
const NOCH_OFFEN: Readonly<Record<string, string>> = {
  /*
   * Das Kundenportal ist in der ROADMAP ein OFFENES Kaestchen (Phase 3,
   * „Customer portal"). Seine Leiste zeigt deshalb auf Seiten, die noch nicht
   * dran sind — das ist Absicht und keine Luecke.
   */
  '/portal/kunde/auftraege': 'ROADMAP Phase 3 — Customer portal, Kästchen offen',
  '/portal/kunde/rechnungen': 'ROADMAP Phase 3 — Customer portal, Kästchen offen',
  '/portal/kunde/nachweise': 'ROADMAP Phase 3 — Customer portal, Kästchen offen',
  '/portal/kunde/nachrichten': 'ROADMAP Phase 3 — Customer portal, Kästchen offen',
  /* Radar-Gruppenansicht: Phase 8 liefert die Mandantensicht, die Gruppensicht
     steht als eigene Zeile noch aus. */
  '/portal/gruppe/radar': 'Gruppensicht des Radars — eigene Zeile, noch nicht gebaut',
  /*
   * **Diese zwei sind KEINE Absicht, sondern die offene Baustelle.**
   *
   * Sie sind der Befund, der diese Datei ausgeloest hat: zwei von fuenf Zielen
   * des Arbeiterportals, beide aus einer Phase, die die ROADMAP abhakt. Sie
   * stehen hier, damit die Pruefung heute nicht rot ist, waehrend sie gebaut
   * werden — und die dritte Pruefung unten wirft sie in dem Moment hinaus, in
   * dem die Seite existiert. Ein Eintrag, der ueberlebt, nachdem die Seite da
   * ist, laesst die Suite fehlschlagen; er kann also nicht liegen bleiben.
   */
  '/portal/mein/nachrichten': 'Phase 3 abgehakt, Seite fehlt — wird gebaut (EMP-11, NOT-03)',
  '/portal/konto/profil': 'Phase 1 abgehakt, Seite fehlt — wird gebaut (EMP-12: Sprachwahl)',
};

/** Die Wurzel, unter der eine Leiste hängt — `[mandant]` als Musterwert. */
const WURZELN: Readonly<Record<string, string>> = {
  mandant: '/portal/[mandant]',
  mein: '/portal/mein',
  kunde: '/portal/kunde',
  gruppe: '/portal/gruppe',
};

function zielPfad(leisteFamilie: string, ziel: TabZiel): string {
  // Absolut: das Ziel verlaesst sein Portal (`Profil` → `/portal/konto/profil`).
  if (ziel.pfad.startsWith('/')) return ziel.pfad;
  const wurzel = WURZELN[leisteFamilie] ?? '/portal/[mandant]';
  return ziel.pfad === '' ? wurzel : `${wurzel}/${ziel.pfad}`;
}

/**
 * Gebaut = es gibt eine eigene `page.tsx` auf genau diesem Segmentpfad.
 *
 * Ein Auffang (`[...rest]`) zaehlt ausdruecklich NICHT: er ist die
 * Platzhalterseite, und genau sie ist der Befund.
 */
function gebaut(pfad: string): boolean {
  return existsSync(resolve(WURZEL, 'src/app', `${pfad.replace(/^\//u, '')}/page.tsx`));
}

/** Alle Ziele ausser `Mehr` — das hat keinen eigenen Pfad, es oeffnet ein Blatt. */
function alleZiele(): readonly { leiste: string; pfad: string; label: string }[] {
  return TABLEISTEN.flatMap((l) => l.ziele
    .filter((z) => z.schluessel !== 'mehr')
    .map((z) => ({ leiste: l.schluessel, pfad: zielPfad(l.familie, z), label: z.label })));
}

describe('Die Tab-Leisten zeigen auf Seiten, die es gibt (SEITENKARTE §11.2)', () => {
  it('jedes Ziel steht im Routenmanifest — sonst ist es ein 404', () => {
    const bekannt = new Set(ROUTEN.map((r) => r.pfad));
    const fremd = alleZiele()
      .filter((z) => !bekannt.has(z.pfad))
      .map((z) => `${z.leiste}/${z.label} → ${z.pfad}`);
    expect(fremd, 'Ein Ziel, das im Manifest fehlt, fällt auf 404 statt auf den Platzhalter')
      .toEqual([]);
  });

  it('und jedes Ziel hat eine eigene Seite — kein Ziel landet auf dem Platzhalter', () => {
    const tot = alleZiele()
      .filter((z) => !gebaut(z.pfad))
      .filter((z) => !(z.pfad in NOCH_OFFEN))
      .map((z) => `${z.leiste}/${z.label} → ${z.pfad}`);
    expect(
      tot,
      'Unter 768px IST die Leiste die ganze Navigation. Ein Ziel, das auf '
      + '„Dieses Modul wird noch gebaut" führt, ist für die Nutzerin eine kaputte App — '
      + 'entweder die Seite bauen oder das Ziel aus der Leiste nehmen.',
    ).toEqual([]);
  });

  it('die Ausnahmeliste rostet nicht: was gebaut ist, verschwindet daraus', () => {
    /*
     * Ohne diese Pruefung bliebe ein Eintrag stehen, nachdem sein Grund
     * weggefallen ist — und die Liste waere binnen zweier Runden eine
     * Sammlung von Saetzen, die einmal gestimmt haben.
     */
    const erledigt = Object.keys(NOCH_OFFEN).filter((p) => gebaut(p));
    expect(erledigt, 'gebaut — Eintrag aus NOCH_OFFEN entfernen').toEqual([]);
  });

  it('und jede Ausnahme ist wirklich ein Ziel einer Leiste', () => {
    const ziele = new Set(alleZiele().map((z) => z.pfad));
    const verwaist = Object.keys(NOCH_OFFEN).filter((p) => !ziele.has(p));
    expect(verwaist, 'steht in NOCH_OFFEN, ist aber kein Leistenziel mehr').toEqual([]);
  });

  it('jede Leiste trägt genau fünf Ziele (SEITENKARTE §11.2)', () => {
    for (const l of TABLEISTEN) {
      expect(l.ziele.length, l.schluessel).toBe(5);
    }
  });
});

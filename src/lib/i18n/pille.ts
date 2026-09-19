/**
 * Die Beschriftung eines Statuspunkts in allen vier Portalsprachen.
 *
 * **Warum nicht in `StatusPill.tsx` selbst.** Die Pille steht in beiden
 * Welten: im Verwaltungsportal (de/en) und im Arbeiterportal (de/en/ar/tr,
 * EMP-12, SPEC §10). Eine Tabelle im Bauteil haette sich fuer eine der beiden
 * entscheiden muessen — und die Wahl `de/en` haette der Arbeiterin, die
 * Arabisch eingestellt hat, weiter ein deutsches Wort gezeigt. Genau das war
 * der Befund: dreizehn Bildschirme des Arbeiterportals, das als umgestellt
 * galt.
 *
 * **Der deutsche Zustand bleibt der SCHLUESSEL** (DESIGN §5). Er waehlt die
 * Farbe; die Sprache faerbt nur das Wort. `zustand="Overdue"` gibt es nicht
 * und darf es nicht geben — zwei Schreibweisen desselben Zustands waeren zwei
 * Zustaende in jedem `Record` dieser Anwendung, und der zweite haette still
 * keine Farbe.
 *
 * **Diese sechzehn sind Beschriftungen, keine Fachbegriffe.** `Mandant`,
 * `Leistungsnachweis` und `Aufmass` bleiben in jeder Sprache deutsch, weil sie
 * Rechtsbedeutung tragen (VOB, GoBD, UStG). `Ueberfaellig` traegt keine: es
 * ist das Wort auf einem farbigen Punkt. Und DESIGN §9 sagt, Farbe ist nie das
 * einzige Signal — ein Signal in einer Sprache, die der Leser nicht lesen
 * kann, IST Farbe allein.
 */
import { istPortalSprache, type PortalSprache } from './texte.js';

export type PillZustand =
  | 'In Arbeit' | 'Aktiv' | 'Bereit'
  | 'Geplant' | 'In Prüfung' | 'Entwurf'
  | 'Angebot' | 'Offen' | 'Wartet'
  | 'Nur Lesen'
  | 'Überfällig' | 'Abgelehnt' | 'Fehler'
  | 'Abgeschlossen' | 'Archiviert'
  | 'Inaktiv';

export const PILLE_TEXTE:
Readonly<Record<PortalSprache, Readonly<Record<PillZustand, string>>>> = {
  de: {
    'In Arbeit': 'In Arbeit', Aktiv: 'Aktiv', Bereit: 'Bereit',
    Geplant: 'Geplant', 'In Prüfung': 'In Prüfung', Entwurf: 'Entwurf',
    Angebot: 'Angebot', Offen: 'Offen', Wartet: 'Wartet',
    'Nur Lesen': 'Nur Lesen',
    'Überfällig': 'Überfällig', Abgelehnt: 'Abgelehnt', Fehler: 'Fehler',
    Abgeschlossen: 'Abgeschlossen', Archiviert: 'Archiviert', Inaktiv: 'Inaktiv',
  },
  en: {
    'In Arbeit': 'In progress', Aktiv: 'Active', Bereit: 'Ready',
    Geplant: 'Scheduled', 'In Prüfung': 'Under review', Entwurf: 'Draft',
    Angebot: 'Quoted', Offen: 'Open', Wartet: 'Waiting',
    'Nur Lesen': 'Read only',
    'Überfällig': 'Overdue', Abgelehnt: 'Rejected', Fehler: 'Error',
    Abgeschlossen: 'Closed', Archiviert: 'Archived', Inaktiv: 'Inactive',
  },
  ar: {
    'In Arbeit': 'قيد التنفيذ', Aktiv: 'نشط', Bereit: 'جاهز',
    Geplant: 'مُجدوَل', 'In Prüfung': 'قيد المراجعة', Entwurf: 'مسودة',
    Angebot: 'عرض سعر', Offen: 'مفتوح', Wartet: 'في الانتظار',
    'Nur Lesen': 'للقراءة فقط',
    'Überfällig': 'متأخر', Abgelehnt: 'مرفوض', Fehler: 'خطأ',
    Abgeschlossen: 'مكتمل', Archiviert: 'مؤرشف', Inaktiv: 'غير نشط',
  },
  tr: {
    'In Arbeit': 'Devam ediyor', Aktiv: 'Etkin', Bereit: 'Hazır',
    Geplant: 'Planlandı', 'In Prüfung': 'İncelemede', Entwurf: 'Taslak',
    Angebot: 'Teklif', Offen: 'Açık', Wartet: 'Bekliyor',
    'Nur Lesen': 'Salt okunur',
    'Überfällig': 'Gecikmiş', Abgelehnt: 'Reddedildi', Fehler: 'Hata',
    Abgeschlossen: 'Tamamlandı', Archiviert: 'Arşivlendi', Inaktiv: 'Etkin değil',
  },
};

/**
 * Die Sprache der Pille — DIREKT aus der Portalsprache, nicht ueber
 * `internSprache`.
 *
 * **Das ist eine Entscheidung, keine Bequemlichkeit.** `internSprache` bildet
 * `ar` und `tr` auf Deutsch ab, weil die Verwaltungsbildschirme in diesen
 * Sprachen nicht existieren (D-592). Die PILLE existiert in ihnen. Wer
 * Tuerkisch eingestellt hat und eine Verwaltungsseite oeffnet, liest deshalb
 * ein tuerkisches Wort auf einem sonst deutschen Bildschirm — und das ist
 * besser, nicht schlechter: es ist das eine Wort dort, das er lesen kann. Die
 * deutsche Umgebung ist die bestehende Grenze, nicht eine, die die Pille
 * hinzufuegt.
 *
 * Fehlt die Angabe, gilt Deutsch — dieselbe Regel wie ueberall sonst.
 */
export function pilleSprache(sprache: string | null | undefined): PortalSprache {
  return typeof sprache === 'string' && istPortalSprache(sprache) ? sprache : 'de';
}

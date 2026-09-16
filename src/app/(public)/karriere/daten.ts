import 'server-only';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { aufbewahrungTage } from '@/server/services/recruiting/dienst';

/**
 * Was die Karriereseite liest — ohne Sitzung, wie jede öffentliche Seite.
 *
 * **Die Auswahl macht die Policy, nicht diese Datei.** `t_stelle_oeffentlich`
 * (0166) lässt genau `status = 'veroeffentlicht' and geschlossen_am is null`
 * durch; ein Entwurf ist hier null Zeilen. Dieselbe Trennung wie bei den
 * Beiträgen (0163) und aus demselben Grund: ein Text, der versehentlich
 * öffentlich wurde, lässt sich nicht zurückholen.
 */
export interface OffeneStelle {
  readonly id: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort: string | null;
  readonly wochenstunden: string | null;
  readonly bewerbungsfrist: string | null;
  readonly mandantSlug: string;
  readonly mandantName: string;
}

const FELDER = `
  s.id, s.titel, s.beschreibung, s.anforderungen, s.einsatzort,
  s.wochenstunden::text     as wochenstunden,
  s.bewerbungsfrist::text   as bewerbungsfrist,
  m.slug                    as "mandantSlug",
  m.name                    as "mandantName"`;

export async function offeneStellen(): Promise<readonly OffeneStelle[]> {
  return oeffentlichLesen((kontext) => kontext.abfrage<OffeneStelle>(
    `select ${FELDER}
       from stelle s
       join mandant m on m.id = s.mandant_id
      where s.status = 'veroeffentlicht' and s.geschlossen_am is null
      order by s.veroeffentlicht_am desc
      limit 50`));
}

export async function offeneStelle(id: string): Promise<OffeneStelle | null> {
  const zeilen = await oeffentlichLesen((kontext) => kontext.abfrage<OffeneStelle>(
    `select ${FELDER}
       from stelle s
       join mandant m on m.id = s.mandant_id
      where s.id = $1::uuid
        and s.status = 'veroeffentlicht' and s.geschlossen_am is null`,
    [id]));
  return zeilen[0] ?? null;
}

/** Die Bereiche für die Initiativbewerbung — dieselbe Liste wie im Kopf. */
export async function bereiche(): Promise<readonly { slug: string; name: string }[]> {
  return oeffentlichLesen((kontext) => kontext.abfrage<{ slug: string; name: string }>(
    `select slug, name from mandant where archiviert_am is null order by name`));
}

/**
 * Die Aufbewahrungsfrist in Tagen — für die Auskunft nach Art. 13 DSGVO.
 *
 * **Warum `null` statt eines Werts aus dieser Datei.** Die Frist ist ein
 * Platzhalter (O-373) und gehört dem Mandanten; eine Zahl, die eine
 * Öffentlichkeitsseite ersatzweise nennt, ist eine Zusage, die niemand
 * getroffen hat. Fehlt die Einstellung, nennt die Seite deshalb keine Dauer —
 * der Satz bleibt richtig, nur unschärfer.
 *
 * **Und sie wirft nicht.** `aufbewahrungTage()` wirft absichtlich, wo eine
 * Bewerbung ohne Uhr entstünde (REC-07). Hier entsteht nichts, hier wird
 * Auskunft gegeben. Eine Dankesseite, die wegen einer fehlenden Einstellung mit
 * einem Fehlerbildschirm endet, lässt den Menschen glauben, seine Bewerbung
 * sei nicht angekommen — und sie ist es.
 */
export async function aufbewahrungsfristTage(): Promise<number | null> {
  try {
    return await oeffentlichLesen((kontext) => aufbewahrungTage(kontext));
  } catch {
    return null;
  }
}

import type postgres from 'postgres';
import { PLATTFORMEN, PLATTFORM_NAME } from '../../services/social/port.js';

/**
 * Das Social Media Center für die Vorführung (SOC-01…SOC-08).
 *
 * **Die Kanäle entstehen IMMER, auch ohne Demoflagge.** Sie sind kein
 * Demodatum, sondern die Struktur: eine Gesellschaft hat fünf mögliche
 * Plattformen, und ob dort ein Konto hängt, ist eine Tatsache (heute: keines,
 * O-10). Ein leerer Kanalbildschirm wäre kein ehrlicher Stand, sondern ein
 * unfertiger.
 *
 * **Die Beiträge entstehen nur mit `CSE_DEV_FLAECHEN`.** Sie sind Text, der
 * auf einer öffentlichen Gesellschaftsseite landet — in einem echten Bau hat
 * dort nichts zu stehen, was niemand geschrieben hat.
 *
 * **Jede Gesellschaft bekommt jeden Zustand.** Entwurf, In Prüfung,
 * Freigegeben, Geplant und Veröffentlicht: sonst sind die Filter der
 * Beitragsliste leer und die Statistik zeigt eine einzige Säule. Der
 * veröffentlichte trägt ein Ergebnis je Kanal — und das ist bei allen fünf
 * `nicht_verbunden`, weil genau das der Stand ist.
 */

export interface SocialErgebnis {
  readonly kanaele: number;
  readonly beitraege: number;
  readonly referenzen: number;
  readonly uebersprungen: boolean;
}

/** Ein Satz Beiträge je Gewerk — kein erfundener Kunde, kein erfundener Preis. */
const TEXTE: Readonly<Record<string, readonly { titel: string; text: string; art: string }[]>> = {
  reinigung: [
    { titel: 'Grundreinigung nach Umbau — in zwei Nächten fertig',
      text: 'Nach dem Umbau eines Bürohauses in Berlin-Mitte haben wir in zwei Nachtschichten '
        + 'gereinigt: Bauschlussreinigung, Glasflächen innen, Sanitär. Am Montagmorgen war '
        + 'der Betrieb wieder normal.',
      art: 'projektschau' },
    { titel: 'Neu im Team: zwei Objektleitungen',
      text: 'Zwei Kolleginnen haben die Objektleitung für die Innenstadtobjekte übernommen. '
        + 'Beide kommen aus der Unterhaltsreinigung und kennen die Häuser seit Jahren.',
      art: 'neuigkeit' },
    { titel: 'Winterdienst: die Schichten für Dezember stehen',
      text: 'Die Winterdienstschichten für Dezember sind geplant und besetzt. '
        + 'Streugut ist eingelagert, die Räumfolge je Objekt ist abgestimmt.',
      art: 'aktualisierung' },
    { titel: 'Glasreinigung an einer Fassade ohne Gerüst',
      text: 'Eine vierstöckige Fassade, gereinigt mit Teleskopanlage statt Gerüst: '
        + 'weniger Sperrfläche im Hof und ein Tag statt drei.',
      art: 'projektschau' },
  ],
  security: [
    { titel: 'Objektschutz für eine Messewoche',
      text: 'Fünf Tage, drei Schichten, ein Team: Zugangskontrolle, Streifengang und '
        + 'Schlüsselverwaltung für eine Messewoche in Berlin. Jede Schicht mit '
        + 'Wachbuch und lückenloser Übergabe.',
      art: 'projektschau' },
    { titel: 'Sachkundeprüfung § 34a — drei Kollegen bestanden',
      text: 'Drei Kollegen haben die Sachkundeprüfung nach § 34a GewO bestanden. '
        + 'Die Qualifikation ist im Nachweis hinterlegt und läuft nicht ab.',
      art: 'neuigkeit' },
    { titel: 'Neue Dienstanweisung für den Streifengang',
      text: 'Die Dienstanweisung für den Streifengang ist überarbeitet: '
        + 'Kontrollpunkte, Meldewege und Nachweis je Runde stehen jetzt im Wachbuch.',
      art: 'aktualisierung' },
    { titel: 'Schlüsselverwaltung lückenlos',
      text: 'Jede Schlüsselübergabe wird mit Empfänger und Zeitpunkt festgehalten. '
        + 'Wer wann welchen Schlüssel hatte, ist jederzeit belegbar.',
      art: 'neuigkeit' },
  ],
  bau: [
    { titel: 'Dachgeschossausbau Berliner Straße — Rohbau steht',
      text: 'Der Rohbau des Dachgeschossausbaus steht, die Dämmung läuft. '
        + 'Aufmass und Bautagebuch sind tagesaktuell; der Bauherr sieht jeden '
        + 'Eintrag am selben Tag.',
      art: 'projektschau' },
    { titel: 'Rückbau im laufenden Betrieb',
      text: 'Rückbau einer Zwischendecke, während darunter weitergearbeitet wurde: '
        + 'Staubschutzwand, Nachtarbeit, tägliche Abnahme. Kein Ausfalltag für den Mieter.',
      art: 'aktualisierung' },
    { titel: 'Bautagebuch mit Wetter aus amtlicher Quelle',
      text: 'Das Bautagebuch trägt das Wetter des Tages aus der amtlichen Messung, '
        + 'nicht aus der Erinnerung — das zählt, wenn eine Behinderung begründet wird.',
      art: 'aktualisierung' },
    { titel: 'Aufmaß direkt auf der Baustelle',
      text: 'Aufmaße werden vor Ort erfasst und sind sofort in der Abrechnung. '
        + 'Zwischen Messung und Rechnung liegt kein Zettel mehr.',
      art: 'neuigkeit' },
  ],
  operations: [
    { titel: 'Eine Plattform für vier Gesellschaften',
      text: 'Angebote, Dienstpläne, Zeiten, Rechnungen und Nachweise laufen jetzt '
        + 'über eine Plattform — mit getrennten Mandanten und einer gemeinsamen '
        + 'Gruppensicht für die Führung.',
      art: 'neuigkeit' },
    { titel: 'Zeiterfassung nach § 17 MiLoG',
      text: 'Die Arbeitszeiten werden mit der Serveruhr erfasst, nicht mit der des Geräts. '
        + 'Die Aufzeichnung und ihre Gegenprobe nennen dieselbe Summe.',
      art: 'aktualisierung' },
    { titel: 'Vergaberadar: Fristen im Blick',
      text: 'Bekanntmachungen werden bewertet und nach Restfrist sortiert. '
        + 'Unter fünf Tagen fällt eine Frist auf, bevor sie abläuft.',
      art: 'aktualisierung' },
    { titel: 'Freigaben an einer Stelle',
      text: 'Was ein Agent vorschlägt, liegt in einem Posteingang — und wird dort '
        + 'entschieden, protokolliert und verkettet. Nichts geht ohne Menschen hinaus.',
      art: 'neuigkeit' },
  ],
};

/** Eine freigegebene Referenz je Gesellschaft — sonst ist SOC-04 eine leere Liste. */
const REFERENZEN: Readonly<Record<string, { titel: string; kunde: string; text: string }>> = {
  reinigung: { titel: 'Bürohaus Berlin-Mitte — Unterhaltsreinigung',
    kunde: 'Verwaltung Berlin-Mitte',
    text: 'Tägliche Unterhaltsreinigung auf vier Etagen, seit drei Jahren.' },
  security: { titel: 'Messewoche — Objektschutz', kunde: 'Messeveranstalter Berlin',
    text: 'Zugangskontrolle und Streifengang über fünf Tage in drei Schichten.' },
  bau: { titel: 'Dachgeschossausbau Berliner Straße', kunde: 'Hausverwaltung Berliner Straße',
    text: 'Ausbau des Dachgeschosses zu zwei Wohneinheiten, im laufenden Betrieb.' },
  operations: { titel: 'Digitale Betriebsplattform', kunde: 'CSE Gruppe',
    text: 'Eine Plattform für vier Gesellschaften, getrennte Mandanten, eine Gruppensicht.' },
};

export async function seedSocial(
  sql: postgres.Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<SocialErgebnis> {
  let kanaele = 0;
  let beitraege = 0;
  let referenzen = 0;

  for (const [slug, mandantId] of ids) {
    for (const [i, plattform] of PLATTFORMEN.entries()) {
      const [k] = await sql<{ id: string }[]>`
        insert into social_kanal (mandant_id, plattform, anzeigename, handle,
                                  verbunden, hinweis, sortierung)
        values (${mandantId}, ${plattform}::social_plattform,
                ${PLATTFORM_NAME[plattform]}, ${`@cse-${slug}`}, false,
                ${'Nicht verbunden: es ist kein Konto hinterlegt. Offen ist O-10 — '
                  + 'welches Plattformkonto gehört dieser Gesellschaft, wer ist dort '
                  + 'Administrator, und liegt ein Auftragsverarbeitungsvertrag vor?'},
                ${i})
        on conflict (mandant_id, plattform) do nothing
        returning id`;
      if (k !== undefined) kanaele += 1;
    }
  }

  if (!demodaten) return { kanaele, beitraege, referenzen, uebersprungen: true };

  for (const [slug, mandantId] of ids) {
    const r = REFERENZEN[slug];
    if (r !== undefined) {
      const [zeile] = await sql<{ id: string }[]>`
        insert into referenz (mandant_id, titel, kunde_name, beschreibung,
                              freigegeben_vom_kunden, freigabe_am, freigabe_beleg,
                              status, sortierung)
        select ${mandantId}, ${r.titel}, ${r.kunde}, ${r.text},
               true, now() - interval '30 days',
               'Demodatensatz — schriftliche Freigabe liegt NICHT vor (CSE_DEV_FLAECHEN)',
               'veroeffentlicht'::seite_status, 0
         where not exists (select 1 from referenz x
                            where x.mandant_id = ${mandantId} and x.titel = ${r.titel})
        returning id`;
      if (zeile !== undefined) referenzen += 1;
    }

    /*
     * **Vier Zustaende, vier Texte.** Ohne sie sind drei Filter der
     * Beitragsliste leer und die Statistik zeigt eine einzige Saeule -- die
     * Oberflaeche saehe unfertig aus, obwohl sie es nicht ist.
     *
     * Der VORGELEGTE traegt eine OFFENE Freigabe: damit steht er auch im
     * Freigabe-Posteingang, und der Weg von dort zurueck zum Beitrag laesst
     * sich wirklich gehen statt nur behauptet zu werden.
     */
    const saetze = TEXTE[slug] ?? [];
    const zustaende: readonly {
      readonly status: string; readonly geplantFuer: string | null;
      readonly veroeffentlicht: boolean;
    }[] = [
      { status: 'entwurf', geplantFuer: null, veroeffentlicht: false },
      { status: 'veroeffentlicht', geplantFuer: null, veroeffentlicht: true },
      { status: 'vorgelegt', geplantFuer: null, veroeffentlicht: false },
      { status: 'geplant', geplantFuer: 'zukunft', veroeffentlicht: false },
    ];
    for (const [i, z] of zustaende.entries()) {
      const satz = saetze[i];
      if (satz === undefined) continue;
      beitraege += await legeAn(sql, mandantId, { ...satz, ...z });
    }
  }

  return { kanaele, beitraege, referenzen, uebersprungen: false };
}

interface Anlage {
  readonly titel: string;
  readonly text: string;
  readonly art: string;
  readonly status: string;
  readonly geplantFuer: string | null;
  readonly veroeffentlicht: boolean;
}

async function legeAn(
  sql: postgres.Sql, mandantId: string, a: Anlage,
): Promise<number> {
  const [schon] = await sql<{ id: string }[]>`
    select id from beitrag where mandant_id = ${mandantId} and titel = ${a.titel}`;
  if (schon !== undefined) return 0;

  let freigabeId: string | null = null;
  if (a.status !== 'entwurf') {
    const offen = a.status === 'vorgelegt';
    const [mensch] = await sql<{ id: string }[]>`
      select b.id from benutzer b
        join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
       where bm.entzogen_am is null
       order by b.email limit 1`;
    const [f] = await sql<{ id: string }[]>`
      insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung,
                            risiko, vorschau_payload, payload_hash,
                            freigegeben_von, freigegeben_am, bezug_typ)
      values (${mandantId}, 'social_veroeffentlichen',
              ${offen ? 'offen' : 'genehmigt'}::freigabe_status,
              'beitrag_veroeffentlichen', ${`Beitrag: ${a.titel}`},
              ${`Der Beitrag „${a.titel}" soll auf die eigene Gesellschaftsseite gehen.`},
              'mittel'::risiko_stufe,
              ${sql.json({ titel: a.titel, text: a.text })},
              encode(sha256(convert_to(${a.titel}::text, 'UTF8')), 'hex'),
              ${offen ? null : mensch?.id ?? null},
              ${offen ? null : sql`now() - interval '5 days'`}, 'beitrag')
      returning id`;
    freigabeId = f?.id ?? null;
  }

  await sql`
    insert into beitrag (mandant_id, titel, text, art, status, freigabe_id,
                         geplant_fuer, veroeffentlicht_am)
    values (${mandantId}, ${a.titel}, ${a.text}, ${a.art}::beitrag_art,
            ${a.status}::beitrag_status, ${freigabeId},
            ${a.geplantFuer === null ? null : sql`now() + interval '3 days'`},
            ${a.veroeffentlicht ? sql`now() - interval '4 days'` : null})`;
  return 1;
}

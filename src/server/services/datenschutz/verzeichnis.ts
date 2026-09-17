/**
 * **Das Verarbeitungsverzeichnis nach Art. 30 DSGVO — aus der lebenden
 * Konfiguration** (LEG-09, Phase 10).
 *
 * Dieselbe Bauart wie die Verfahrensdokumentation der Buchführung (ACC-10,
 * D-485) und aus demselben Grund: ein Verzeichnis, das jemand von Hand
 * pflegt, beschreibt den Stand des Tages, an dem er es zuletzt angefasst
 * hat. Vor einer Aufsicht zählt aber der Stand des Systems. Also wird es
 * beim Abruf ERZEUGT — aus `mandant`, aus den gebuchten Modulen, aus den
 * Aufbewahrungsregeln der Gesellschaft, aus dem Register der
 * Auftragsverarbeiter und aus den Verarbeitungstätigkeiten, die der Code
 * kennt.
 *
 * **Was hier Tatsache ist und was Frage bleibt.** Die Plattform weiss, WAS
 * sie verarbeitet, über wen, an wen sie es gibt und wie lange sie es hält —
 * das steht im Verzeichnis. Auf welcher Rechtsgrundlage (Art. 6 Abs. 1) eine
 * Gesellschaft das tut, weiss ihre Geschäftsführung; das steht als offene
 * Frage daneben (O-514) und wird nicht erfunden. Ein Verzeichnis mit
 * ausgedachten Rechtsgrundlagen wäre schlimmer als keines: es sähe geprüft
 * aus.
 *
 * **Der Hash über den Inhalt, die Uhr daneben.** Wie bei ACC-10: der
 * SHA-256 läuft über die Abschnitte OHNE Abrufzeit, damit zwei Abrufe
 * desselben Standes denselben Abdruck tragen. Was sich mit jeder Buchung
 * ändert, steht als Bestand neben dem Abschnitt und nicht darin.
 */
import { createHash } from 'node:crypto';
import {
  VERARBEITUNGEN, BETROFFENE_LABEL, type Verarbeitung,
} from '@/server/registry/verarbeitungen';
import { AUFTRAGSVERARBEITER } from '@/server/registry/auftragsverarbeiter';
import { modulAktiv, type Modulbuchung } from '@/server/registry/modul';
import { liesAufbewahrung, type AufbewahrungZeile } from '@/server/services/dokument/aufbewahrung';
import type { Kategorie } from '@/server/services/dokument/kategorie';
import { markdownZelle } from '@/lib/markdown';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

/** Woher eine Angabe kommt — dieselbe Unterscheidung wie in ACC-10. */
export type Quelle = 'datenbank' | 'register' | 'konfiguration' | 'offen';

export const QUELLE_LABEL: Readonly<Record<Quelle, string>> = {
  datenbank: 'aus der Datenbank beim Abruf',
  register: 'aus einem Register im Code, mit dem PR gelesen',
  konfiguration: 'aus der Konfiguration dieser Gesellschaft',
  offen: 'offen — die Gesellschaft entscheidet',
};

export interface Tabelle {
  readonly kopf: readonly string[];
  readonly zeilen: readonly (readonly string[])[];
}

export interface Abschnitt {
  readonly nummer: string;
  readonly titel: string;
  readonly quelle: Quelle;
  readonly absaetze: readonly string[];
  readonly tabelle: Tabelle | null;
}

export interface Verantwortlicher {
  readonly firma: string;
  readonly rechtsform: string | null;
  readonly anschrift: string;
  readonly geschaeftsfuehrer: readonly string[];
  readonly handelsregister: string | null;
  readonly ustId: string | null;
}

export interface Verarbeitungsverzeichnis {
  readonly mandantId: string;
  readonly verantwortlicher: Verantwortlicher;
  /** Die Tätigkeiten, die für DIESE Gesellschaft gelten. */
  readonly taetigkeiten: readonly Verarbeitung[];
  readonly abschnitte: readonly Abschnitt[];
  /** Die offenen Fragen, die im Verzeichnis sichtbar werden. */
  readonly offen: readonly string[];
  readonly sha256: string;
  readonly abgerufenAm: string;
}

const oder = (wert: string | null | undefined, sonst = '—'): string =>
  wert === null || wert === undefined || wert === '' ? sonst : wert;

interface MandantRoh {
  readonly firma: string;
  readonly name: string;
  readonly rechtsform: string | null;
  readonly module: readonly string[];
  readonly module_gepflegt: boolean | null;
  readonly handelsregister_gericht: string | null;
  readonly handelsregister_nummer: string | null;
  readonly ust_id: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly geschaeftsfuehrer: readonly string[];
}

/**
 * Die Frist einer Tätigkeit, in Worten — aus der Quelle, die sie wirklich
 * bestimmt.
 *
 * `null` heisst nicht „keine Frist", sondern „noch nicht entschieden": die
 * Zeile nennt dann die offene Frage. Eine Zahl zu setzen, wo keine entschieden
 * ist, wäre eine erfundene Regel (`CLAUDE.md`).
 */
export function fristText(
  v: Verarbeitung,
  regeln: readonly AufbewahrungZeile[],
  tageBewerbung: number | null,
): string {
  switch (v.fristQuelle.art) {
    case 'gesetz':
      return v.fristQuelle.text;
    case 'dokumentklasse': {
      const k = v.fristQuelle.kategorie as Kategorie;
      const regel = regeln.find((r) => r.kategorie === k);
      if (regel === undefined || regel.jahre === null) {
        return `Klasse „${k}" — für diese Gesellschaft noch nicht gesetzt (O-25)`;
      }
      const platzhalter = regel.istPlatzhalter ? ' · Platzhalter' : '';
      return `${String(regel.jahre)} Jahre (Klasse „${k}", ${regel.grundlage}${platzhalter})`;
    }
    case 'einstellung':
      /*
       * **Plattformweit, und das steht jetzt dran.** `app.plattform_einstellung`
       * kennt keinen Mandanten — jede Gesellschaft bekommt dieselbe Zahl. Der
       * Satz sagte „für diese Gesellschaft" und behauptete damit eine
       * Konfiguration, die gar nicht gelesen wurde; O-373 hält ausdrücklich
       * fest, dass die Zahl dem Mandanten GEHÖREN soll. Bis dahin ist sie eine
       * Vorgabe der Plattform, und ein Verzeichnis, das eine Vorgabe als
       * Entscheidung der Gesellschaft ausgibt, ist an genau der Stelle falsch,
       * an der eine Aufsicht nachfragt. Gemeldet von der Copilot-Runde auf PR 17.
       */
      return tageBewerbung === null
        ? `Aus „${v.fristQuelle.schluessel}" — plattformweit nicht gesetzt (O-373)`
        : `${String(tageBewerbung)} Tage ab Eingang — plattformweite Vorgabe `
          + `(${v.fristQuelle.schluessel}), noch nicht je Gesellschaft entschieden (O-373)`;
    case 'offen':
    default:
      return `Noch nicht entschieden — ${v.fristQuelle.frage}`;
  }
}

/**
 * Kanonisches JSON: stabile Reihenfolge, keine Uhr — **und alles, was unter
 * der Prüfsumme steht**, also auch die offenen Punkte.
 */
function kanonisch(
  inhalt: { readonly abschnitte: readonly Abschnitt[]; readonly offen: readonly string[] },
): string {
  return JSON.stringify({
    abschnitte: inhalt.abschnitte.map((a) => ({
      nummer: a.nummer, titel: a.titel, quelle: a.quelle,
      absaetze: a.absaetze,
      tabelle: a.tabelle === null ? null : { kopf: a.tabelle.kopf, zeilen: a.tabelle.zeilen },
    })),
    offen: inhalt.offen,
  });
}

export async function erstelleVerarbeitungsverzeichnis(
  db: Abfrage, jetzt: Date,
): Promise<Verarbeitungsverzeichnis> {
  const mandantId = db.aktiverMandantId;
  const [m] = await db.abfrage<MandantRoh>(
    `select firma, name, rechtsform, module, module_gepflegt,
            handelsregister_gericht, handelsregister_nummer, ust_id,
            strasse, plz, ort, geschaeftsfuehrer
       from mandant where id = $1::uuid`, [mandantId]);
  if (m === undefined) throw new Error('Die Gesellschaft ist nicht lesbar.');

  const regeln = await liesAufbewahrung(db);
  /*
   * Derselbe Zugriffsweg wie in `recruiting/dienst.ts` (01-KERN §6.30) — und
   * mit `#>> '{}'`, weil die Funktion `jsonb` liefert. Hier wird aber NICHT
   * geworfen, wenn nichts gesetzt ist: dieses Dokument gibt Auskunft, es legt
   * nichts an. Eine fehlende Frist ist eine Zeile im Verzeichnis, kein
   * Abbruch — dieselbe Lehre wie bei `aufbewahrungsfristTage()` auf der
   * Karriereseite.
   */
  const [einstellung] = await db.abfrage<{ tage: number | null }>(
    `select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`);
  const tageBewerbung = einstellung?.tage ?? null;

  /*
   * **Nur, was diese Gesellschaft gebucht hat.** Ein Verzeichnis, das die
   * Bautätigkeiten einer Reinigungsfirma aufführt, ist falsch — und zwar in
   * der Richtung, die eine Aufsicht als Schlamperei liest. `modulAktiv`
   * beantwortet dieselbe Frage wie die Navigation.
   */
  const buchung: Modulbuchung = {
    module: m.module, gepflegt: m.module_gepflegt === true,
  };
  const taetigkeiten = VERARBEITUNGEN.filter(
    (v) => modulAktiv(buchung, `${v.modul}.lesen`));

  const anschrift = [oder(m.strasse, ''), [oder(m.plz, ''), oder(m.ort, '')].join(' ').trim()]
    .filter((t) => t !== '').join(', ');
  const verantwortlicher: Verantwortlicher = {
    firma: m.firma,
    rechtsform: m.rechtsform,
    anschrift: anschrift === '' ? '—' : anschrift,
    geschaeftsfuehrer: m.geschaeftsfuehrer,
    handelsregister: m.handelsregister_gericht === null && m.handelsregister_nummer === null
      ? null
      : `${oder(m.handelsregister_gericht)} ${oder(m.handelsregister_nummer)}`.trim(),
    ustId: m.ust_id,
  };

  const abschnitte: Abschnitt[] = [
    {
      nummer: '1',
      titel: 'Verantwortlicher (Art. 30 Abs. 1 lit. a)',
      quelle: 'datenbank',
      absaetze: [
        'Verantwortlich im Sinne der DSGVO ist die Gesellschaft, in deren Bereich '
        + 'die Verarbeitung stattfindet. Die vier Gesellschaften der Gruppe sind '
        + 'getrennte Rechtseinheiten; dieses Verzeichnis gilt für eine von ihnen.',
      ],
      tabelle: {
        kopf: ['Angabe', 'Wert'],
        zeilen: [
          ['Firma', verantwortlicher.firma],
          ['Rechtsform', oder(verantwortlicher.rechtsform)],
          ['Anschrift', verantwortlicher.anschrift],
          ['Geschäftsführung', verantwortlicher.geschaeftsfuehrer.length === 0
            ? '—' : verantwortlicher.geschaeftsfuehrer.join(', ')],
          ['Handelsregister', oder(verantwortlicher.handelsregister)],
          ['USt-IdNr.', oder(verantwortlicher.ustId)],
        ],
      },
    },
    {
      nummer: '2',
      titel: 'Verarbeitungstätigkeiten (Art. 30 Abs. 1 lit. b, c)',
      quelle: 'register',
      absaetze: [
        'Je Tätigkeit: wozu sie dient, über wen sie Daten verarbeitet und welche. '
        + 'Aufgeführt sind nur Tätigkeiten, deren Modul diese Gesellschaft gebucht hat.',
      ],
      tabelle: {
        kopf: ['Nr.', 'Tätigkeit', 'Zweck', 'Betroffene', 'Datenarten'],
        zeilen: taetigkeiten.map((v) => [
          v.nummer, v.bezeichnung, v.zweck,
          v.betroffene.map((b) => BETROFFENE_LABEL[b]).join('; '),
          v.daten.join('; '),
        ]),
      },
    },
    {
      nummer: '3',
      titel: 'Besondere Kategorien (Art. 9)',
      quelle: 'register',
      absaetze: [
        'Die Plattform erfasst keine Diagnosen und keine Gesundheitsbefunde. '
        + 'Wo eine Tätigkeit dennoch an Art. 9 rührt, steht es hier — und die '
        + 'Einordnung trifft die Gesellschaft, nicht diese Software.',
      ],
      tabelle: {
        kopf: ['Nr.', 'Tätigkeit', 'Hinweis'],
        zeilen: taetigkeiten
          .filter((v) => v.besondereKategorien !== null)
          .map((v) => [v.nummer, v.bezeichnung, v.besondereKategorien ?? '']),
      },
    },
    {
      nummer: '4',
      titel: 'Empfänger und Auftragsverarbeiter (Art. 30 Abs. 1 lit. d)',
      quelle: 'register',
      absaetze: [
        'Alle Auftragsverarbeiter sind auf eine EU-Region festgelegt (D-04). '
        + 'Ein Vertragsdatum steht nur, wo ein Vertrag hinterlegt ist — ein '
        + 'erfundenes Datum sähe aus wie ein Vertrag.',
      ],
      tabelle: {
        kopf: ['Dienst', 'Zweck', 'Daten', 'Region', 'AV-Vertrag'],
        zeilen: AUFTRAGSVERARBEITER.map((a) => [
          a.dienst, a.zweck, a.daten, a.region,
          a.vertragAm ?? 'nicht hinterlegt',
        ]),
      },
    },
    {
      nummer: '5',
      titel: 'Drittlandübermittlung (Art. 30 Abs. 1 lit. e)',
      quelle: 'register',
      absaetze: [
        'Keine Übermittlung in ein Drittland ist vorgesehen. Jeder Dienst ist auf '
        + 'eine EU-Region festgelegt; das Sprachmodell wird über die EU-Verarbeitung '
        + 'angesprochen, und der Adapter lässt nur die dafür freigegebenen Adressen zu '
        + '(O-509). Ein Dienst ohne EU-Zusage wird nicht angebunden.',
      ],
      tabelle: null,
    },
    {
      nummer: '6',
      titel: 'Löschfristen (Art. 30 Abs. 1 lit. f)',
      quelle: 'konfiguration',
      absaetze: [
        'Die Fristen stehen nicht in diesem Dokument, sondern in den Regeln der '
        + 'Gesellschaft und im Gesetz — hier wird gelesen, was dort gilt. Wo nichts '
        + 'entschieden ist, sagt die Zeile das.',
      ],
      tabelle: {
        kopf: ['Nr.', 'Tätigkeit', 'Frist'],
        zeilen: taetigkeiten.map((v) => [
          v.nummer, v.bezeichnung, fristText(v, regeln, tageBewerbung),
        ]),
      },
    },
    {
      nummer: '7',
      titel: 'Technische und organisatorische Massnahmen (Art. 32)',
      quelle: 'datenbank',
      absaetze: [
        'Die folgenden Massnahmen sind nicht behauptet, sondern erzwungen: sie '
        + 'stehen als Regel in der Datenbank oder als Prüfung in der Auslieferung.',
      ],
      tabelle: {
        kopf: ['Massnahme', 'Wie sie durchgesetzt wird'],
        zeilen: [
          ['Mandantentrennung',
            'Jede Tabelle trägt `mandant_id` mit aktivierter RLS; der aktive Mandant '
            + 'kommt aus der Serversitzung, nie aus der Adresse (Invariante 3)'],
          /*
           * **Hier stand eine Zusage, die der Code nicht haelt.** „Verwaltende
           * Rollen erreichen ihre Bereiche nur mit AAL2" — dieses Verzeichnis
           * selbst ist mit `aal2: false` eingetragen, und `system.
           * einstellung_lesen` verlangt keinen zweiten Faktor. Eine AAL1-Sitzung
           * mit diesem Recht bekommt das Dokument. Eine falsche Angabe unter
           * Art. 32 ist schlimmer als eine fehlende: sie steht vor einer
           * Aufsicht und ist nachpruefbar. Gemeldet von der Copilot-Runde auf
           * PR 17; genannt wird jetzt, was DREI Routen und eine Funktion
           * wirklich erzwingen.
           */
          ['Zweiter Faktor',
            'Ein Konto mit verwaltender Rolle muss ihn hinterlegt haben; die '
            + 'Anmeldung meldet die Pflicht und die Sitzung bleibt sonst '
            + 'unvollständig (AUT-02). Super-Admin-Rechte gelten ausschliesslich '
            + 'in einer AAL2-Sitzung, und Rollenmatrix wie Modulbuchung verlangen '
            + 'AAL2 an der Route (K-15). Andere verwaltende Bildschirme — dieses '
            + 'Verzeichnis eingeschlossen — stehen einer AAL1-Sitzung offen'],
          ['Private Ablage',
            'Dateien liegen in privaten Buckets; Zugriff nur über signierte, '
            + 'befristete Adressen (SEC-A6, DOC-03)'],
          ['Unveränderlichkeit',
            'Festgeschriebene Rechnungen tragen eine Prüfsummenkette; Wachbuch, '
            + 'Bautagebuch und Protokoll kennen kein Löschen (Invariante 4, 8)'],
          ['Serverzeit',
            'Zeiteinträge stempelt der Server; die Geräteuhr wird nur als Abweichung '
            + 'mitgeschrieben (Invariante 5)'],
          ['Menschliche Freigabe',
            'Nichts verlässt das System ohne Entscheidung eines Menschen '
            + '(Invariante 7, `server/agent/policy.ts`)'],
          ['EU-Region',
            'Datenbank, Speicher und Funktionen sind auf eine EU-Region festgelegt (D-04)'],
        ],
      },
    },
    {
      nummer: '8',
      titel: 'Was dieses Verzeichnis NICHT sagt',
      quelle: 'offen',
      absaetze: [
        'Die Rechtsgrundlage je Tätigkeit (Art. 6 Abs. 1) steht hier bewusst nicht. '
        + 'Sie ist eine Entscheidung der Geschäftsführung — Vertrag, rechtliche '
        + 'Verpflichtung, berechtigtes Interesse oder Einwilligung —, und sie hängt '
        + 'an Verträgen und Betriebsvereinbarungen, die diese Software nicht kennt. '
        + 'Ebenso wenig steht hier eine Aussage über einen Betriebsrat: ob einer '
        + 'besteht, entscheidet über § 87 BetrVG und damit über die Zeiterfassung '
        + 'mit Standortpunkt.',
        'Diese Zeilen sind kein Mangel des Verzeichnisses, sondern seine Grenze. '
        + 'Was fehlt, ist unter „Offen" in `docs/DECISIONS.md` mit Nummer benannt.',
      ],
      tabelle: null,
    },
  ];

  const offen = [
    'O-514 — Rechtsgrundlage je Verarbeitungstätigkeit (Art. 6 Abs. 1)',
    ...(tageBewerbung === null ? ['O-373 — Aufbewahrungsfrist für Bewerberdaten'] : []),
    ...(regeln.some((r) => r.istPlatzhalter)
      ? ['O-25 — Aufbewahrungsklassen stehen teilweise als Platzhalter'] : []),
    ...(AUFTRAGSVERARBEITER.some((a) => a.vertragAm === null)
      ? ['Für mindestens einen Auftragsverarbeiter ist kein AV-Vertrag hinterlegt'] : []),
  ];

  /*
   * **Die Prüfsumme deckt ALLES, was unter ihr steht.**
   *
   * Sie lief über `abschnitte` allein — `offen` stand daneben im JSON und im
   * Markdown, unter derselben Zeile „Prüfsumme des Inhalts". Damit konnten
   * zwei verschiedene Auskünfte denselben Abdruck tragen: eine Frist, die
   * für eine Dokumentklasse OHNE eigene Tätigkeit auf Platzhalter steht,
   * ändert die offene Liste und keinen Abschnitt. Vor einer Aufsicht ist
   * genau das der Fall, in dem eine Prüfsumme das Gegenteil dessen tut,
   * wofür sie da ist: sie bestätigt zwei Stände als einen.
   *
   * Gemeldet hat es die Copilot-Runde auf PR 17. Das Löschkonzept hashte von
   * Anfang an über beides (`roh`), die Verfahrensdokumentation ebenso.
   */
  const sha256 = createHash('sha256')
    .update(kanonisch({ abschnitte, offen }), 'utf8').digest('hex');
  const abgerufenAm = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin', timeZoneName: 'short',
  }).format(jetzt);

  return {
    mandantId, verantwortlicher, taetigkeiten, abschnitte, offen, sha256, abgerufenAm,
  };
}

/** Das Verzeichnis als Markdown — zum Ausdrucken und Weitergeben. */
export function alsMarkdown(v: Verarbeitungsverzeichnis): string {
  const zeilen: string[] = [
    `# Verzeichnis von Verarbeitungstätigkeiten — ${v.verantwortlicher.firma}`,
    '',
    'Art. 30 Abs. 1 DSGVO. Erzeugt aus der laufenden Konfiguration der Plattform.',
    '',
    `Abgerufen: ${v.abgerufenAm} · Prüfsumme des Inhalts: \`${v.sha256}\``,
    '',
  ];
  for (const a of v.abschnitte) {
    zeilen.push(`## ${a.nummer}. ${a.titel}`, '', `*${QUELLE_LABEL[a.quelle]}*`, '');
    for (const p of a.absaetze) zeilen.push(p, '');
    if (a.tabelle !== null && a.tabelle.zeilen.length > 0) {
      zeilen.push(`| ${a.tabelle.kopf.join(' | ')} |`);
      zeilen.push(`|${a.tabelle.kopf.map(() => '---').join('|')}|`);
      for (const z of a.tabelle.zeilen) {
        zeilen.push(`| ${z.map(markdownZelle).join(' | ')} |`);
      }
      zeilen.push('');
    } else if (a.tabelle !== null) {
      zeilen.push('*Keine Zeile — für diese Gesellschaft trifft nichts davon zu.*', '');
    }
  }
  if (v.offen.length > 0) {
    zeilen.push('## Offen', '');
    for (const o of v.offen) zeilen.push(`- ${o}`);
    zeilen.push('');
  }
  return zeilen.join('\n');
}

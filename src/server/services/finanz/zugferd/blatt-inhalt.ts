import type { Position, RechnungVollstaendig } from '../kanonisch.js';
import { formatiereGeld, negiere, type Cent } from '../geld.js';
import { formatiereMenge, type MilliMenge } from '../menge.js';
import { tagDeutsch } from '../../../../lib/datum/kalendertag.js';
import { prozentText } from '../prozent.js';

/**
 * **Was auf dem Rechnungsblatt steht** — getrennt davon, WIE es gezeichnet
 * wird (V-134, DESIGN §11, § 14 Abs. 4 UStG).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Blatt der ZUGFeRD-Rechnung druckte weniger, als die Rechnung sagt: die
 * Bezeichnung auf 60 Zeichen gekürzt, nur Leistungszeilen, eine einzige Seite
 * (was darüber hinausging, lief unter den Fuss und vom Blatt), die Menge als
 * `30.870` — auf Deutsch dreissigtausend —, Daten als `2026-09-11`. Und es
 * fehlten Angaben, die in der Nutzlast stehen und auf eine Rechnung gehören:
 * der Hinweis auf die Steuerschuldnerschaft des Leistungsempfängers
 * (§ 14a Abs. 5 UStG), die Abzüge der Abschläge und der Zahlbetrag (§ 14
 * Abs. 5 UStG), der Einbehalt nach § 48 EStG, der Befreiungsgrund einer
 * steuerfreien Zeile, das Entgelt je Steuersatz, die USt-IdNr. des
 * Empfängers, der Leistungsort, Kopf- und Schlusstext. Wer nur das Blatt
 * las, hätte bei einer Schlussrechnung den Bruttobetrag überwiesen statt des
 * Zahlbetrags.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Regel dieser Datei: sie druckt, sie rechnet nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jeder Betrag kommt fertig aus der Nutzlast — derselben, die gehasht wurde
 * und aus der die CII entsteht. Hier wird formatiert, nie addiert: ein Blatt,
 * das eine Summe selbst bildet, kann eine andere Zahl zeigen als die
 * eingebettete XML, und dann gäbe es zu einer Nummer zwei Beträge. Auch jeder
 * Hinweistext kommt aus der Nutzlast (`steuerhinweis` aus `steuerfall.ts`,
 * `befreiungsgrundText`, `hinweise`); diese Datei erfindet keinen.
 */

export interface BlattPosition {
  readonly art: 'leistung' | 'text' | 'zwischensumme';
  readonly nr: string;
  readonly bezeichnung: string;
  /** Leise Zeilen darunter: Beschreibung, eigener Zeitraum, Rabatt. */
  readonly unterzeilen: readonly string[];
  readonly menge: string;
  readonly einzelpreis: string;
  readonly ust: string;
  readonly betrag: string;
}

export interface SummenZeile {
  readonly text: string;
  readonly betrag: string;
  readonly fett: boolean;
}

export interface BlattInhalt {
  readonly titel: string;
  readonly absenderName: string;
  readonly absenderZeilen: readonly string[];
  readonly empfaenger: readonly string[];
  readonly eckdaten: readonly (readonly [string, string])[];
  readonly leistungsort: string | null;
  readonly kopftext: string | null;
  readonly positionen: readonly BlattPosition[];
  readonly summen: readonly SummenZeile[];
  /** Leise Sätze unter den Summen: Befreiungsgründe, Freistellungsbescheinigung. */
  readonly summenHinweise: readonly string[];
  readonly steuerhinweis: string | null;
  readonly hinweise: readonly string[];
  readonly fusstext: string | null;
  readonly zahlung: readonly string[];
  readonly fuss: readonly string[];
}

/** Ein geschütztes Leerzeichen — `19 %` und `1.000,00 €` brechen nie um (DESIGN §5). */
const NBSP = ' ';

/** Die Überschrift je Rechnungsart — dieselben Wörter wie im Belegarchiv. */
const TITEL: Readonly<Record<string, string>> = {
  standard: 'Rechnung',
  abschlag: 'Abschlagsrechnung',
  anzahlung: 'Anzahlungsrechnung',
  schluss: 'Schlussrechnung',
  storno: 'Stornorechnung',
};

/**
 * Derselbe Prozenttext wie im Kundenportal (`1900` → „19,0 %") — ein Beleg,
 * eine Schreibweise, gleich ob man ihn auf der Seite oder im PDF liest.
 */
const prozent = prozentText;

const geld = (c: Cent): string => formatiereGeld(c);

/**
 * Die Einheit, wie sie auf Papier gehört: `m2` → `m²`. Nur die Hochzahl —
 * die Einheit selbst ist die Angabe eines Menschen und bleibt, wie sie ist.
 */
export function einheitAnzeige(einheit: string | null): string {
  if (einheit === null) return '';
  return einheit.replace(/^(k?m|c?m|d?m)2$/u, '$1²').replace(/^(k?m|c?m|d?m)3$/u, '$1³');
}

/** Eine Bezugsmenge ohne Nachkommastellen, wenn sie keine hat: `100`, nicht `100,00`. */
function mengeKurz(m: MilliMenge): string {
  if (m % 1000n === 0n) {
    return new Intl.NumberFormat('de-DE').format(Number(m / 1000n));
  }
  return formatiereMenge(m);
}

function zeitraum(von: string | null, bis: string | null): string | null {
  if (von === null) return null;
  const ende = bis ?? von;
  return ende === von ? tagDeutsch(von) : `${tagDeutsch(von)} – ${tagDeutsch(ende)}`;
}

function position(p: Position): BlattPosition {
  const unterzeilen: string[] = [];
  if (p.beschreibung !== null && p.beschreibung.trim() !== '') unterzeilen.push(p.beschreibung);
  const eigen = zeitraum(p.leistungVon, p.leistungBis);
  if (eigen !== null) {
    unterzeilen.push(`${p.leistungVon === (p.leistungBis ?? p.leistungVon)
      ? 'Leistungsdatum' : 'Leistungszeitraum'} ${eigen}`);
  }
  if (p.rabattBp !== 0) unterzeilen.push(`Rabatt ${prozent(p.rabattBp)}`);

  if (p.art === 'textzeile') {
    return { art: 'text', nr: '', bezeichnung: p.bezeichnung, unterzeilen,
      menge: '', einzelpreis: '', ust: '', betrag: '' };
  }
  if (p.art === 'zwischensumme') {
    return { art: 'zwischensumme', nr: '', bezeichnung: p.bezeichnung, unterzeilen,
      menge: '', einzelpreis: '', ust: '',
      betrag: p.nettoCent === null ? '' : geld(p.nettoCent) };
  }
  const einheit = einheitAnzeige(p.einheit);
  /* Ein Preis je 100 m² ist ein anderer Preis als einer je m² — und die
     Spalte zu schmal, um es daneben zu sagen. Also darunter. */
  if (p.preisBasismenge !== 1000n) {
    unterzeilen.push(`Einzelpreis je ${mengeKurz(p.preisBasismenge)}`
      + `${einheit === '' ? '' : `${NBSP}${einheit}`}`);
  }
  return {
    art: 'leistung',
    nr: String(p.nr),
    bezeichnung: p.bezeichnung,
    unterzeilen,
    menge: p.menge === null ? ''
      : `${formatiereMenge(p.menge)}${einheit === '' ? '' : `${NBSP}${einheit}`}`,
    einzelpreis: p.einzelpreisCent === null ? '' : geld(p.einzelpreisCent),
    ust: prozent(p.satzBp),
    betrag: p.nettoCent === null ? '' : geld(p.nettoCent),
  };
}

function summen(r: RechnungVollstaendig): {
  readonly zeilen: readonly SummenZeile[]; readonly hinweise: readonly string[];
} {
  const zeilen: SummenZeile[] = [];
  const hinweise: string[] = [];

  for (const z of r.zuschlaege) {
    const nachlass = z.art !== 'zuschlag';
    const grundlage = z.satzBp !== null && z.basisCent !== null
      ? ` (${prozent(z.satzBp)} von ${geld(z.basisCent)})` : '';
    zeilen.push({
      text: `${nachlass ? 'Nachlass' : 'Zuschlag'}: ${z.bezeichnung}${grundlage}`,
      betrag: geld(nachlass ? negiere(z.betragCent) : z.betragCent),
      fett: false,
    });
  }

  zeilen.push({ text: 'Nettobetrag', betrag: geld(r.nettoGesamtCent), fett: false });
  for (const s of r.steuerzeilen) {
    zeilen.push({
      text: `Umsatzsteuer ${prozent(s.satzBp)} auf ${geld(s.nettoCent)}`,
      betrag: geld(s.steuerCent),
      fett: false,
    });
    const grund = s.befreiungsgrundText ?? s.befreiungsgrundCode;
    if (grund !== null && grund.trim() !== '') {
      hinweise.push(`${prozent(s.satzBp)} auf ${geld(s.nettoCent)}: ${grund}`);
    }
  }
  zeilen.push({ text: 'Gesamtbetrag', betrag: geld(r.bruttoCent), fett: true });

  /*
   * § 14 Abs. 5 UStG: die Schlussrechnung setzt die vereinnahmten Abschläge
   * mit ihrem Steuerbetrag ab. Je Abschlag eine Zeile mit Netto und Steuer —
   * und der Abzug als EIN Betrag aus der Nutzlast, nicht hier summiert.
   */
  if (r.abzuege.length > 0) {
    for (const a of r.abzuege) {
      zeilen.push({
        text: `abzüglich Abschlagsrechnung ${a.abschlagNummer}: netto `
          + `${geld(a.abzugNettoCent)}, Umsatzsteuer ${geld(a.abzugSteuerCent)}`,
        betrag: '',
        fett: false,
      });
    }
    zeilen.push({ text: 'Summe der Abzüge', betrag: geld(negiere(r.abzugBruttoCent)), fett: false });
  }
  if (r.abzuege.length > 0 || r.zahlbetragCent !== r.bruttoCent) {
    zeilen.push({ text: 'Zahlbetrag', betrag: geld(r.zahlbetragCent), fett: true });
  }

  const b = r.bauabzugsteuer;
  if (b.einbehaltCent !== 0n) {
    const grundlage = b.satzBp !== null && b.grundlageCent !== null
      ? ` (${prozent(b.satzBp)} von ${geld(b.grundlageCent)})` : '';
    zeilen.push({
      text: `Einbehalt Bauabzugsteuer nach § 48 EStG${grundlage}`,
      betrag: geld(negiere(b.einbehaltCent)),
      fett: false,
    });
  }
  if (r.ueberweisungsbetragCent !== r.zahlbetragCent) {
    zeilen.push({ text: 'Überweisungsbetrag', betrag: geld(r.ueberweisungsbetragCent), fett: true });
  }
  if (b.freistellungsbescheinigung !== null) {
    const f = b.freistellungsbescheinigung;
    hinweise.push(`Freistellungsbescheinigung nach § 48b EStG: Nr. ${f.nummer}, `
      + `${f.finanzamt}, gültig vom ${tagDeutsch(f.gueltigVon)} bis ${tagDeutsch(f.gueltigBis)}.`);
  }
  return { zeilen, hinweise };
}

function zahlung(r: RechnungVollstaendig): string[] {
  const z = r.zahlung;
  const zeilen: string[] = [];
  if (z.zahlungsbedingungText !== null && z.zahlungsbedingungText.trim() !== '') {
    zeilen.push(z.zahlungsbedingungText);
  } else if (z.faelligAm !== null) {
    zeilen.push(`Zahlbar bis ${tagDeutsch(z.faelligAm)}.`);
  }
  if (z.skontoBp !== null && z.skontoTage !== null) {
    zeilen.push(`Skonto: ${prozent(z.skontoBp)} bei Zahlung innerhalb von `
      + `${String(z.skontoTage)} Tagen.`);
  }
  if (z.bankkonto !== null) {
    const konto = [`IBAN ${z.bankkonto.iban}`,
      ...(z.bankkonto.bic === null ? [] : [`BIC ${z.bankkonto.bic}`])];
    zeilen.push(`Bankverbindung: ${z.bankkonto.kontoinhaber} · ${konto.join(' · ')}`);
    zeilen.push(`Verwendungszweck: ${r.nummer}`);
  }
  return zeilen;
}

/**
 * Der feste Fuss (DESIGN §11): Gesellschaft, Registergericht, HRB,
 * Geschäftsführung — und die Steuernummern, die § 14 UStG verlangt. Darunter
 * die stehende Fusszeile der Gesellschaft aus dem SNAPSHOT (V-099, K-12).
 */
function fuss(r: RechnungVollstaendig): string[] {
  const l = r.leistender;
  return [
    [l.name, l.gericht, l.hrb].filter((t): t is string => t !== null && t !== '').join(' · '),
    [l.geschaeftsfuehrer === null ? null : `Geschäftsführung: ${l.geschaeftsfuehrer}`,
      l.ustid === null ? null : `USt-IdNr. ${l.ustid}`,
      l.steuernummer === null ? null : `Steuernummer ${l.steuernummer}`]
      .filter((t): t is string => t !== null).join(' · '),
    ...(l.fusszeile ?? '').split('\n').map((t) => t.trim()),
  ].filter((t) => t !== '');
}

export function blattInhalt(r: RechnungVollstaendig): BlattInhalt {
  const e = r.empfaenger;
  const empfaenger = [
    e.name,
    e.anschrift.strasse,
    e.anschrift.zusatz,
    `${e.anschrift.plz ?? ''} ${e.anschrift.ort ?? ''}`.trim(),
    e.anschrift.land !== 'DE' ? e.anschrift.land : null,
    e.ustid === null ? null : `USt-IdNr. ${e.ustid}`,
  ].filter((t): t is string => t !== null && t !== '');

  const leistung = zeitraum(r.leistungVon, r.leistungBis);
  const eckdaten: (readonly [string, string])[] = [
    ['Rechnungsnummer', r.nummer],
    ['Rechnungsdatum', tagDeutsch(r.rechnungsdatum)],
  ];
  if (leistung !== null) {
    eckdaten.push([r.leistungVon === (r.leistungBis ?? r.leistungVon)
      ? 'Leistungsdatum' : 'Leistungszeitraum', leistung]);
  }
  if (r.zahlung.faelligAm !== null) eckdaten.push(['Fällig am', tagDeutsch(r.zahlung.faelligAm)]);
  if (e.leitwegId !== null) eckdaten.push(['Leitweg-ID', e.leitwegId]);
  if (e.kaeuferReferenz !== null) eckdaten.push(['Ihre Referenz', e.kaeuferReferenz]);
  if (e.bestellnummer !== null) eckdaten.push(['Bestellnummer', e.bestellnummer]);

  const s = summen(r);
  return {
    titel: `${TITEL[r.rechnungsart] ?? 'Rechnung'} ${r.nummer}`,
    absenderName: r.leistender.name,
    absenderZeilen: [
      r.leistender.anschrift.strasse,
      `${r.leistender.anschrift.plz ?? ''} ${r.leistender.anschrift.ort ?? ''}`.trim(),
    ].filter((t): t is string => t !== null && t !== ''),
    empfaenger,
    eckdaten,
    leistungsort: r.objekt === null ? null
      : `Leistungsort: ${r.objekt.bezeichnung}, ${r.objekt.anschrift.zeile}`,
    kopftext: r.kopftext,
    positionen: r.positionen.map(position),
    summen: s.zeilen,
    summenHinweise: s.hinweise,
    steuerhinweis: r.steuerhinweis,
    hinweise: r.hinweise,
    fusstext: r.fusstext,
    zahlung: zahlung(r),
    fuss: fuss(r),
  };
}

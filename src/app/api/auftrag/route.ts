import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NummernkreisFehler } from '@/server/services/finanz/nummernkreis';
import { pruefeAuftragsangaben } from '@/server/services/auftrag/angaben';
import { legeAuftragDirektAn, type DirektAuftragsart } from '@/server/services/auftrag/direkt';
import { maskeMitEingaben } from '@/lib/formular/maske';

/**
 * `POST /api/auftrag` — der Auftragsassistent (OPS-10).
 *
 * OPS-10 zaehlt auf, was ein neuer Vertrag sichtbar machen muss: Ort,
 * Personalbedarf, Stunden, Ausstattung, Startdatum, verantwortliche Leitung.
 * Genau diese Felder nimmt dieser Weg entgegen — und keines davon errät er.
 * Ein Assistent, der den Personalbedarf schaetzt, produziert eine Zahl, die
 * spaeter niemand hinterfragt.
 *
 * **Ein Formular bekommt seine Maske zurück, kein JSON** (V-172, D-599). Jede
 * fachliche Abweisung — fehlende Pflichtangabe, unlesbare oder zu grosse
 * Zahl, fehlender Nummernkreis — fuehrt auf `/auftraege/neu?fehler=…`, und
 * die Maske sagt den Satz. Bis hierher endete sie auf einer weissen Seite mit
 * `{"fehler":"keine_zahl"}`, und die Eingabe war verloren. JSON bleibt nur
 * fuer keine Sitzung, kein Recht und fremden Ursprung.
 *
 * **Die Zahlen liest `pruefeAuftragsangaben`**, mit Tausenderpunkt und
 * Dezimalkomma. `Number("1.234,5".replace(',', '.'))` war `NaN`.
 *
 * **Der Bereich kommt aus der SITZUNG** (Invariante 3), nicht aus
 * `?mandant=`: wer in einem zweiten Reiter die Gesellschaft gewechselt hatte,
 * legte den Auftrag richtig an und landete danach auf einem 404.
 *
 * **Die Maske kommt mit allem zurück, was eingegeben war** (V-143, D-637) —
 * auch mit der Anfrage (V-138) und dem Wert (V-173).
 */
export const dynamic = 'force-dynamic';

const ARTEN: readonly DirektAuftragsart[] = [
  'einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt',
];

function istArt(wert: string | null): wert is DirektAuftragsart {
  return wert !== null && (ARTEN as readonly string[]).includes(wert);
}

type Ergebnis =
  | { readonly art: 'abgewiesen'; readonly grund: string }
  | { readonly art: 'angelegt'; readonly id: string };

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const kundeId = text('kundeId');
  /*
   * Die Anfrage, aus der dieser Auftrag direkt entsteht — ohne Angebot
   * (V-138, CRM-05, REP-03). Ein Auftrag am Telefon nach einer Web-Anfrage
   * ist ein Auftrag aus DIESEM Kanal; ohne das Feld zählte ihn der
   * Herkunftsbericht nirgends.
   */
  const leadId = text('leadId');
  const bezeichnung = text('bezeichnung');
  const art = text('art');
  const startDatum = text('startDatum');
  const verantwortlich = text('verantwortlichBenutzerId') ?? sitzung.benutzerId;

  /*
   * Die Zahlen werden VOR der Transaktion geprüft — rein, ohne Datenbank —,
   * die Antwort aber erst NACH der Rechteprüfung gegeben: wer nicht anlegen
   * darf, erfährt nicht, dass seine Zahl zu gross war (AUT-06).
   */
  const angaben = pruefeAuftragsangaben({
    personalbedarf: text('personalbedarfAnzahl'),
    wochenstunden: text('wochenstundenSoll'),
    /*
     * V-173 (OPS-05): ein von Hand angelegter Auftrag hatte für immer keinen
     * Wert — das Formular fragte nicht danach. Er kommt als deutscher
     * Eurobetrag und geht über `parseGeld` in ganze Cent (Invariante 1).
     */
    wert: text('auftragswertNetto'),
  });

  /*
   * Der Bereich wird in der Transaktion gelesen und nach AUSSEN gereicht —
   * auch der Fehlerzweig braucht ihn, und ein Rollback nimmt die Zuweisung
   * nicht zurück (dasselbe Muster wie `api/radar/profil`).
   *
   * **Ein Formular bekommt seine Maske zurück, kein JSON** (D-599): mit dem
   * Schlüssel, der Anfrage, falls der Auftrag aus einer kam (V-138), und seit
   * V-143 mit allem, was eingegeben war — wer sich bei den Wochenstunden
   * vertippt, fängt nicht mit zehn leeren Feldern von vorn an.
   */
  let slug = '';
  const zurMaske = (grund: string): NextResponse => NextResponse.redirect(new URL(
    maskeMitEingaben(slug === '' ? '/portal' : `/portal/${slug}/auftraege/neu`, grund, {
      lead: leadId, kundeId, objektId: text('objektId'), bezeichnung, art,
      verantwortlichBenutzerId: text('verantwortlichBenutzerId'), startDatum,
      laufzeitBis: text('laufzeitBis'), personalbedarfAnzahl: text('personalbedarfAnzahl'),
      wochenstundenSoll: text('wochenstundenSoll'),
      auftragswertNetto: text('auftragswertNetto'),
      ausstattungHinweis: text('ausstattungHinweis'), beschreibung: text('beschreibung'),
    }), erwarteterUrsprung(anfrage)), 303);

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext): Promise<Ergebnis> => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'auftrag.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;

        if (kundeId === null || bezeichnung === null || startDatum === null || !istArt(art)) {
          return { art: 'abgewiesen', grund: 'unvollstaendig' };
        }
        if (!angaben.ok) return { art: 'abgewiesen', grund: angaben.grund };

        /*
         * Bezug und Anfrage prüfen, Nummer ziehen, anlegen — im Dienst (V-143),
         * damit es sich gegen eine echte Datenbank prüfen lässt: eine
         * Abweisung verbraucht KEINE Auftragsnummer.
         */
        const neu = await legeAuftragDirektAn(
          kontext,
          { unsafe: async (s: string, w: readonly unknown[] = []) =>
              (await tx.unsafe(s, w as never[])) as readonly unknown[] },
          {
            kundeId, objektId: text('objektId'), art, bezeichnung,
            beschreibung: text('beschreibung'), verantwortlichBenutzerId: verantwortlich,
            startDatum, laufzeitBis: text('laufzeitBis'),
            personalbedarfAnzahl: angaben.werte.personalbedarf,
            wochenstundenSoll: angaben.werte.wochenstunden,
            ausstattungHinweis: text('ausstattungHinweis'), leadId,
            auftragswertNettoCent: angaben.werte.wertCent,
          });
        /* Die Anfrage bleibt in der Adresse, damit der zweite Versuch nicht ohne sie beginnt. */
        if (neu.art === 'bezug' || neu.art === 'lead') {
          return { art: 'abgewiesen', grund: neu.grund };
        }
        if (neu.art === 'nicht_angelegt') return { art: 'abgewiesen', grund: 'nicht_angelegt' };
        return { art: 'angelegt', id: neu.id };
      })) as Promise<Ergebnis>);

    if (ergebnis.art === 'abgewiesen') return zurMaske(ergebnis.grund);
    return NextResponse.redirect(
      new URL(`/portal/${slug}/auftraege/${ergebnis.id}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    /*
     * **Die Antworten des TORS bleiben JSON** — wie auf jeder Route dieser
     * Anwendung (`uebergang.ts`, `autorisierungsAntwort`, D-637): ohne
     * Sitzung, ohne zweiten Faktor, ohne Recht gibt es keine Maske, auf die
     * man zurückkehren könnte; die Maske selbst stünde hinter demselben Tor.
     * Zurück auf die Maske geht alles, was die EINGABE oder den Vorgang
     * betrifft.
     */
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof NummernkreisFehler && slug !== '') return zurMaske(fehler.grund);
    throw fehler;
  }
}

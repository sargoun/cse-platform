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
import { vergebeNummer, NummernkreisFehler } from '@/server/services/finanz/nummernkreis';
import { pruefeAuftragsangaben, pruefeAuftragsbezug } from '@/server/services/auftrag/angaben';

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
 */
export const dynamic = 'force-dynamic';

const ARTEN = new Set(['einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt']);

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
  const bezeichnung = text('bezeichnung');
  const art = text('art');
  const startDatum = text('startDatum');
  const verantwortlich = text('verantwortlichBenutzerId') ?? sitzung.benutzerId;
  const pflichtFehlt = kundeId === null || bezeichnung === null || art === null
    || startDatum === null || !ARTEN.has(art);

  /*
   * Die Zahlen werden VOR der Transaktion geprüft — rein, ohne Datenbank —,
   * die Antwort aber erst NACH der Rechteprüfung gegeben: wer nicht anlegen
   * darf, erfährt nicht, dass seine Zahl zu gross war (AUT-06).
   */
  const angaben = pruefeAuftragsangaben({
    personalbedarf: text('personalbedarfAnzahl'),
    wochenstunden: text('wochenstundenSoll'),
  });

  /*
   * Gelesen in der Transaktion und nach AUSSEN gereicht — auch der
   * Fehlerzweig braucht ihn, und ein Rollback nimmt die Zuweisung nicht
   * zurück (dasselbe Muster wie `api/radar/profil`).
   */
  let slug = '';
  const zurMaske = (grund: string): NextResponse => {
    const ziel = new URL(slug === '' ? '/portal' : `/portal/${slug}/auftraege/neu`,
      erwarteterUrsprung(anfrage));
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

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

        if (pflichtFehlt) return { art: 'abgewiesen', grund: 'unvollstaendig' };
        if (!angaben.ok) return { art: 'abgewiesen', grund: angaben.grund };
        /* VOR der Nummer: eine Abweisung verbraucht keine Auftragsnummer. */
        const bezug = await pruefeAuftragsbezug(kontext, {
          kundeId, objektId: text('objektId'), verantwortlichBenutzerId: verantwortlich,
          startDatum: startDatum ?? '', laufzeitBis: text('laufzeitBis'),
        });
        if (bezug !== null) return { art: 'abgewiesen', grund: bezug };

        const nummer = await vergebeNummer(
          { unsafe: async (s: string, w: readonly unknown[] = []) =>
              (await tx.unsafe(s, w as never[])) as readonly unknown[] },
          { kreisTyp: 'auftrag' },
        );

        const [neu] = await kontext.abfrage<{ id: string }>(
          `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art,
                                bezeichnung, beschreibung, verantwortlich_benutzer_id,
                                start_datum, laufzeit_bis, personalbedarf_anzahl,
                                wochenstunden_soll, ausstattung_hinweis)
           values (app.aktiver_mandant(), $1, $2, $3, $4::auftrag_art, $5, $6, $7,
                   $8::date, $9::date, $10, $11::numeric, $12)
           returning id`,
          [nummer.formatiert, kundeId, text('objektId'), art, bezeichnung,
           text('beschreibung'), verantwortlich, startDatum, text('laufzeitBis'),
           angaben.werte.personalbedarf, angaben.werte.wochenstunden,
           text('ausstattungHinweis')],
        );
        if (neu === undefined) throw new NichtGefundenFehler('Auftrag nicht angelegt');
        return { art: 'angelegt', id: neu.id };
      })) as Promise<Ergebnis>);

    if (ergebnis.art === 'abgewiesen') return zurMaske(ergebnis.grund);
    return NextResponse.redirect(
      new URL(`/portal/${slug}/auftraege/${ergebnis.id}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
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

import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  AbnahmeFehler, istAbnahmeArt, meldeMangelBehoben, protokolliereAbnahme, storniereAbnahme,
  verknuepfeErsatzprotokoll, type MangelEingabe,
} from '@/server/services/bau/abnahme';

/**
 * `POST /api/bau/abnahmen` — das Abnahmeprotokoll nach § 12 VOB/B (BAU-01,
 * OPS-11).
 *
 * **Drei Aktionen an einer Adresse, und dasselbe Recht für alle drei:**
 * protokollieren, einen Mangel als behoben melden, ein Protokoll stornieren.
 * Alle drei sind Fortschreibungen desselben Vorgangs und hängen an
 * `bau.schreiben` (Seitenkarte §5.9 für `…/abnahme`); drei Endpunkte wären
 * drei Stellen, an denen die Autorisierung vergessen werden kann.
 *
 * **Was unterschrieben wird, entsteht auf dem Server.** Das Formular schickt
 * Art, Datum, Vorbehalte, Teilnehmer und Mängel — der Schnappschuss und sein
 * SHA-256 entstehen im Dienst aus DIESER geprüften Eingabe und dem Projekt,
 * das der Server dazu liest. Ein Digest über eine vom Browser gelieferte
 * Fassung beglaubigte genau die manipulierte (K-12, Review B25).
 *
 * **Die Gewährleistungsfrist wird nicht geschrieben.** Sie ist offen (O-154)
 * und liegt hinter `GewaehrleistungsFrist`; der Endpunkt gibt zurück, was die
 * eingesetzte Fassung liefert — heute `null`.
 */
export const dynamic = 'force-dynamic';

/** Wie viele Mängel ein Protokoll höchstens aufnimmt. */
const MAX_MAENGEL = 200;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const liste = (name: string): readonly string[] =>
    daten.getAll(name).filter((w): w is string => typeof w === 'string').map((w) => w.trim());
  const aktion = feld('aktion');

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
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
          { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'mangel_behoben') {
          const ok = await meldeMangelBehoben(kontext, {
            mangelId: feld('mangel'),
            behobenAm: feld('behoben_am'),
          });
          return { art: 'mangel' as const, ok };
        }

        if (aktion === 'stornieren') {
          const ok = await storniereAbnahme(kontext, {
            id: feld('abnahme'),
            grund: feld('storno_grund'),
          });
          return { art: 'storno' as const, ok };
        }

        /**
         * Die Mängel kommen als PARALLELE Felder (`mangel_beschreibung`,
         * `mangel_frist`, `mangel_position`) und werden nach INDEX
         * zusammengesetzt — so, wie ein Formular ohne JavaScript sie schickt.
         * Eine Zeile ohne Beschreibung ist eine leere Zeile des Formulars und
         * kein Fehler: sie fällt weg, statt die Aufnahme abzubrechen.
         */
        const beschreibungen = liste('mangel_beschreibung');
        const fristen = liste('mangel_frist');
        const positionen = liste('mangel_position');
        const maengel: MangelEingabe[] = [];
        for (const [i, beschreibung] of beschreibungen.entries()) {
          if (beschreibung === '') continue;
          if (maengel.length >= MAX_MAENGEL) break;
          maengel.push({
            beschreibung,
            fristAm: (fristen[i] ?? '') === '' ? null : fristen[i] as string,
            lvPositionId: (positionen[i] ?? '') === '' ? null : positionen[i] as string,
          });
        }

        const art = feld('art');
        if (!istAbnahmeArt(art)) {
          throw new AbnahmeFehler(
            'ungueltige_eingabe',
            'Die Abnahmeart fehlt oder ist keine der vier des § 12 VOB/B.',
            422,
          );
        }

        /**
         * **Der Ersatzverweis gehört in DIESE Transaktion.** „Korrigiert wird
         * durch Storno mit Ersatzprotokoll" ist der Korrekturweg der Abnahme;
         * ohne `ersetzt_durch_id` stünden das stornierte Protokoll und sein
         * Ersatz unverbunden nebeneinander, und die Kette, die den Storno
         * rechtfertigt, entstünde nie. Das Formular schickt das zu ersetzende
         * Protokoll mit; der Dienst verbindet nur, was zum selben Projekt
         * gehört und wirklich storniert ist.
         */
        const ersetzt = feld('ersetzt');

        const protokoll = await protokolliereAbnahme(kontext, {
          projektId: feld('projekt'),
          art,
          abnahmeAm: feld('abnahme_am'),
          leistungsumfang: feld('leistungsumfang') === '' ? null : feld('leistungsumfang'),
          // Ein fehlendes Kontrollfeld ist „nein" — und „nein" ist beim
          // Vorbehalt der Vertragsstrafe eine Rechtsfolge (§ 11 Abs. 4).
          abgenommen: feld('abgenommen') === 'ja',
          verweigerungGrund: feld('verweigerung_grund') === ''
            ? null : feld('verweigerung_grund'),
          vorbehaltVertragsstrafe: feld('vorbehalt_vertragsstrafe') === 'ja',
          vorbehaltMaengel: feld('vorbehalt_maengel') === 'ja',
          vorbehaltText: feld('vorbehalt_text') === '' ? null : feld('vorbehalt_text'),
          teilnehmer: liste('teilnehmer').filter((t) => t !== ''),
          maengel,
        });
        const verbunden = ersetzt === ''
          ? false
          : await verknuepfeErsatzprotokoll(kontext, {
            storniertesId: ersetzt,
            ersatzId: protokoll.id,
          });
        return { art: 'protokoll' as const, ...protokoll, verbunden };
      }))) as
        | { art: 'mangel'; ok: boolean }
        | { art: 'storno'; ok: boolean }
        | {
          art: 'protokoll'; id: string; hash: string; fristEnde: string | null;
          verbunden: boolean;
        };

    if (ergebnis.art !== 'protokoll' && !ergebnis.ok) {
      return NextResponse.json(
        {
          fehler: 'nicht_gefunden',
          meldung: ergebnis.art === 'mangel'
            ? 'Dieser Mangel ist nicht (mehr) offen.'
            : 'Dieses Protokoll ist nicht (mehr) zu stornieren.',
        },
        { status: 404 },
      );
    }

    const mandant = feld('mandant');
    const projekt = feld('projekt');
    if (mandant !== '' && projekt !== '') {
      return NextResponse.redirect(internesZiel(
        feld('zurueck') === '' ? null : feld('zurueck'),
        `/portal/${mandant}/bau/projekte/${projekt}/abnahme`,
        anfrage,
      ), 303);
    }
    return NextResponse.json(ergebnis);
  } catch (fehler: unknown) {
    if (fehler instanceof AbnahmeFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.status },
      );
    }
    // AUT-06: ein fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }
}

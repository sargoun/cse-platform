import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type Sitzung } from '@/server/kontext/index';
import {
  ART_SPRACHEN, ArtFehler, archiviereArt, bestaetigeArt, legeArtAn,
  uebernimmPostenartVoreinstellung, uebernimmSchluesselartVoreinstellung,
  type ArtGrund, type ArtSprache, type ArtTabelle,
} from '@/server/services/security/arten';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { alsAntwort } from './antwort';
import { feldText } from './formular';

/**
 * Die Katalogpflege der Posten- und Schluesselarten — EIN Handler fuer beide
 * Routen (O-148, D-783 Pruefstand). `POST /api/sicherheit/posten` und
 * `POST /api/sicherheit/schluessel` rufen ihn, bevor sie ihre eigene Arbeit
 * tun; er antwortet `null`, wenn die `aktion` nicht seine ist.
 *
 * Vier Handlungen je Katalog, als `aktion` im Formular:
 *
 *  - `<tabelle>en_voreinstellung` — die Voreinstellung in den leeren Katalog,
 *  - `<tabelle>_bestaetigen` und `<tabelle>_archivieren`, mit `art` (id),
 *  - `<tabelle>_anlegen`, mit `bezeichnung` und freiwillig `bezeichnung_en`,
 *    `bezeichnung_ar`, `bezeichnung_tr` (EMP-12).
 *
 * **Beide Rechte des Moduls.** Der Dienst liest den Katalog, bevor er
 * schreibt, und `RETURNING` prueft die Lesepolitik der Zeile (0069/0079
 * `t_mandant`: `USING` ist das Leserecht). Ein Konto mit Schreib-, aber ohne
 * Leserecht bekaeme sonst einen Fehler statt einer Antwort. Also Lesen UND
 * Schreiben — wer den Katalog pflegt, darf ihn sehen; die Datenbank prueft
 * beides noch einmal (K-03).
 *
 * **Der Rueckweg ist die Seite, von der das Formular kam** (`herkunft`, nur
 * aus der eigenen Liste der Route — nie eine Adresse aus dem Formular), mit
 * `?arten=<ergebnis>`; die Seite macht den Satz daraus (V-232: ein Grund,
 * kein Quelltext). Ein Programm bekommt fuer einen Dienstfehler JSON wie
 * ueberall in diesem Modul (`alsAntwort`).
 */
export interface ArtenZiel {
  readonly tabelle: ArtTabelle;
  readonly rechtLesen: string;
  readonly rechtSchreiben: string;
  /** Die Rueckwege je `herkunft`; `liste` ist der Standard. */
  readonly seiten: Readonly<Record<string, string>> & { readonly liste: string };
}

export type ArtenErgebnis =
  | 'voreinstellung' | 'voreinstellung_vorhanden' | 'bestaetigt' | 'archiviert' | 'angelegt'
  | ArtGrund;

type Schritt = 'voreinstellung' | 'bestaetigen' | 'archivieren' | 'anlegen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function schrittVon(aktion: unknown, tabelle: ArtTabelle): Schritt | null {
  if (aktion === `${tabelle}en_voreinstellung`) return 'voreinstellung';
  if (aktion === `${tabelle}_bestaetigen`) return 'bestaetigen';
  if (aktion === `${tabelle}_archivieren`) return 'archivieren';
  if (aktion === `${tabelle}_anlegen`) return 'anlegen';
  return null;
}

function uebersetzungen(daten: FormData): Partial<Record<ArtSprache, string>> {
  const werte: Partial<Record<ArtSprache, string>> = {};
  for (const s of ART_SPRACHEN) {
    const t = feldText(daten, `bezeichnung_${s}`);
    if (t !== null) werte[s] = t;
  }
  return werte;
}

export async function artenAktion(
  anfrage: NextRequest, sitzung: Sitzung, daten: FormData, ziel: ArtenZiel,
): Promise<NextResponse | null> {
  const schritt = schrittVon(daten.get('aktion'), ziel.tabelle);
  if (schritt === null) return null;

  const seite = eigenerEintrag(ziel.seiten, daten.get('herkunft')) ?? ziel.seiten.liste;
  const zurueck = (ergebnis: ArtenErgebnis): NextResponse => {
    const url = internesZiel(seite, ziel.seiten.liste, anfrage);
    url.searchParams.set('arten', ergebnis);
    return NextResponse.redirect(url, 303);
  };

  const artId = feldText(daten, 'art');
  if ((schritt === 'bestaetigen' || schritt === 'archivieren')
    && (artId === null || !UUID.test(artId))) {
    return zurueck('nicht_gefunden');
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext): Promise<ArtenErgebnis> => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(sitzung, { recht: ziel.rechtLesen }, pruefer);
        await authorize(sitzung, { recht: ziel.rechtSchreiben, schreibend: true }, pruefer);
        if (schritt === 'voreinstellung') {
          const angelegt = ziel.tabelle === 'postenart'
            ? await uebernimmPostenartVoreinstellung(kontext)
            : await uebernimmSchluesselartVoreinstellung(kontext);
          return angelegt === 0 ? 'voreinstellung_vorhanden' : 'voreinstellung';
        }
        if (schritt === 'bestaetigen') {
          await bestaetigeArt(kontext, ziel.tabelle, artId ?? '');
          return 'bestaetigt';
        }
        if (schritt === 'archivieren') {
          await archiviereArt(kontext, ziel.tabelle, artId ?? '');
          return 'archiviert';
        }
        await legeArtAn(kontext, ziel.tabelle, {
          bezeichnung: feldText(daten, 'bezeichnung') ?? '',
          uebersetzungen: uebersetzungen(daten),
        });
        return 'angelegt';
      })) as Promise<ArtenErgebnis>);
    return zurueck(ergebnis);
  } catch (fehler) {
    if (fehler instanceof ArtFehler) return zurueck(fehler.grund);
    const antwort = alsAntwort(fehler, anfrage);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}

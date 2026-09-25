import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import {
  PlattformFehler, archivierePlattform, aenderePlattform, bestaetigePlattform,
  legePlattformAn, setzeRegistrierung, type PlattformRoh,
} from '@/server/services/radar/plattform';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/radar/plattform` — den Plattformkatalog und den
 * Registrierungsstand pflegen (RAD-09, O-07, V-175, D-669).
 *
 * **Fünf Handlungen an einer Adresse, weil sie EINE Seite betreffen**: eine
 * Plattform eintragen, einen Eintrag ändern, bestätigen oder archivieren (nur
 * die Super-Administration — das prüft der Dienst und die Policy
 * `r_plattform_schreiben`), und den Registrierungsstand dieser Gesellschaft
 * setzen. Das Tor davor ist das Recht der Seite, `radar.plattform_verwalten`.
 *
 * **Der Bereich kommt aus der SITZUNG** (Invariante 3), wie in
 * `api/radar/profil`; eine Abweisung führt auf die Seite zurück, mit dem
 * Grund als Schlüssel (D-599). JSON bleibt nur für fremden Ursprung, keine
 * Sitzung und kein Recht.
 *
 * **Der Handler bleibt dünn**: prüfen, den Dienst rufen, umleiten. Was eine
 * Plattform tragen darf und wann ein Stand vollständig ist, entscheidet
 * `services/radar/plattform.ts`.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (feld: string): string | null => {
    const wert = daten.get(feld);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const was = text('was') ?? '';
  const plattformRoh = text('plattform') ?? '';
  const plattform = UUID.test(plattformRoh) ? plattformRoh : '';
  const katalog = (): PlattformRoh => ({
    name: text('name'),
    slug: text('slug'),
    betreiber: text('betreiber'),
    basisUrl: text('basisUrl'),
    hostMuster: text('hostMuster'),
    registrierungErforderlich: text('registrierungErforderlich') === 'ja',
    registrierungDauerHinweis: text('registrierungDauerHinweis'),
  });

  /*
   * Gelesen in der Transaktion und nach AUSSEN gereicht — auch der
   * Fehlerzweig braucht ihn, und ein Rollback nimmt die Zuweisung nicht
   * zurück (dasselbe Muster wie `api/radar/profil`).
   */
  let slug = '';
  const seite = (): string => `/portal/${slug}/radar/plattformen`;

  let ergebnis: { readonly vermerkt: string; readonly zugeordnet: number | null };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'radar.plattform_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;

        switch (was) {
          case 'plattform_anlegen': {
            const e = await legePlattformAn(kontext, katalog());
            return { vermerkt: 'angelegt', zugeordnet: e.zugeordnet };
          }
          case 'plattform_aendern': {
            const e = await aenderePlattform(kontext, plattform, katalog());
            return { vermerkt: 'geaendert', zugeordnet: e.zugeordnet };
          }
          case 'plattform_bestaetigen':
            await bestaetigePlattform(kontext, plattform);
            return { vermerkt: 'bestaetigt', zugeordnet: null };
          case 'plattform_archivieren':
            await archivierePlattform(kontext, plattform);
            return { vermerkt: 'archiviert', zugeordnet: null };
          case 'registrierung':
            await setzeRegistrierung(kontext, plattform, {
              status: text('status'),
              benutzerkennung: text('benutzerkennung'),
              registriertAm: text('registriertAm'),
              gueltigBis: text('gueltigBis'),
              verantwortlichBenutzerId: text('verantwortlichBenutzerId'),
              notiz: text('notiz'),
            });
            return { vermerkt: 'registrierung', zugeordnet: null };
          default:
            throw new PlattformFehler('unbekannte_handlung', 'Unbekannte Handlung.');
        }
      })) as Promise<{ readonly vermerkt: string; readonly zugeordnet: number | null }>);
  } catch (fehler) {
    /* Eine abgewiesene EINGABE ist eine Auskunft, kein Serverfehler. */
    if (fehler instanceof PlattformFehler && slug !== '') {
      return NextResponse.redirect(
        internesZiel(`${seite()}?fehler=${fehler.code}`, seite(), anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const zugeordnet = ergebnis.zugeordnet === null ? '' : `&zugeordnet=${String(ergebnis.zugeordnet)}`;
  return NextResponse.redirect(
    internesZiel(`${seite()}?vermerkt=${ergebnis.vermerkt}${zugeordnet}`, seite(), anfrage), 303);
}

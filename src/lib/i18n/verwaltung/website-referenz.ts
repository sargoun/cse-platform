/**
 * Die Wörter der Referenzpflege — in beiden Sprachen (V-154, V-161, PRO-05,
 * D-592).
 *
 * **Der Befund, aus dem sie entstanden sind.** Eine Referenz liess sich nicht
 * anlegen: die Liste hatte keinen Knopf, die Route keine Handlung, der Dienst
 * kein `insert`. Die Wörter hier gehören zu dem Weg, der das jetzt tut — die
 * Liste, die Wahl des Auftrags, das Anlegeformular, das Blatt einer Referenz,
 * die Veröffentlichung und der Verweis von der Kundenfreigabe am Auftrag.
 *
 * **Die ganzen Seiten, nicht nur die neuen Sätze** (V-161). V-154 hatte nur
 * die neuen Wörter zweisprachig gemacht; in einer englischen Sitzung standen
 * die Überschrift „Referenzen", die Einleitung und „Für diese Gesellschaft ist
 * noch kein Projekt erfasst." deutsch neben dem englischen Knopf, und auf dem
 * Blatt deutsche Feldbeschriftungen neben englischen Hinweisen. Die vier
 * Seiten der Referenzpflege stehen deshalb vollständig hier und nicht mehr in
 * der Ausnahmeliste der Sprachwache.
 *
 * **`Kundenfreigabe` und `Auftrag` bleiben deutsch**, auch im englischen
 * Text: sie tragen die Bedeutung aus PRO-05 (die schriftliche Zustimmung, der
 * Vertrag), und die Rechtematrix kennt sie so. Erklärt wird in Klammern,
 * ersetzt wird nicht. „Referenz" selbst ist kein Rechtsbegriff und heisst
 * englisch „reference".
 */
import type { InternSprache } from '../intern.js';

export interface WebsiteReferenzTexte {
  /* ── Liste ──────────────────────────────────────────────────────────── */
  readonly listeTitel: string;
  readonly listeEinleitung: string;
  readonly neueReferenz: string;
  readonly leerTitel: string;
  readonly leerWeg: string;
  readonly anlegenVerlangt: string;
  readonly tabelleBeschriftung: string;
  readonly spalteProjekt: string;
  readonly spalteKunde: string;
  readonly spalteJahr: string;
  readonly spalteFreigabe: string;
  readonly spalteWebsite: string;
  readonly ohneDatum: string;
  readonly freigabeFehlt: string;
  readonly zurueckziehen: string;
  readonly veroeffentlichen: string;
  readonly erstMitFreigabe: string;
  readonly ausfuehrlich: string;

  /* ── Anlegen: die Wahl des Auftrags ─────────────────────────────────── */
  readonly wurzelTitel: string;
  readonly zurListe: string;
  readonly anlegenTitel: string;
  readonly anlegenEinleitung: string;
  readonly auswahlTitel: string;
  readonly auswahlBeschriftung: string;
  readonly spalteAuftrag: string;
  readonly spalteAbgeschlossen: string;
  readonly spalteReferenzen: string;
  readonly referenzenAnzahl: (anzahl: number) => string;
  readonly ausDiesemAnlegen: string;
  readonly laufendTitel: string;
  readonly laufendText: string;
  readonly keinerBereitTitel: string;
  readonly keinerBereitText: string;
  readonly zuDenAuftraegen: string;
  readonly ohneAuftragsrechtTitel: string;
  readonly ohneAuftragsrechtText: string;
  readonly andereWahl: string;
  /** Der Zustand eines Auftrags (`auftrag_status`), wie ihn diese Seiten nennen. */
  readonly auftragStand: Readonly<Record<string, string>>;

  /* ── Anlegen: ein bestimmter Auftrag ────────────────────────────────── */
  readonly auftragUnbekannt: string;
  readonly auftragOhneFreigabe: string;
  readonly auftragStorniert: string;
  readonly auftragOffen: (stand: string) => string;
  readonly ausAuftragTitel: (auftragsnummer: string) => string;
  readonly ausAuftragText: string;
  readonly zurKundenfreigabe: string;
  readonly schonAusAuftrag: string;
  /** Der Stand einer Referenz (`seite_status`) in einer Aufzählung. */
  readonly referenzStand: Readonly<Record<string, string>>;
  readonly slugBelegt: (slug: string) => string;
  readonly feldTitel: string;
  readonly feldSlug: string;
  readonly slugHinweis: string;
  readonly feldKunde: string;
  readonly kundeHinweis: string;
  readonly feldJahr: string;
  readonly beschreibungDanach: string;
  readonly anlegen: string;
  readonly abbrechen: string;
  readonly nurLesbarTitel: string;
  readonly nurLesbarText: string;
  readonly nichtAngelegt: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;

  /* ── Blatt einer Referenz ───────────────────────────────────────────── */
  readonly blattZurueck: string;
  readonly angelegtTitel: string;
  readonly angelegtText: string;
  readonly vorhandenTitel: string;
  readonly vorhandenText: string;
  readonly blattFehler: Readonly<Record<string, string>>;
  readonly blattFehlerSonst: string;
  readonly gespeichert: string;
  readonly blattNurLesbarTitel: string;
  /** Um die zwei Rechte herum: „verlangt <A> UND <B> — …". */
  readonly blattNurLesbarVor: string;
  readonly blattNurLesbarUnd: string;
  readonly blattNurLesbarNach: string;
  readonly herkunftTitel: string;
  readonly herkunftAuftrag: (auftragsnummer: string, kunde: string) => string;
  readonly herkunftZumAuftrag: string;
  readonly herkunftUnlesbar: string;
  readonly herkunftAltbestand: string;
  readonly herkunftWiderrufen: (am: string) => string;
  readonly adresseTitel: string;
  readonly adresseOeffentlich: string;
  readonly adresseNochNicht: string;
  readonly projektTitel: string;
  readonly feldBeschreibung: string;
  readonly beschreibungHinweis: string;
  readonly feldSortierung: string;
  readonly sortierungHinweis: string;
  readonly slugHinweisBlatt: string;
  readonly kundeHinweisBlatt: string;
  readonly feldBild: string;
  readonly keinBild: string;
  readonly platzhalterZusatz: string;
  readonly keineBilder: string;
  readonly bilderPlatzhalter: string;
  readonly speichern: string;
  readonly freigabeTitel: string;
  readonly freigabeErklaerung: string;
  readonly freigabeStand: string;
  readonly erteiltAm: string;
  readonly beleg: string;
  readonly vorschlagTitel: (auftragsnummer: string) => string;
  readonly vorschlagText: string;
  readonly belegAusAuftrag: (
    auftragsnummer: string, ansprechpartner: string | null, schreiben: string | null,
  ) => string;
  readonly freigabeHaken: string;
  readonly freigabeDatum: string;
  readonly freigabeBelegFrage: string;
  readonly freigabeSpeichern: string;
  readonly veroeffentlichungTitel: string;
  /** Um das Recht herum: „… mit einem eigenen Recht (<R>). …". */
  readonly veroeffentlichungVor: string;
  readonly veroeffentlichungNach: string;
  readonly zurVeroeffentlichung: string;
  readonly nurSuperAdminVor: string;
  readonly nurSuperAdminNach: string;

  /* ── Veröffentlichen ────────────────────────────────────────────────── */
  readonly vTitelVeroeffentlichen: string;
  readonly vTitelZurueckziehen: string;
  readonly vWasSteht: string;
  readonly vWasWuerde: string;
  readonly vAdresse: string;
  readonly vKeinName: string;
  readonly vPlatzhalterBild: string;
  readonly vPlatzhalterWarnung: string;
  readonly vEntscheidung: string;
  readonly vGruppeLesend: string;
  /** Nach dem Recht: „Auf die Website stellen darf, wer <R> hält — …". */
  readonly vKeinSchaltrechtNach: string;
  /** Um die Adresse herum: „Zurückgezogen antwortet <adresse> mit 404. …". */
  readonly vZurueckziehenVor: string;
  readonly vZurueckziehenNach: string;
  readonly vVeroeffentlichenVor: string;
  readonly vVeroeffentlichenNach: string;
  readonly vOhneFreigabeTitel: string;
  readonly vFehltZustimmung: string;
  readonly vFehltHaken: string;
  readonly vEingetragenVor: string;
  readonly vBearbeitungsseite: string;
  /** Um das Recht herum: „— und dort verlangt sie <R>. Hier steht deshalb …". */
  readonly vEingetragenNach: string;
  readonly vKeinKnopf: string;

  /* ── Kundenfreigabe am Auftrag ──────────────────────────────────────── */
  readonly ausAuftragAnlegen: string;
  readonly erstNachAbschluss: string;
  readonly ausDiesemAuftragAnzahl: (anzahl: number) => string;

  /*
   * ── Veröffentlichen / Zurückziehen abgewiesen ───────────────────────────
   * `api/website/referenzen` antwortete mit `{"fehler": grund}`; jetzt kommt
   * der Grund auf die Seite zurück, und hier steht der Satz (V-154).
   */
  readonly statusNichtGesetzt: string;
  readonly statusFehler: Readonly<Record<string, string>>;
  readonly statusFehlerSonst: string;
}

const DE: WebsiteReferenzTexte = {
  listeTitel: 'Referenzen',
  listeEinleitung:
    'Ein Projekt geht nur mit schriftlicher Zustimmung des Kunden auf die Website. Ohne sie '
    + 'bleibt es hier stehen — auch als Entwurf ist es kein Versehen, sondern der Normalfall.',
  neueReferenz: 'Neue Referenz',
  leerTitel: 'Für diese Gesellschaft ist noch kein Projekt erfasst.',
  leerWeg:
    'Eine Referenz entsteht aus einem abgeschlossenen Auftrag, dessen Kunde der '
    + 'Veröffentlichung schriftlich zugestimmt hat. Sie beginnt als Entwurf und bleibt '
    + 'unsichtbar, bis ihre eigene Kundenfreigabe eingetragen und die Veröffentlichung '
    + 'entschieden ist.',
  anlegenVerlangt: 'Anlegen verlangt zusätzlich das Recht',
  tabelleBeschriftung: 'Referenzen dieser Gesellschaft',
  spalteProjekt: 'Projekt',
  spalteKunde: 'Kunde',
  spalteJahr: 'Jahr',
  spalteFreigabe: 'Kundenfreigabe',
  spalteWebsite: 'Website',
  ohneDatum: 'ohne Datum',
  freigabeFehlt: 'fehlt',
  zurueckziehen: 'Zurückziehen',
  veroeffentlichen: 'Veröffentlichen',
  erstMitFreigabe: 'erst mit Kundenfreigabe',
  ausfuehrlich: 'Ausführlich',

  wurzelTitel: 'Website',
  zurListe: 'Referenzen',
  anlegenTitel: 'Neue Referenz',
  anlegenEinleitung:
    'Eine Referenz ist ein abgeschlossener Auftrag, dessen Kunde der Veröffentlichung '
    + 'schriftlich zugestimmt hat — kein frei geschriebener Werbeeintrag (PRO-05). Sie '
    + 'entsteht als Entwurf und ohne eigene Kundenfreigabe. Öffentlich wird sie erst, '
    + 'wenn die Zustimmung mit Datum und Beleg eingetragen ist und jemand mit eigenem Recht '
    + 'veröffentlicht — drei Schritte, drei Entscheidungen.',
  auswahlTitel: 'Aus welchem Auftrag?',
  auswahlBeschriftung: 'Abgeschlossene Aufträge mit geltender Kundenfreigabe',
  spalteAuftrag: 'Auftrag',
  spalteAbgeschlossen: 'Abgeschlossen',
  spalteReferenzen: 'Referenzen daraus',
  referenzenAnzahl: (n) => (n === 0 ? 'noch keine' : n === 1 ? '1 Referenz' : `${String(n)} Referenzen`),
  ausDiesemAnlegen: 'Referenz anlegen',
  laufendTitel: 'Mit Kundenfreigabe, aber noch nicht abgeschlossen',
  laufendText:
    'Aus diesen Aufträgen entsteht eine Referenz mit ihrem Abschluss. Ob ein laufender '
    + 'Dauerauftrag schon vorher genügt, ist beim Auftraggeber angefragt (O-914).',
  keinerBereitTitel: 'Noch kein Auftrag ist bereit.',
  keinerBereitText:
    'Die Kundenfreigabe wird am Auftrag erfasst, der Abschluss ebenso. Ein Projekt aus der '
    + 'Zeit vor der Plattform wird dafür als Auftrag angelegt und abgeschlossen.',
  zuDenAuftraegen: 'Zu den Aufträgen',
  ohneAuftragsrechtTitel: 'Hier lässt sich kein Auftrag wählen.',
  ohneAuftragsrechtText:
    'Eine Referenz entsteht aus einem Auftrag, und diese Sitzung darf Aufträge nicht '
    + 'lesen. Es fehlt das Recht',
  andereWahl: 'Anderen Auftrag wählen',
  auftragStand: {
    angelegt: 'angelegt, noch nicht begonnen',
    aktiv: 'läuft',
    pausiert: 'ruht',
    abgeschlossen: 'abgeschlossen',
    storniert: 'storniert',
  },

  auftragUnbekannt:
    'Diesen Auftrag gibt es in dieser Gesellschaft nicht. Wählen Sie einen aus der Liste.',
  auftragOhneFreigabe:
    'Dieser Auftrag trägt keine geltende Kundenfreigabe. Ohne sie entsteht aus ihm keine '
    + 'Referenz — die Freigabe wird am Auftrag erfasst.',
  auftragStorniert:
    'Dieser Auftrag ist storniert — er kommt nicht zustande, und aus ihm entsteht keine '
    + 'Referenz.',
  auftragOffen: (stand) =>
    `Dieser Auftrag ist noch nicht abgeschlossen (Stand: ${stand}). Eine Referenz ist ein `
    + 'abgeschlossener Auftrag (PRO-05); ob ein laufender Dauerauftrag genügt, ist beim '
    + 'Auftraggeber angefragt (O-914).',
  ausAuftragTitel: (nr) => `Vorbelegt aus Auftrag ${nr}.`,
  ausAuftragText:
    'Übernommen sind Titel und Kundenname, sonst nichts. Prüfen Sie beides — die '
    + 'Bezeichnung im Auftrag ist selten die Überschrift, unter der ein Kunde öffentlich '
    + 'genannt werden möchte.',
  zurKundenfreigabe: 'Zur Kundenfreigabe am Auftrag',
  schonAusAuftrag: 'Aus diesem Auftrag gibt es schon:',
  referenzStand: {
    entwurf: 'Entwurf',
    veroeffentlicht: 'veröffentlicht',
    archiviert: 'archiviert',
  },
  slugBelegt: (slug) =>
    `Die Adresse aus diesem Titel („${slug}“) trägt schon eine Referenz dieser Gesellschaft. `
    + 'Tragen Sie einen eigenen Slug ein.',
  feldTitel: 'Titel',
  feldSlug: 'Slug — der letzte Teil der Adresse',
  slugHinweis:
    'Leer lassen: er entsteht aus dem Titel. Ist die Referenz einmal öffentlich, bricht '
    + 'jede Änderung eingehende Verweise.',
  feldKunde: 'Kundenname',
  kundeHinweis: 'Er erscheint nur mit Kundenfreigabe auf der Website.',
  feldJahr: 'Jahr',
  beschreibungDanach:
    'Beschreibung und Bild tragen Sie danach auf dem Blatt der Referenz ein — dort steht '
    + 'auch ihre Kundenfreigabe.',
  anlegen: 'Als Entwurf anlegen',
  abbrechen: 'Abbrechen',
  nurLesbarTitel: 'Hier lässt sich nichts anlegen.',
  nurLesbarText:
    'Eine Referenz anzulegen verlangt beide Rechte — das zweite verlangt die Datenbank '
    + 'für jeden Schreibvorgang auf dieser Tabelle, auch für das Anlegen:',
  nichtAngelegt: 'Nichts wurde angelegt.',
  fehler: {
    titel_fehlt: 'Eine Referenz ohne Titel hat keine Überschrift.',
    slug_form:
      'Der Slug besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — er ist '
      + 'Teil der öffentlichen Adresse.',
    slug_vergeben:
      'Diese Adresse trägt in dieser Gesellschaft schon eine andere Referenz — auch eine '
      + 'gelöschte hält ihren Slug. Tragen Sie einen anderen Slug ein; aus dem Titel '
      + 'ergäbe sich gerade der belegte. Ihre übrigen Angaben stehen wieder im Formular.',
    jahr_ungueltig: 'Das Jahr liegt zwischen 1990 und 2100 — oder es bleibt leer.',
    kein_freigaberecht:
      'Eine Referenz anzulegen verlangt das Recht, Kundenfreigaben zu erfassen. Es fehlt '
      + 'dieser Sitzung.',
    auftrag_fehlt:
      'Eine Referenz entsteht aus einem Auftrag dieser Gesellschaft — und der gewählte ist '
      + 'hier nicht lesbar. Wählen Sie ihn aus der Liste.',
    auftrag_ohne_freigabe:
      'Die Kundenfreigabe dieses Auftrags gilt nicht (mehr) — vermutlich wurde sie eben '
      + 'widerrufen. Ohne sie entsteht aus ihm keine Referenz.',
    auftrag_offen:
      'Dieser Auftrag ist nicht abgeschlossen. Eine Referenz ist ein abgeschlossener '
      + 'Auftrag (PRO-05, offen: O-914).',
    auftrag_storniert:
      'Dieser Auftrag ist storniert — aus ihm entsteht keine Referenz.',
    nicht_angelegt: 'Die Referenz wurde nicht angelegt. Bitte laden Sie die Seite neu.',
    unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
  },
  fehlerSonst: 'Die Anlage wurde abgewiesen.',

  blattZurueck: 'Referenzen',
  angelegtTitel: 'Angelegt — als Entwurf und ohne Kundenfreigabe.',
  angelegtText:
    'Öffentlich ist noch nichts. Die nächsten Schritte stehen unten: Beschreibung und Bild '
    + 'im Block „Projekt“, danach die schriftliche Zustimmung des Kunden mit Datum und '
    + 'Beleg.',
  vorhandenTitel: 'Diese Referenz gab es schon.',
  vorhandenText:
    'Aus demselben Auftrag und unter derselben Adresse war sie bereits angelegt — '
    + 'vermutlich wurde doppelt geklickt. Eine zweite ist nicht entstanden.',
  blattFehler: {
    nicht_gefunden: 'Diese Referenz gibt es hier nicht.',
    kein_freigaberecht:
      'Jede Änderung an einer Referenz verlangt das Recht, Kundenfreigaben zu erfassen — '
      + 'und das fehlt dieser Sitzung. An der Referenz hat sich nichts geändert.',
    titel_fehlt: 'Eine Referenz ohne Titel hat keine Überschrift.',
    slug_form:
      'Der Slug besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — er ist '
      + 'Teil der öffentlichen Adresse.',
    slug_vergeben:
      'Diese Adresse trägt in dieser Gesellschaft schon eine andere Referenz — auch eine '
      + 'gelöschte hält ihren Slug weiter (Invariante 8). Tragen Sie einen anderen Slug '
      + 'ein; das leere Feld schlägt den aus dem Titel vor, und der ist hier gerade der '
      + 'belegte.',
    jahr_ungueltig: 'Das Jahr liegt zwischen 1990 und 2100 — oder es bleibt leer.',
    sortierung_ungueltig: 'Die Sortierung ist eine ganze Zahl ab null.',
    bild_fremd: 'Dieses Bild gehört nicht zu dieser Gesellschaft.',
    freigabe_ohne_datum:
      'Eine Kundenfreigabe braucht ein Datum. Ohne Datum lässt die Datenbank sie nicht zu '
      + '— und beim Anruf des Kunden ist das Datum die Frage.',
    freigabe_datum_form:
      'Das Freigabedatum steht als Jahr-Monat-Tag, etwa 2026-03-29 — und muss ein Tag '
      + 'sein, den es gibt.',
    freigabe_ohne_beleg:
      'Woraus geht die Zustimmung hervor? E-Mail, Vertragsklausel, unterschriebenes Blatt '
      + '— ein Satz genügt, aber er muss dastehen.',
    nicht_geaendert:
      'Der Schreibvorgang ging nicht durch. Die Referenz gehört nicht zu dieser '
      + 'Gesellschaft, oder dieser Sitzung fehlt das Recht.',
    unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
  },
  blattFehlerSonst: 'Die Handlung wurde abgewiesen.',
  gespeichert: 'Gespeichert.',
  blattNurLesbarTitel: 'Diese Seite ist hier nur lesbar.',
  blattNurLesbarVor: 'Eine Änderung an einer Referenz verlangt',
  blattNurLesbarUnd: 'UND',
  blattNurLesbarNach:
    '— das zweite steht in der Policy t_referenz_pflege für jeden Schreibvorgang auf '
    + 'dieser Tabelle, nicht nur für das Häkchen. Formulare, die nichts ändern, stehen '
    + 'deshalb hier nicht.',
  herkunftTitel: 'Herkunft',
  herkunftAuftrag: (nr, kunde) => `Angelegt aus Auftrag ${nr} (${kunde}).`,
  herkunftZumAuftrag: 'Zur Kundenfreigabe am Auftrag',
  herkunftUnlesbar:
    'Angelegt aus einem Auftrag dieser Gesellschaft. Ihn zu lesen verlangt das Recht, '
    + 'Aufträge zu lesen, und das fehlt dieser Sitzung — deshalb steht unten kein Vorschlag.',
  herkunftAltbestand:
    'Ohne Herkunft: diese Referenz entstand, bevor eine Referenz ihren Auftrag festhielt '
    + '(V-161). Ihre Kundenfreigabe steht allein im Block unten.',
  herkunftWiderrufen: (am) =>
    `Die Kundenfreigabe am Auftrag wurde am ${am} widerrufen. Was das für eine schon `
    + 'veröffentlichte Referenz heisst, ist beim Auftraggeber angefragt (O-735); '
    + 'entfernt wird nichts von selbst.',
  adresseTitel: 'Öffentliche Adresse',
  adresseOeffentlich:
    'Ein geänderter Slug bricht jeden eingehenden Verweis und jeden Eintrag im Index einer '
    + 'Suchmaschine. Die alte Adresse antwortet danach mit 404.',
  adresseNochNicht:
    'Diese Adresse antwortet heute mit 404: öffentlich ist eine Referenz nur mit '
    + 'Kundenfreigabe UND veröffentlichtem Zustand — beides prüft die Policy '
    + 't_referenz_oeffentlich.',
  projektTitel: 'Projekt',
  feldBeschreibung: 'Beschreibung',
  beschreibungHinweis:
    'Was gemacht wurde. Nie Auftragswert, Ansprechpartner oder Vertragsinhalte — die '
    + 'Referenz ist eine eigene Formulierung für die Öffentlichkeit.',
  feldSortierung: 'Sortierung',
  sortierungHinweis: 'Kleinere Zahlen stehen auf der Projektliste oben.',
  slugHinweisBlatt:
    'Leer lassen schlägt einen aus dem Titel vor (app.slug_aus_titel) — dieselbe Funktion, '
    + 'die beim Anlegen greift.',
  kundeHinweisBlatt: 'Er geht nur mit Kundenfreigabe hinaus — der Block darunter.',
  feldBild: 'Bild — aus den Bildern dieser Gesellschaft',
  keinBild: 'kein Bild',
  platzhalterZusatz: ' (Platzhalter)',
  keineBilder:
    'Für diese Gesellschaft ist kein Bild erfasst. medien-Zeilen entstehen über pnpm '
    + 'content:import; einen Upload gibt es im Portal nicht.',
  bilderPlatzhalter:
    'Echtes Bildmaterial mit Freigaben fehlt noch (O-13) — was hier als Platzhalter '
    + 'markiert ist, gehört nicht auf eine Kundenreferenz.',
  speichern: 'Speichern',
  freigabeTitel: 'Kundenfreigabe',
  freigabeErklaerung:
    'Ohne schriftliche Zustimmung des Kunden geht sein Name nicht auf die Website. Die '
    + 'Datenbank lässt eine Freigabe ohne Datum gar nicht zu (referenz_freigabe_belegt) — '
    + 'und der Beleg steht dabei, weil beim Anruf des Kunden genau danach gefragt wird.',
  freigabeStand: 'Stand',
  erteiltAm: 'Erteilt am',
  beleg: 'Beleg',
  vorschlagTitel: (nr) => `Datum und Beleg sind aus der Kundenfreigabe am Auftrag ${nr} vorgeschlagen.`,
  vorschlagText:
    'Gespeichert ist davon noch nichts. Prüfen Sie, ob die Zustimmung des Kunden auch '
    + 'diese Referenz mit diesem Text deckt, und speichern Sie dann selbst (offen: O-913).',
  belegAusAuftrag: (nr, ansprechpartner, schreiben) =>
    `Kundenfreigabe am Auftrag ${nr}`
    + (ansprechpartner === null ? '' : `, erklärt von ${ansprechpartner}`)
    + (schreiben === null ? '' : `, Schreiben „${schreiben}“`)
    + '.',
  freigabeHaken: 'Der Kunde hat schriftlich zugestimmt.',
  freigabeDatum: 'Datum der Zustimmung',
  freigabeBelegFrage: 'Beleg — woraus geht die Zustimmung hervor?',
  freigabeSpeichern: 'Freigabe speichern',
  veroeffentlichungTitel: 'Veröffentlichung',
  veroeffentlichungVor: 'Auf die Website stellen ist eine eigene Entscheidung mit einem eigenen Recht (',
  veroeffentlichungNach: '). Die ausführliche Fassung zeigt vorher, was öffentlich würde.',
  zurVeroeffentlichung: 'Zur Veröffentlichung',
  nurSuperAdminVor: 'Auf die Website stellen darf, wer',
  nurSuperAdminNach:
    'hält — heute nur die Super-Administration. Diese Sitzung pflegt die Angaben; die '
    + 'Entscheidung fällt anderswo.',

  vTitelVeroeffentlichen: 'Veröffentlichen',
  vTitelZurueckziehen: 'Zurückziehen',
  vWasSteht: 'Was öffentlich steht',
  vWasWuerde: 'Was öffentlich würde',
  vAdresse: 'Adresse',
  vKeinName: '— (kein Name genannt)',
  vPlatzhalterBild: ' — Platzhalter (O-13)',
  vPlatzhalterWarnung:
    'Das gewählte Bild ist als Platzhalter markiert. Ein Platzhalterbild unter einer '
    + 'Kundenreferenz ist eine Aussage über ein Projekt, das so nicht aussah — echtes '
    + 'Bildmaterial mit Freigaben fehlt noch (O-13).',
  vEntscheidung: 'Entscheidung',
  vGruppeLesend:
    'Die Gruppenansicht ist lesend (Invariante 10). Veröffentlicht wird in genau einer '
    + 'Gesellschaft.',
  vKeinSchaltrechtNach:
    'hält — heute nur die Super-Administration. Hier steht deshalb kein Knopf: einer, der '
    + 'abgewiesen wird, ist schlechter als keiner.',
  vZurueckziehenVor: 'Zurückgezogen antwortet',
  vZurueckziehenNach:
    'mit 404. Eingehende Verweise brechen, und was eine Suchmaschine schon gelesen hat, '
    + 'bleibt eine Weile in ihrem Cache — zurückholen kann diese Plattform das nicht.',
  vVeroeffentlichenVor:
    'Die Kundenfreigabe liegt vor. Veröffentlicht steht dieses Projekt mit Namen, Kunden '
    + 'und Jahr unter',
  vVeroeffentlichenNach: 'und in der Projektliste der Gesellschaft.',
  vOhneFreigabeTitel: 'Ohne Kundenfreigabe geht diese Referenz nicht hinaus.',
  vFehltZustimmung: 'Es fehlt die Zustimmung mit Datum und Beleg.',
  vFehltHaken: 'Es fehlt das Häkchen.',
  vEingetragenVor: 'Eingetragen wird sie im Block „Kundenfreigabe“ auf der',
  vBearbeitungsseite: 'Bearbeitungsseite',
  vEingetragenNach: '— und dort verlangt sie',
  vKeinKnopf:
    '. Hier steht deshalb kein Knopf: die Policy wiese ihn ab, und ein Knopf, der still '
    + 'nichts tut, lässt den Menschen den Fehler bei sich suchen.',

  ausAuftragAnlegen: 'Referenz aus diesem Auftrag anlegen',
  erstNachAbschluss:
    'Eine Referenz entsteht aus diesem Auftrag, sobald er abgeschlossen ist (PRO-05; ob '
    + 'ein laufender Auftrag genügt, ist angefragt: O-914).',
  ausDiesemAuftragAnzahl: (n) => (n === 0
    ? 'Aus diesem Auftrag ist noch keine Referenz angelegt.'
    : n === 1
      ? 'Aus diesem Auftrag ist 1 Referenz angelegt.'
      : `Aus diesem Auftrag sind ${String(n)} Referenzen angelegt.`),

  statusNichtGesetzt: 'Der Stand auf der Website hat sich nicht geändert.',
  statusFehler: {
    ohne_kundenfreigabe:
      'Diese Referenz trägt keine Kundenfreigabe (mehr). Ohne sie darf der Kundenname '
      + 'nicht auf die Website — tragen Sie zuerst die Zustimmung mit Datum und Beleg ein.',
    nicht_gefunden: 'Diese Referenz gibt es hier nicht.',
    nicht_geaendert:
      'Der Stand wurde nicht gesetzt — dieser Sitzung fehlt das Schreibrecht.',
  },
  statusFehlerSonst: 'Die Handlung wurde abgewiesen.',
};

const EN: WebsiteReferenzTexte = {
  listeTitel: 'References',
  listeEinleitung:
    'A project only goes on the website with the customer’s written consent. Without it, it '
    + 'stays here — even as a draft that is no mistake but the normal case.',
  neueReferenz: 'New reference',
  leerTitel: 'No project has been recorded for this Gesellschaft (legal entity) yet.',
  leerWeg:
    'A reference comes from a completed Auftrag (order) whose customer has agreed in '
    + 'writing to its publication. It starts as a draft and stays invisible until its own '
    + 'Kundenfreigabe (customer release) is recorded and publication has been decided.',
  anlegenVerlangt: 'Creating one additionally requires the right',
  tabelleBeschriftung: 'References of this Gesellschaft',
  spalteProjekt: 'Project',
  spalteKunde: 'Customer',
  spalteJahr: 'Year',
  spalteFreigabe: 'Kundenfreigabe',
  spalteWebsite: 'Website',
  ohneDatum: 'no date',
  freigabeFehlt: 'missing',
  zurueckziehen: 'Withdraw',
  veroeffentlichen: 'Publish',
  erstMitFreigabe: 'only with a Kundenfreigabe',
  ausfuehrlich: 'In detail',

  wurzelTitel: 'Website',
  zurListe: 'References',
  anlegenTitel: 'New reference',
  anlegenEinleitung:
    'A reference is a completed Auftrag (order) whose customer has agreed in writing to its '
    + 'publication — not a marketing entry typed by hand (PRO-05). It starts as a draft and '
    + 'without its own Kundenfreigabe (customer release). It only becomes public once the '
    + 'consent is recorded with date and evidence and someone with their own right '
    + 'publishes it — three steps, three decisions.',
  auswahlTitel: 'From which Auftrag?',
  auswahlBeschriftung: 'Completed Aufträge with a valid Kundenfreigabe',
  spalteAuftrag: 'Auftrag',
  spalteAbgeschlossen: 'Completed',
  spalteReferenzen: 'References from it',
  referenzenAnzahl: (n) => (n === 0 ? 'none yet' : n === 1 ? '1 reference' : `${String(n)} references`),
  ausDiesemAnlegen: 'Create reference',
  laufendTitel: 'With a Kundenfreigabe, but not yet completed',
  laufendText:
    'A reference comes from these Aufträge once they are completed. Whether a running '
    + 'standing order is enough before that has been asked of the client (O-914).',
  keinerBereitTitel: 'No Auftrag is ready yet.',
  keinerBereitText:
    'The Kundenfreigabe is recorded on the Auftrag, and so is its completion. A project '
    + 'from before the platform is entered as an Auftrag for this and completed.',
  zuDenAuftraegen: 'To the Aufträge',
  ohneAuftragsrechtTitel: 'No Auftrag can be chosen here.',
  ohneAuftragsrechtText:
    'A reference comes from an Auftrag, and this session may not read Aufträge. It lacks '
    + 'the right',
  andereWahl: 'Choose another Auftrag',
  auftragStand: {
    angelegt: 'created, not started yet',
    aktiv: 'running',
    pausiert: 'paused',
    abgeschlossen: 'completed',
    storniert: 'cancelled',
  },

  auftragUnbekannt:
    'This Auftrag does not exist in this Gesellschaft. Choose one from the list.',
  auftragOhneFreigabe:
    'This Auftrag carries no valid Kundenfreigabe. Without it no reference comes from it — '
    + 'the release is recorded on the Auftrag.',
  auftragStorniert:
    'This Auftrag has been cancelled — it does not come about, and no reference comes from '
    + 'it.',
  auftragOffen: (stand) =>
    `This Auftrag is not completed yet (state: ${stand}). A reference is a completed `
    + 'Auftrag (PRO-05); whether a running standing order is enough has been asked of the '
    + 'client (O-914).',
  ausAuftragTitel: (nr) => `Prefilled from Auftrag (order) ${nr}.`,
  ausAuftragText:
    'Title and customer name were copied, nothing else. Check both — the order’s label is '
    + 'rarely the heading under which a customer wants to be named in public.',
  zurKundenfreigabe: 'To the Kundenfreigabe on the Auftrag',
  schonAusAuftrag: 'From this Auftrag there already is:',
  referenzStand: {
    entwurf: 'draft',
    veroeffentlicht: 'published',
    archiviert: 'archived',
  },
  slugBelegt: (slug) =>
    `The address from this title (“${slug}”) already belongs to a reference of this `
    + 'Gesellschaft. Enter a slug of your own.',
  feldTitel: 'Title',
  feldSlug: 'Slug — the last part of the address',
  slugHinweis:
    'Leave empty: it is derived from the title. Once the reference is public, every change '
    + 'breaks incoming links.',
  feldKunde: 'Customer name',
  kundeHinweis: 'It only appears on the website with a Kundenfreigabe.',
  feldJahr: 'Year',
  beschreibungDanach:
    'Description and image are entered afterwards on the reference’s sheet — that is also '
    + 'where its Kundenfreigabe goes.',
  anlegen: 'Create as draft',
  abbrechen: 'Cancel',
  nurLesbarTitel: 'Nothing can be created here.',
  nurLesbarText:
    'Creating a reference requires both rights — the database demands the second for every '
    + 'write to this table, creating included:',
  nichtAngelegt: 'Nothing was created.',
  fehler: {
    titel_fehlt: 'A reference without a title has no heading.',
    slug_form:
      'The slug consists of lower-case letters, digits and single hyphens — it is part of '
      + 'the public address.',
    slug_vergeben:
      'Another reference of this Gesellschaft already holds this address — a deleted one '
      + 'keeps its slug too. Enter a different slug; the title would produce the taken one. '
      + 'Your other entries are back in the form.',
    jahr_ungueltig: 'The year lies between 1990 and 2100 — or stays empty.',
    kein_freigaberecht:
      'Creating a reference requires the right to record customer releases. This session '
      + 'does not hold it.',
    auftrag_fehlt:
      'A reference comes from an Auftrag of this Gesellschaft — and the one chosen cannot be '
      + 'read here. Choose it from the list.',
    auftrag_ohne_freigabe:
      'This Auftrag’s Kundenfreigabe is not (or no longer) valid — it was probably just '
      + 'revoked. Without it no reference comes from it.',
    auftrag_offen:
      'This Auftrag is not completed. A reference is a completed Auftrag (PRO-05, open: '
      + 'O-914).',
    auftrag_storniert:
      'This Auftrag has been cancelled — no reference comes from it.',
    nicht_angelegt: 'The reference was not created. Please reload the page.',
    unbekannte_handlung: 'The route does not know this action.',
  },
  fehlerSonst: 'Creating it was refused.',

  blattZurueck: 'References',
  angelegtTitel: 'Created — as a draft and without Kundenfreigabe.',
  angelegtText:
    'Nothing is public yet. The next steps are below: description and image in the '
    + '“Project” block, then the customer’s written consent with date and evidence.',
  vorhandenTitel: 'This reference already existed.',
  vorhandenText:
    'It had already been created from the same Auftrag under the same address — probably a '
    + 'double click. No second one was created.',
  blattFehler: {
    nicht_gefunden: 'This reference does not exist here.',
    kein_freigaberecht:
      'Every change to a reference requires the right to record customer releases — and '
      + 'this session lacks it. Nothing about the reference has changed.',
    titel_fehlt: 'A reference without a title has no heading.',
    slug_form:
      'The slug consists of lower-case letters, digits and single hyphens — it is part of '
      + 'the public address.',
    slug_vergeben:
      'Another reference of this Gesellschaft already holds this address — a deleted one '
      + 'keeps its slug too (invariant 8). Enter a different slug; the empty field suggests '
      + 'the one from the title, and that is the taken one here.',
    jahr_ungueltig: 'The year lies between 1990 and 2100 — or stays empty.',
    sortierung_ungueltig: 'The sort order is a whole number from zero.',
    bild_fremd: 'This image does not belong to this Gesellschaft.',
    freigabe_ohne_datum:
      'A Kundenfreigabe needs a date. Without one the database does not accept it — and '
      + 'when the customer calls, the date is the question.',
    freigabe_datum_form:
      'The release date is written year-month-day, e.g. 2026-03-29 — and must be a day that '
      + 'exists.',
    freigabe_ohne_beleg:
      'What shows the consent? An e-mail, a contract clause, a signed sheet — one sentence '
      + 'is enough, but it has to be there.',
    nicht_geaendert:
      'The write did not go through. The reference does not belong to this Gesellschaft, or '
      + 'this session lacks the right.',
    unbekannte_handlung: 'The route does not know this action.',
  },
  blattFehlerSonst: 'The action was refused.',
  gespeichert: 'Saved.',
  blattNurLesbarTitel: 'This page is read-only here.',
  blattNurLesbarVor: 'A change to a reference requires',
  blattNurLesbarUnd: 'AND',
  blattNurLesbarNach:
    '— the policy t_referenz_pflege demands the second for every write to this table, not '
    + 'only for the tick. Forms that change nothing are therefore not shown here.',
  herkunftTitel: 'Origin',
  herkunftAuftrag: (nr, kunde) => `Created from Auftrag ${nr} (${kunde}).`,
  herkunftZumAuftrag: 'To the Kundenfreigabe on the Auftrag',
  herkunftUnlesbar:
    'Created from an Auftrag of this Gesellschaft. Reading it requires the right to read '
    + 'Aufträge, which this session lacks — so there is no suggestion below.',
  herkunftAltbestand:
    'No origin: this reference was created before a reference recorded its Auftrag '
    + '(V-161). Its Kundenfreigabe stands on its own in the block below.',
  herkunftWiderrufen: (am) =>
    `The Kundenfreigabe on the Auftrag was revoked on ${am}. What that means for a `
    + 'reference that is already published has been asked of the client (O-735); nothing is '
    + 'removed automatically.',
  adresseTitel: 'Public address',
  adresseOeffentlich:
    'A changed slug breaks every incoming link and every entry in a search engine’s index. '
    + 'The old address then answers with 404.',
  adresseNochNicht:
    'Today this address answers with 404: a reference is only public with a Kundenfreigabe '
    + 'AND in the published state — the policy t_referenz_oeffentlich checks both.',
  projektTitel: 'Project',
  feldBeschreibung: 'Description',
  beschreibungHinweis:
    'What was done. Never the order value, contact persons or contract terms — the '
    + 'reference is its own wording for the public.',
  feldSortierung: 'Sort order',
  sortierungHinweis: 'Smaller numbers come first on the project list.',
  slugHinweisBlatt:
    'Leaving it empty suggests one from the title (app.slug_aus_titel) — the same function '
    + 'that applies when creating.',
  kundeHinweisBlatt: 'It only goes out with a Kundenfreigabe — the block below.',
  feldBild: 'Image — from this Gesellschaft’s images',
  keinBild: 'no image',
  platzhalterZusatz: ' (placeholder)',
  keineBilder:
    'No image has been recorded for this Gesellschaft. medien rows are created by pnpm '
    + 'content:import; the portal has no upload.',
  bilderPlatzhalter:
    'Real imagery with releases is still missing (O-13) — what is marked as a placeholder '
    + 'here does not belong on a customer reference.',
  speichern: 'Save',
  freigabeTitel: 'Kundenfreigabe (customer release)',
  freigabeErklaerung:
    'Without the customer’s written consent their name does not go on the website. The '
    + 'database does not even accept a release without a date (referenz_freigabe_belegt) — '
    + 'and the evidence stands next to it, because that is exactly what is asked when the '
    + 'customer calls.',
  freigabeStand: 'State',
  erteiltAm: 'Given on',
  beleg: 'Evidence',
  vorschlagTitel: (nr) => `Date and evidence are suggested from the Kundenfreigabe on Auftrag ${nr}.`,
  vorschlagText:
    'None of it is saved yet. Check whether the customer’s consent also covers this '
    + 'reference with this text, then save it yourself (open: O-913).',
  belegAusAuftrag: (nr, ansprechpartner, schreiben) =>
    `Kundenfreigabe on Auftrag ${nr}`
    + (ansprechpartner === null ? '' : `, declared by ${ansprechpartner}`)
    + (schreiben === null ? '' : `, letter “${schreiben}”`)
    + '.',
  freigabeHaken: 'The customer has agreed in writing.',
  freigabeDatum: 'Date of consent',
  freigabeBelegFrage: 'Evidence — what shows the consent?',
  freigabeSpeichern: 'Save release',
  veroeffentlichungTitel: 'Publication',
  veroeffentlichungVor: 'Putting it on the website is a decision of its own with a right of its own (',
  veroeffentlichungNach: '). The detailed view shows beforehand what would become public.',
  zurVeroeffentlichung: 'To publication',
  nurSuperAdminVor: 'Only someone holding',
  nurSuperAdminNach:
    'may put it on the website — today only the super administration. This session maintains '
    + 'the details; the decision is taken elsewhere.',

  vTitelVeroeffentlichen: 'Publish',
  vTitelZurueckziehen: 'Withdraw',
  vWasSteht: 'What is public',
  vWasWuerde: 'What would become public',
  vAdresse: 'Address',
  vKeinName: '— (no name given)',
  vPlatzhalterBild: ' — placeholder (O-13)',
  vPlatzhalterWarnung:
    'The chosen image is marked as a placeholder. A placeholder image under a customer '
    + 'reference is a statement about a project that did not look like that — real imagery '
    + 'with releases is still missing (O-13).',
  vEntscheidung: 'Decision',
  vGruppeLesend:
    'The group view is read-only (invariant 10). Publishing happens in exactly one '
    + 'Gesellschaft.',
  vKeinSchaltrechtNach:
    'may put it on the website — today only the super administration. So there is no button '
    + 'here: one that gets refused is worse than none.',
  vZurueckziehenVor: 'Once withdrawn,',
  vZurueckziehenNach:
    'answers with 404. Incoming links break, and what a search engine has already read '
    + 'stays in its cache for a while — this platform cannot fetch that back.',
  vVeroeffentlichenVor:
    'The Kundenfreigabe is on file. Once published, this project appears with name, '
    + 'customer and year at',
  vVeroeffentlichenNach: 'and in the Gesellschaft’s project list.',
  vOhneFreigabeTitel: 'Without a Kundenfreigabe this reference does not go out.',
  vFehltZustimmung: 'The consent with date and evidence is missing.',
  vFehltHaken: 'The tick is missing.',
  vEingetragenVor: 'It is recorded in the “Kundenfreigabe” block on the',
  vBearbeitungsseite: 'editing page',
  vEingetragenNach: '— and there it requires',
  vKeinKnopf:
    '. So there is no button here: the policy would refuse it, and a button that silently '
    + 'does nothing makes a person look for the mistake in themselves.',

  ausAuftragAnlegen: 'Create a reference from this Auftrag',
  erstNachAbschluss:
    'A reference comes from this Auftrag once it is completed (PRO-05; whether a running '
    + 'Auftrag is enough has been asked: O-914).',
  ausDiesemAuftragAnzahl: (n) => (n === 0
    ? 'No reference has been created from this Auftrag yet.'
    : n === 1
      ? '1 reference has been created from this Auftrag.'
      : `${String(n)} references have been created from this Auftrag.`),

  statusNichtGesetzt: 'Its state on the website did not change.',
  statusFehler: {
    ohne_kundenfreigabe:
      'This reference carries no Kundenfreigabe (any more). Without it the customer’s '
      + 'name must not go on the website — record the consent with date and evidence first.',
    nicht_gefunden: 'This reference does not exist here.',
    nicht_geaendert: 'The state was not set — this session lacks the right to write.',
  },
  statusFehlerSonst: 'The action was refused.',
};

export const WEBSITE_REFERENZ_TEXTE: Readonly<Record<InternSprache, WebsiteReferenzTexte>> = {
  de: DE, en: EN,
};

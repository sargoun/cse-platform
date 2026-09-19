import 'server-only';

/** Feldklasse, Beispieltext und Fehlertexte der Kundenfreigabe — NEBEN `page.tsx`. */

export const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

/**
 * Der Beispieltext als Konstante, nicht als JSX-Attribut.
 *
 * Er enthaelt deutsche Anfuehrungszeichen UND ein schliessendes `"`; in einem
 * doppelt begrenzten Attribut endet die Zeichenkette dort, wo der Satz noch
 * weitergeht — und der Uebersetzer meldet einen Fehler zwei Zeilen tiefer.
 */
export const PLATZHALTER_WORTLAUT =
  'z. B. Mail vom 14.03.: „Sie dürfen das Projekt mit Namen und Foto auf Ihrer '
  + 'Website nennen."';

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  unvollstaendig:
    'Ansprechpartner, Schreiben und Wortlaut sind Pflicht — der CHECK verlangt alle drei.',
  fremder_ansprechpartner:
    'Dieser Ansprechpartner gehört nicht zum Kunden dieses Auftrags.',
  fremdes_dokument:
    'Das gewählte Schreiben gehört nicht zu diesem Kunden — oder es ist Ihnen nicht sichtbar.',
  schon_freigegeben: 'Zu diesem Auftrag liegt die Freigabe bereits vor.',
  nicht_freigegeben: 'Es liegt keine Freigabe vor, die zu widerrufen wäre.',
  schon_widerrufen: 'Diese Freigabe ist schon widerrufen.',
  nicht_gefunden: 'Diesen Auftrag gibt es nicht.',
  kein_recht: 'Ihnen fehlt referenz.kundenfreigabe_erfassen.',
};

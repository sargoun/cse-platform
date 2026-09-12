# -*- coding: utf-8 -*-
"""Erzeugt die Motivtafeln unter `public/platzhalter/` (DESIGN §4.1a, D-376).

**Eine Tafel ist eine ZEICHNUNG und sagt das auch.** Flache Flaechen, keine
Fototiefe, keine Textur, Figuren nur als Silhouette und nie mit Gesicht. Der
Vorgaenger dieses Skripts (`platzhalter-motive.py`) versuchte den Fotolook mit
Korn und Tiefenunschaerfe — genau das las sich als Clipart, weil eine
Zeichnung, die sich fuer ein Foto ausgibt, beides schlecht ist. Eine Zeichnung,
die erkennbar eine ist, behauptet dagegen nichts.

Farben ausschliesslich aus DESIGN §1. Kein Wert entsteht hier.

    python3 scripts/motivtafeln.py
"""
import os

AUS = 'public/platzhalter'
B, H = 2560, 1440

# --- DESIGN §1, woertlich -------------------------------------------------
INK, FLAECHE, FLAECHE2, FLAECHE3 = '#08080A', '#101013', '#17171B', '#1F1F24'
RAND, RAND_STARK = '#26262C', '#34343C'
TEXT, TEXT_LEISE = '#FAFAFA', '#8B8B95'
ROT = '#E30613'
HUE = {
    'reinigung': '#E30613', 'security': '#2F6BFF',
    'bau': '#F59E0B', 'operations': '#8B5CF6',
}

# Der Tafel-Leuchtdichteverlauf aus DESIGN §4.1b — NICHT der Flaechenverlauf
# aus §1.
#
# **Warum es dafuer einen eigenen gibt.** Die erste Fassung nahm den
# §1-Verlauf (`--surface` … `--surface-3`, oben bei #1F1F24) und war in der
# Praxis unsichtbar. Der Pflicht-Overlay aus §4.4 deckt in der Mitte der Tafel
# 55 Prozent und am Fuss 92 Prozent; ein Hintergrund bei Leuchtdichte 31 und
# eine Silhouette bei 11 kamen damit fuenf Stufen voneinander entfernt auf dem
# Schirm an. Die Zeichnung war da. Sehen konnte sie niemand — und eine Seite
# voll davon las sich als Auftritt mit fehlenden Bildern, also genau als das,
# was die leere Tafel verhindern sollte.
#
# Der Grund ist eine Verwechslung, kein Geschmacksstreit: der §1-Verlauf ist
# fuer UI auf dem Seitenhintergrund gedacht, eine Motivtafel steht fuer ein
# FOTO, und der Overlay ist auf fotografischen Umfang gerechnet. Ein Foto
# traegt Mitteltoene um 90 bis 140; der §1-Verlauf verlaesst die 30er nie.
#
# Je naeher, desto dunkler bleibt: das ist die ganze Raumwirkung, und sie
# kommt ohne einen einzigen Verlauf auf einer Silhouette aus.
HIMMEL, FERN, MITTE, NAH, GRUND = '#33333C', '#4A4A56', '#2C2C34', '#14141A', '#0C0C10'


def kopf(motiv, hue, alt):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {B} {H}" width="{B}" height="{H}"
     role="img" aria-label="{alt}">
  <!--
    Motivtafel, kein Bild (DESIGN §4.1a, D-376). Sie ist erkennbar eine
    Zeichnung: flache Flaechen, keine Fototiefe, Figuren als Silhouette ohne
    Gesicht (§4.2). Sie haelt den Platz sichtbar frei und behauptet nichts.
    Liegt eine Datei unter public/bilder/{motiv}.*, gewinnt die. O-13.
    Erzeugt von scripts/motivtafeln.py — nicht von Hand aendern.
  -->
  <defs>
    <!-- Der Tafel-Verlauf aus DESIGN §4.1b, nicht der UI-Flaechenverlauf aus
         §1. Warum das zwei verschiedene sind, steht oben bei HIMMEL. -->
    <linearGradient id="grund" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{HIMMEL}"/>
      <stop offset="0.55" stop-color="{MITTE}"/>
      <stop offset="1" stop-color="{GRUND}"/>
    </linearGradient>
    <radialGradient id="schein" cx="0.5" cy="0.22" r="0.78">
      <stop offset="0" stop-color="{hue}" stop-opacity="0.16"/>
      <stop offset="0.55" stop-color="{hue}" stop-opacity="0.05"/>
      <stop offset="1" stop-color="{hue}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
      <!-- derselbe Verlauf wie der Bild-Overlay-Token in DESIGN §4.4, hier
           ausgeschrieben: eine SVG-Datei sieht die CSS-Variablen des
           Dokuments nicht.

           Der Tokenname steht hier BEWUSST ohne seine beiden fuehrenden
           Bindestriche: ein XML-Kommentar darf keinen doppelten Bindestrich
           enthalten, und eine SVG ist XML. Mit ihnen war jede der acht
           Tafeln nicht wohlgeformt; der Browser lud sie mit 200 und
           zeichnete ein kaputtes Bild. Die Datei sah im Editor richtig aus
           und war es nie. -->
      <stop offset="0" stop-color="{INK}" stop-opacity="0.15"/>
      <stop offset="0.55" stop-color="{INK}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="{INK}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>

  <rect width="{B}" height="{H}" fill="url(#grund)"/>
  <rect width="{B}" height="{H}" fill="url(#schein)"/>
'''


def fuss(hue, marke, zeile):
    return f'''  <rect width="{B}" height="{H}" fill="url(#overlay)"/>

  <!-- Die Akzentlinie: sechs Pixel, die Gesellschaft, sonst nichts. -->
  <rect x="128" y="1204" width="112" height="6" fill="{hue}"/>
  <text x="128" y="1280" fill="{TEXT}"
        font-family="Inter, system-ui, sans-serif" font-size="46" font-weight="600"
        letter-spacing="4">{marke}</text>
  <text x="128" y="1336" fill="{TEXT_LEISE}"
        font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="400">{zeile}</text>
  <text x="2432" y="1336" fill="{TEXT_LEISE}" text-anchor="end"
        font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="26"
        letter-spacing="3">PLATZHALTER · O-13</text>
</svg>
'''


def figur(x, boden, hoehe, farbe, helm=None, blick=1):
    """Eine Silhouette. Kein Gesicht, keine Hautfarbe, keine Kleidung —
    eine Figur, die ARBEIT zeigt und keinen Menschen behauptet (§4.2)."""
    e = hoehe / 100.0
    kopf_r = 7.2 * e
    kopf_y = boden - 88 * e
    t = []
    t.append(f'<circle cx="{x:.0f}" cy="{kopf_y:.0f}" r="{kopf_r:.1f}" fill="{farbe}"/>')
    # Rumpf als Trapez, Beine als zwei Balken — bewusst grob.
    t.append(
        f'<path d="M {x - 13 * e:.0f} {boden - 78 * e:.0f} '
        f'L {x + 13 * e:.0f} {boden - 78 * e:.0f} '
        f'L {x + 16 * e:.0f} {boden - 40 * e:.0f} '
        f'L {x - 16 * e:.0f} {boden - 40 * e:.0f} Z" fill="{farbe}"/>')
    t.append(f'<rect x="{x - 15 * e:.0f}" y="{boden - 42 * e:.0f}" '
             f'width="{11 * e:.0f}" height="{42 * e:.0f}" fill="{farbe}"/>')
    t.append(f'<rect x="{x + 4 * e:.0f}" y="{boden - 42 * e:.0f}" '
             f'width="{11 * e:.0f}" height="{42 * e:.0f}" fill="{farbe}"/>')
    # Ein Arm, in Blickrichtung — er macht aus einer Figur eine Taetigkeit.
    t.append(f'<rect x="{x + blick * 12 * e:.0f}" y="{boden - 76 * e:.0f}" '
             f'width="{9 * e:.0f}" height="{34 * e:.0f}" fill="{farbe}" '
             f'transform="rotate({blick * 18} {x:.0f} {boden - 70 * e:.0f})"/>')
    if helm:
        t.append(f'<path d="M {x - 10 * e:.0f} {kopf_y - 2 * e:.0f} '
                 f'a {10 * e:.1f} {10 * e:.1f} 0 0 1 {20 * e:.0f} 0 Z" fill="{helm}"/>')
    return '\n    '.join(t)


# Die Buehne. Ohne sie versinkt jedes Motiv im Pflicht-Overlay aus DESIGN §4.4
# (unten 0.92 deckend) — der erste Entwurf stellte die Figuren genau dorthin,
# und sie waren schwarz auf schwarz. Ein heller Streifen auf Kopfhoehe loest
# das, ohne dass eine einzige Silhouette einen Verlauf braucht: die Figur ist
# dunkler als der Streifen, und mehr Raumwirkung braucht eine Zeichnung nicht.
BODEN = 1010

# **Der Mittelstreifen — und warum jedes Motiv darin stehen muss.**
#
# Die Seite legt diese Tafeln mit `object-cover` in einen Rahmen: 21:9 am
# Schreibtisch, **4:5 am Telefon** (DESIGN §4.5). 4:5 auf 2560 Breite heisst,
# dass die volle Hoehe bleibt und waagerecht auf 1152 px beschnitten wird —
# sichtbar ist dann nur x 704 bis 1856. Der erste Entwurf stellte die
# Bauarbeiter auf x 470 und 660 und den Kran auf 1940: am Telefon, wo die
# meisten Menschen diese Seite sehen, war von der Baustelle ein Stueck
# Geruest zu sehen und sonst nichts.
#
# Alles, was das Motiv AUSMACHT, liegt darum zwischen diesen beiden Marken.
# Was ausserhalb steht, darf fehlen, ohne dass das Bild seine Aussage
# verliert — Kulisse, kein Motiv.
MITTE_LINKS, MITTE_RECHTS = 704, 1856


def buehne(hue, hoch=520):
    """Der helle Streifen — als VERLAUF, nicht als Kante.

    Der erste Versuch legte hier ein volldeckendes Rechteck hin. Das ergab
    quer durch den Himmel eine sichtbare Naht, und eine Naht liest sich als
    Fehler in der Datei und nicht als Licht. Der Verlauf faengt bei null an
    und endet am Boden — dieselbe Helligkeit auf Kopfhoehe, ohne den Schnitt.
    """
    kennung = f'buehne{hoch}'
    return f'''  <defs>
    <linearGradient id="{kennung}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hue}" stop-opacity="0"/>
      <stop offset="0.62" stop-color="{hue}" stop-opacity="0.085"/>
      <stop offset="1" stop-color="{hue}" stop-opacity="0.13"/>
    </linearGradient>
  </defs>
  <rect x="0" y="{hoch}" width="{B}" height="{BODEN - hoch}" fill="url(#{kennung})"/>
  <rect x="0" y="{BODEN - 3}" width="{B}" height="3" fill="{hue}" opacity="0.55"/>
  <rect x="0" y="{BODEN}" width="{B}" height="{H - BODEN}" fill="{GRUND}"/>
'''


# ---------------------------------------------------------------- Hochbau
def bau():
    hue = HUE['bau']
    t = [kopf('bau', hue, 'Motivtafel — hier steht spaeter eine Aufnahme von der Baustelle.')]
    a = t.append
    a('  <!-- Ferne: der Bestand, zwischen dem gebaut wird. -->')
    a(f'  <g fill="{FERN}">')
    for x, w, y in [(0, 340, 640), (340, 300, 720), (2060, 280, 660), (2340, 220, 730)]:
        a(f'    <rect x="{x}" y="{y}" width="{w}" height="{BODEN - y}"/>')
    a('  </g>')
    a(buehne(hue, 430))
    a('  <!-- Mitte: Rohbau im Geruest. Das Geruest IST das Motiv. -->')
    a(f'  <rect x="700" y="300" width="760" height="710" fill="{MITTE}"/>')
    a(f'  <g stroke="{RAND_STARK}" stroke-width="7" fill="none">')
    for y in range(360, BODEN + 1, 118):
        a(f'    <line x1="682" y1="{y}" x2="1478" y2="{y}"/>')
    for x in range(700, 1461, 108):
        a(f'    <line x1="{x}" y1="300" x2="{x}" y2="{BODEN}"/>')
    a('  </g>')
    a(f'  <g stroke="{RAND}" stroke-width="4" opacity="0.8">')
    for y in range(478, BODEN + 1, 236):
        a(f'    <line x1="700" y1="{y}" x2="808" y2="{y - 118}"/>')
        a(f'    <line x1="1352" y1="{y}" x2="1460" y2="{y - 118}"/>')
    a('  </g>')
    a(f'  <rect x="682" y="294" width="796" height="8" fill="{hue}" opacity="0.9"/>')
    a(f'  <g fill="{MITTE}" opacity="0.7">')
    for i, y in enumerate(range(370, 950, 118)):
        a(f'    <rect x="{730 + (i % 2) * 220}" y="{y}" width="320" height="94"/>')
    a('  </g>')

    a('  <!-- Der Kran: das eine Element, an dem jeder eine Baustelle erkennt. -->')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="1700" y="210" width="30" height="{BODEN - 210}"/>')
    a('    <rect x="1280" y="196" width="880" height="24"/>')
    a('    <rect x="1678" y="130" width="74" height="72"/>')
    a('  </g>')
    a(f'  <g stroke="{NAH}" stroke-width="9" fill="none">')
    a('    <path d="M 1715 130 L 1330 204"/>')
    a('    <path d="M 1715 130 L 2130 204"/>')
    a('  </g>')
    a(f'  <line x1="1470" y1="220" x2="1470" y2="690" stroke="{NAH}" stroke-width="5"/>')
    a(f'  <rect x="1424" y="690" width="92" height="70" fill="{NAH}"/>')

    a('  <!-- Vorn: Paletten und zwei Silhouetten bei der Arbeit. -->')
    a(f'  <g fill="{NAH}">')
    for i in range(4):
        a(f'    <rect x="{1520 + i * 8}" y="{BODEN - 34 - i * 34}" width="280" height="30"/>')
    a('  </g>')
    a(f'  <g fill="{NAH}">')
    # Die beiden Figuren stehen VOR dem Geruest und im Mittelstreifen: sie
    # sind das Motiv, nicht die Kulisse.
    a('    ' + figur(900, BODEN, 350, NAH, helm=hue, blick=1))
    a('    ' + figur(1120, BODEN, 322, NAH, helm=hue, blick=-1))
    a('  </g>')
    a(f'  <rect x="1132" y="{BODEN - 330}" width="9" height="330" fill="{NAH}"/>')
    a(fuss(hue, 'REALTIME SERVICE', 'Hier steht spaeter eine Aufnahme von der Baustelle.'))
    return '\n'.join(t)


# -------------------------------------------------------------- Reinigung
def reinigung():
    hue = HUE['reinigung']
    t = [kopf('reinigung', hue,
              'Motivtafel — hier steht spaeter eine Aufnahme aus der Unterhaltsreinigung.')]
    a = t.append
    a('  <!-- Ein Flur in der Flucht. Fluchtpunkt hoch genug, dass der Boden -->')
    a('  <!-- traegt und die Figur nicht im Overlay verschwindet. -->')
    a(f'  <rect x="0" y="0" width="{B}" height="{H}" fill="{FLAECHE2}" opacity="0.0"/>')
    a(f'  <path d="M 0 0 L 0 {H} L 900 980 L 900 440 Z" fill="{FERN}"/>')
    a(f'  <path d="M {B} 0 L {B} {H} L 1660 980 L 1660 440 Z" fill="{FERN}"/>')
    a(f'  <rect x="900" y="440" width="760" height="540" fill="{MITTE}"/>')
    a(f'  <rect x="900" y="432" width="760" height="10" fill="{hue}" opacity="0.85"/>')
    a(f'  <rect x="1020" y="520" width="520" height="300" fill="{hue}" opacity="0.13"/>')
    a('  <!-- Fensterband links: das Licht, das einen Flur ausmacht. -->')
    a(f'  <g fill="{hue}" opacity="0.11">')
    for i in range(5):
        x0, x1 = 40 + i * 176, 40 + i * 176 + 120
        yo0, yo1 = 200 + i * 50, 200 + (i + 1) * 50
        yu0, yu1 = 1180 - i * 44, 1180 - (i + 1) * 44
        a(f'    <path d="M {x0} {yo0} L {x1} {yo1} L {x1} {yu1} L {x0} {yu0} Z"/>')
    a('  </g>')
    a('  <!-- Boden: Fugenraster in der Flucht plus flache Spiegelbaender. -->')
    a(f'  <path d="M 0 {H} L 900 980 L 1660 980 L {B} {H} Z" fill="{NAH}"/>')
    a(f'  <g stroke="{RAND}" stroke-width="3" opacity="0.45">')
    for i in range(11):
        a(f'    <line x1="{i * 256}" y1="{H}" x2="{900 + i * 76}" y2="982"/>')
    for k, y in enumerate([990, 1004, 1026, 1060, 1110, 1186, 1300]):
        a(f'    <line x1="0" y1="{y}" x2="{B}" y2="{y}"/>')
    a('  </g>')
    a(f'  <g fill="{hue}" opacity="0.10">')
    for i in range(6):
        y = 1000 + i * 74
        w = 160 + i * 230
        a(f'    <rect x="{1280 - w // 2}" y="{y}" width="{w}" height="{8 + i * 2}" rx="5"/>')
    a('  </g>')
    a('  <!-- Vorn: eine Figur mit Reinigungswagen, gross genug zum Erkennen. -->')
    a(f'  <g fill="{NAH}">')
    a('    <rect x="1420" y="700" width="250" height="22" rx="9"/>')
    a('    <rect x="1426" y="720" width="16" height="250"/>')
    a('    <rect x="1648" y="720" width="16" height="250"/>')
    a('    <rect x="1420" y="856" width="250" height="18" rx="7"/>')
    a('    <rect x="1462" y="874" width="76" height="98" rx="8"/>')
    a('    <rect x="1576" y="876" width="60" height="96" rx="6"/>')
    a('    <circle cx="1442" cy="994" r="24"/>')
    a('    <circle cx="1648" cy="994" r="24"/>')
    a('    <rect x="1582" y="520" width="13" height="184"/>')
    a('    ' + figur(1180, 1010, 380, NAH, blick=1))
    a('  </g>')
    a(fuss(hue, 'CSE DIENSTLEISTUNG',
           'Hier steht spaeter eine Aufnahme aus der Unterhaltsreinigung.'))
    return '\n'.join(t)


# ---------------------------------------------------------------- Security
def security():
    hue = HUE['security']
    t = [kopf('security', hue,
              'Motivtafel — hier steht spaeter eine Aufnahme aus dem Objektschutz.')]
    a = t.append
    a('  <!-- Nacht am Werkstor: Halle, Mastleuchte, Zaun, Schranke. -->')
    a(f'  <g fill="{FERN}">')
    a(f'    <rect x="200" y="520" width="880" height="{BODEN - 520}"/>')
    a('    <path d="M 200 520 L 640 386 L 1080 520 Z"/>')
    a(f'    <rect x="1560" y="600" width="800" height="{BODEN - 600}"/>')
    a('  </g>')
    a(buehne(hue, 470))
    a(f'  <g fill="{hue}" opacity="0.16">')
    for c in range(280, 1000, 118):
        a(f'    <rect x="{c}" y="640" width="66" height="118"/>')
    a('  </g>')
    a('  <!-- Der Lichtkegel: zwei flache Stufen, kein Verlauf. -->')
    a(f'  <path d="M 1290 250 L 900 {BODEN} L 1680 {BODEN} Z" fill="{hue}" opacity="0.13"/>')
    a(f'  <path d="M 1290 250 L 1076 {BODEN} L 1504 {BODEN} Z" fill="{hue}" opacity="0.10"/>')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="1278" y="250" width="24" height="{BODEN - 250}"/>')
    a('    <rect x="1238" y="226" width="104" height="28" rx="11"/>')
    a('  </g>')
    a('  <!-- Zaun: das Motiv, das den Bereich benennt. -->')
    a(f'  <g stroke="{NAH}" stroke-width="5" opacity="0.95">')
    for x in range(0, B + 1, 52):
        a(f'    <line x1="{x}" y1="{BODEN}" x2="{x + 38}" y2="740"/>')
        a(f'    <line x1="{x}" y1="740" x2="{x + 38}" y2="{BODEN}"/>')
    a('  </g>')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="0" y="722" width="{B}" height="16"/>')
    a(f'    <rect x="0" y="{BODEN - 6}" width="{B}" height="20"/>')
    for x in range(0, B + 1, 416):
        a(f'    <rect x="{x}" y="712" width="16" height="{BODEN - 712}"/>')
    a('  </g>')
    a('  <!-- Die Schranke, halb offen: eine Kontrolle, die stattfindet. -->')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="1620" y="850" width="36" height="{BODEN - 850}"/>')
    a('    <rect x="1594" y="806" width="88" height="48" rx="10"/>')
    a('  </g>')
    a('  <g transform="rotate(-42 1638 818)">')
    a(f'    <rect x="1638" y="806" width="470" height="22" rx="9" fill="{NAH}"/>')
    for i in range(5):
        a(f'    <rect x="{1656 + i * 90}" y="806" width="46" height="22" fill="{hue}" '
          f'opacity="0.75"/>')
    a('  </g>')
    a(f'  <g fill="{NAH}">')
    a('    ' + figur(950, BODEN, 350, NAH, blick=1))
    a('  </g>')
    a(fuss(hue, 'SSE SECURITY', 'Hier steht spaeter eine Aufnahme aus dem Objektschutz.'))
    return '\n'.join(t)


# -------------------------------------------------------------- Operations
def operations():
    hue = HUE['operations']
    t = [kopf('operations', hue,
              'Motivtafel — hier steht spaeter eine Aufnahme aus dem Betrieb.')]
    a = t.append
    a(buehne(hue, 560))
    a('  <!-- Die Leitstelle: drei Wandtafeln, Tisch, eine Person davor. -->')
    a(f'  <g fill="{MITTE}" stroke="{RAND_STARK}" stroke-width="4">')
    for x, y, w, h in [(230, 250, 560, 380), (860, 200, 700, 430), (1630, 270, 620, 360)]:
        a(f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14"/>')
    a('  </g>')
    a('  <!-- Was auf den Tafeln steht: Balken und eine Linie. Keine Zahl, die -->')
    a('  <!-- jemand fuer eine Auskunft halten koennte (Inv. 6). -->')
    a(f'  <g fill="{hue}" opacity="0.65">')
    for i, hbar in enumerate([120, 200, 90, 262, 160, 224, 132]):
        a(f'    <rect x="{286 + i * 70}" y="{578 - hbar}" width="42" height="{hbar}" rx="6"/>')
    a('  </g>')
    a(f'  <polyline points="910,548 1030,462 1150,506 1270,372 1390,428 1510,306" '
      f'fill="none" stroke="{hue}" stroke-width="9" opacity="0.85" '
      f'stroke-linecap="round" stroke-linejoin="round"/>')
    a(f'  <g fill="{hue}" opacity="0.25">')
    for k, r in enumerate(range(330, 580, 52)):
        a(f'    <rect x="1686" y="{r}" width="{450 if k % 2 == 0 else 320}" height="20" rx="10"/>')
    a('  </g>')
    a(f'  <rect x="860" y="192" width="700" height="10" fill="{hue}" opacity="0.9"/>')
    a('  <!-- Tisch und Figur, beide VOR den Tafeln. -->')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="780" y="884" width="820" height="{BODEN - 884}" rx="10"/>')
    a('    <rect x="940" y="820" width="240" height="64" rx="10"/>')
    a('    <rect x="1034" y="792" width="52" height="30"/>')
    # Die Figur steht NEBEN dem Tisch auf dem Boden — auf der Tischkante
    # stehend sah sie aus, als schwebe sie.
    a('    ' + figur(1560, BODEN, 320, NAH, blick=-1))
    a('  </g>')
    a(fuss(hue, 'CSE OPERATIONS', 'Hier steht spaeter eine Aufnahme aus dem Betrieb.'))
    return '\n'.join(t)


# ------------------------------------------------------------------ Gruppe
def gruppe():
    """Die Startseite: Berliner Silhouette, darunter die vier Kennfarben.

    Die vier Baender sind die einzige Stelle, an der alle vier Farben
    nebeneinander stehen duerfen — hier IST das die Aussage (DESIGN §1
    Bereichsidentitaet: die Farbe identifiziert, sie schmueckt nicht)."""
    t = [kopf('gruppe', ROT, 'Motivtafel — hier steht spaeter eine Aufnahme der Gruppe.')]
    a = t.append
    a(buehne(ROT, 300))
    a('  <!-- Keine echte Skyline: Haeuser, ein Turm, kein Wahrzeichen, das -->')
    a('  <!-- jemand fuer ein Objekt der Gruppe halten koennte. -->')
    haeuser = [(0, 700), (170, 600), (330, 780), (470, 660), (640, 520), (790, 740),
               (960, 620), (1130, 560), (1300, 700), (1450, 480), (1620, 650),
               (1790, 740), (1930, 580), (2100, 690), (2270, 540), (2430, 660)]
    a(f'  <g fill="{MITTE}">')
    for x, y in haeuser:
        w = 150 if x % 2 == 0 else 132
        a(f'    <rect x="{x}" y="{y}" width="{w}" height="{BODEN - y}"/>')
    a('  </g>')
    a(f'  <g fill="{ROT}" opacity="0.13">')
    for x, y in haeuser:
        for r in range(y + 40, BODEN - 30, 62):
            for c in range(x + 24, x + 118, 50):
                a(f'    <rect x="{c}" y="{r}" width="22" height="28"/>')
    a('  </g>')
    a(f'  <g fill="{NAH}">')
    a(f'    <rect x="1196" y="330" width="28" height="{BODEN - 330}"/>')
    a('    <circle cx="1210" cy="366" r="56"/>')
    a('    <path d="M 1210 196 L 1221 320 L 1199 320 Z"/>')
    a('  </g>')
    a('  <!-- Die vier Gesellschaften als vier Baender, in der Reihenfolge von -->')
    a('  <!-- CLAUDE.md. Sie stehen UEBER der Textzeile, nicht darin. -->')
    a('  <g>')
    for i, (_, farbe) in enumerate(HUE.items()):
        a(f'    <rect x="{790 + i * 260}" y="1078" width="180" height="10" fill="{farbe}"/>')
    a('  </g>')
    a(fuss(ROT, 'CSE GRUPPE', 'Hier steht spaeter eine Aufnahme der Gruppe.'))
    return '\n'.join(t)


# -------------------------------------------------------------------- Team
def team():
    t = [kopf('team', ROT, 'Motivtafel — hier steht spaeter eine Aufnahme des Teams.')]
    a = t.append
    a(buehne(ROT, 400))
    a('  <!-- Eine Wand aus Lamellen, damit die Reihe VOR etwas steht — und -->')
    a('  <!-- zwar vor etwas Hellerem: sonst ist eine dunkle Silhouette auf -->')
    a('  <!-- dunklem Grund keine Silhouette, sondern ein Fleck. -->')
    a(f'  <g fill="{FLAECHE3}">')
    for i in range(15):
        a(f'    <rect x="{60 + i * 176}" y="330" width="112" height="{BODEN - 330}" rx="6"/>')
    a('  </g>')
    a(f'  <g fill="{ROT}" opacity="0.07">')
    for i in range(15):
        a(f'    <rect x="{60 + i * 176}" y="330" width="112" height="{BODEN - 330}" rx="6"/>')
    a('  </g>')
    a('  <!-- Sieben Silhouetten, unterschiedlich gross. Kein Gesicht (§4.2): -->')
    a('  <!-- die Reihe zeigt eine Belegschaft, sie behauptet keine Person. -->')
    a(f'  <g fill="{INK}">')
    for i, (x, hoehe) in enumerate([(790, 350), (960, 384), (1130, 362), (1300, 400),
                                    (1470, 368), (1640, 390), (1810, 356)]):
        a('    ' + figur(x, BODEN, hoehe, INK, blick=1 if i % 2 else -1))
    a('  </g>')
    a(fuss(ROT, 'CSE GRUPPE', 'Hier steht spaeter eine Aufnahme des Teams.'))
    return '\n'.join(t)


# ------------------------------------------------------- Objekt und Projekt
def flaeche(motiv, marke, zeile, hue):
    """Klein heisst leer (D-376): eine Zeichnung auf 180 px ist ein Fleck.

    Bleibt also die reservierte FLAECHE — Verlauf, Akzentlinie, flaches
    Perspektivraster, Zeile. Wie bisher, und bewusst."""
    t = [kopf(motiv, hue, f'Platzhalter — {zeile[0].lower()}{zeile[1:]}')]
    a = t.append
    a(f'  <g stroke="{RAND}" stroke-width="1.5" opacity="0.5" fill="none">')
    for i in range(-4, 15):
        a(f'    <line x1="{i * 284 - 1280}" y1="{H}" x2="1280" y2="893"/>')
    for y in [898, 916, 947, 992, 1052, 1126, 1216, 1320]:
        a(f'    <line x1="0" y1="{y}" x2="{B}" y2="{y}"/>')
    a('  </g>')
    a(fuss(hue, marke, zeile))
    return '\n'.join(t)


TAFELN = {
    'bau': bau, 'reinigung': reinigung, 'security': security,
    'operations': operations, 'hero': gruppe, 'team': team,
    'objekt': lambda: flaeche('objekt', 'CSE GRUPPE',
                              'Hier steht spaeter eine Aufnahme des Objekts.', ROT),
    'projekt': lambda: flaeche('projekt', 'REALTIME SERVICE',
                               'Hier steht spaeter eine Aufnahme des Projekts.', HUE['bau']),
}

if __name__ == '__main__':
    os.makedirs(AUS, exist_ok=True)
    for name, bauen in TAFELN.items():
        pfad = os.path.join(AUS, f'{name}.svg')
        with open(pfad, 'w', encoding='utf-8') as f:
            f.write(bauen())
        print(f'{pfad}  {os.path.getsize(pfad)} B')

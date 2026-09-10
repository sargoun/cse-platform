# -*- coding: utf-8 -*-
"""Erzeugt die acht Platzhalter-Szenen als SVG.

Fotolook mit Bordmitteln: Tiefenunschaerfe fuer die Ferne, Filmkorn ueber
allem, warmes Streiflicht gegen kalte Schatten, weiche Kontaktschatten.
Menschen bleiben gezeichnet und gesichtslos — DESIGN §4.2.
"""
import math, os

OUT = 'public/platzhalter'
W, H = 1600, 900
HAUT = ['#C79A6B', '#8D6242', '#E0B486', '#A87A52']


def rnd(seed):
    s = seed
    while True:
        s = (s * 1103515245 + 12345) % 2147483648
        yield s / 2147483648


def filter_defs():
    """Korn, drei Unschaerfegrade, weiches Licht."""
    return '''
 <filter id="korn" x="0" y="0" width="100%" height="100%">
   <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" result="n"/>
   <feColorMatrix in="n" type="saturate" values="0" result="g"/>
   <feComponentTransfer in="g" result="k">
     <feFuncA type="linear" slope="0.13" intercept="0"/>
   </feComponentTransfer>
   <feComposite in="k" in2="SourceGraphic" operator="in"/>
 </filter>
 <filter id="fern" x="-10%" y="-10%" width="120%" height="120%">
   <feGaussianBlur stdDeviation="7"/></filter>
 <filter id="mittel" x="-10%" y="-10%" width="120%" height="120%">
   <feGaussianBlur stdDeviation="2.6"/></filter>
 <filter id="nah" x="-10%" y="-10%" width="120%" height="120%">
   <feGaussianBlur stdDeviation="0.7"/></filter>
 <filter id="glanz" x="-60%" y="-60%" width="220%" height="220%">
   <feGaussianBlur stdDeviation="26"/></filter>
 <filter id="weich" x="-40%" y="-40%" width="180%" height="180%">
   <feGaussianBlur stdDeviation="9"/></filter>'''


def kopf(titel, himmel, licht, lx=0.74, ly=0.16, lr=0.75):
    stops = ''.join(
        f'<stop offset="{o}" stop-color="{c}"/>' for o, c in himmel)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{titel}">
<defs>
 <linearGradient id="hi" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient>
 <radialGradient id="key" cx="{lx}" cy="{ly}" r="{lr}">
   <stop offset="0" stop-color="{licht}" stop-opacity="0.55"/>
   <stop offset="0.34" stop-color="{licht}" stop-opacity="0.17"/>
   <stop offset="1" stop-color="{licht}" stop-opacity="0"/></radialGradient>
 <radialGradient id="scheibe" cx="0.5" cy="0.5" r="0.5">
   <stop offset="0" stop-color="#FFFCF2" stop-opacity="1"/>
   <stop offset="0.55" stop-color="#FFF3D8" stop-opacity="0.92"/>
   <stop offset="0.82" stop-color="#FFE3A8" stop-opacity="0.45"/>
   <stop offset="1" stop-color="#FFD79A" stop-opacity="0"/></radialGradient>
 <linearGradient id="tuer" x1="0" y1="0" x2="1" y2="0">
   <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>
   <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0.12"/>
   <stop offset="1" stop-color="#07080B" stop-opacity="0.16"/></linearGradient>
 <linearGradient id="wand" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.30"/>
   <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.04"/>
   <stop offset="1" stop-color="#07080B" stop-opacity="0.22"/></linearGradient>
 <linearGradient id="dunst" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
   <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.16"/></linearGradient>
 <linearGradient id="vig" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="#07080B" stop-opacity="0.20"/>
   <stop offset="0.38" stop-color="#07080B" stop-opacity="0"/>
   <stop offset="0.78" stop-color="#07080B" stop-opacity="0.06"/>
   <stop offset="1" stop-color="#07080B" stop-opacity="0.26"/></linearGradient>
 <radialGradient id="rand" cx="0.5" cy="0.5" r="0.82">
   <stop offset="0.6" stop-color="#07080B" stop-opacity="0"/>
   <stop offset="1" stop-color="#07080B" stop-opacity="0.30"/></radialGradient>
{filter_defs()}
</defs>
<rect width="{W}" height="{H}" fill="url(#hi)"/>
<rect width="{W}" height="{H}" fill="url(#key)"/>'''


def fuss():
    return (f'<rect width="{W}" height="{H}" fill="url(#vig)"/>'
            f'<rect width="{W}" height="{H}" fill="url(#rand)"/>'
            f'<rect width="{W}" height="{H}" fill="#8A8A8A" filter="url(#korn)" '
            f'opacity="0.5" style="mix-blend-mode:overlay"/></svg>\n')


def schatten(cx, cy, rx, ry, o=0.5):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#07080B" opacity="{o}" filter="url(#weich)"/>'


# --------------------------------------------------------------------------
# Figuren
# --------------------------------------------------------------------------

def bauarbeiter(x, y, s=1.0, weste='#F5A524', helm='#F2C14E', haut=0, arm='hoch',
                blick=1):
    """Warnweste, Helm, Reflexstreifen. `blick` = 1 nach rechts, -1 nach links."""
    if arm == 'hoch':
        a = ('<path d="M17 -99 L44 -117 L57 -137" stroke="#39404F" stroke-width="16" '
             'fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
             '<path d="M17 -99 L44 -117" stroke="{w}" stroke-width="16" fill="none" '
             'stroke-linecap="round" opacity="0.9"/>'
             '<circle cx="59" cy="-140" r="8" fill="{h}"/>').format(w=weste, h=HAUT[haut])
    else:
        a = ('<path d="M17 -97 L37 -74 L43 -48" stroke="#39404F" stroke-width="16" '
             'fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
             '<path d="M17 -97 L34 -78" stroke="{w}" stroke-width="16" fill="none" '
             'stroke-linecap="round" opacity="0.9"/>'
             '<circle cx="44" cy="-44" r="8" fill="{h}"/>').format(w=weste, h=HAUT[haut])
    return f'''<g transform="translate({x},{y}) scale({s * blick},{s})">
 {schatten(2, 4, 36, 8, 0.55)}
 <path d="M-14 2 l3 -64 h22 l3 64 h-12 l-3 -46 -2 46 Z" fill="#232936"/>
 <path d="M-16 2 h15 l1 8 h-18 Z" fill="#15181F"/>
 <path d="M6 2 h15 l1 8 h-18 Z" fill="#15181F"/>
 <path d="M-23 -106 q23 -10 46 0 l-2 48 q-21 -13 -42 0 Z" fill="#39404F"/>
 <path d="M-21 -60 q21 -14 42 0 l3 -46 q-24 -12 -48 0 Z" fill="{weste}"/>
 <path d="M-22 -86 q22 -10 44 0 l1 -9 q-23 -10 -46 0 Z" fill="#EDF4FF" opacity="0.82"/>
 <path d="M-20 -71 q20 -9 40 0 l1 -8 q-21 -9 -42 0 Z" fill="#EDF4FF" opacity="0.58"/>
 <path d="M-23 -104 q10 -6 23 -6 l0 52 q-12 0 -22 5 Z" fill="#FFFFFF" opacity="0.06"/>
 {a}
 <path d="M-19 -99 L-31 -74 L-30 -50" stroke="#2F3542" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="-30" cy="-46" r="7" fill="{HAUT[haut]}"/>
 <path d="M-9 -112 h18 l-1 10 h-16 Z" fill="{HAUT[haut]}"/>
 <circle cx="0" cy="-125" r="15" fill="{HAUT[haut]}"/>
 <path d="M-18 -131 a18 16 0 0 1 36 0 z" fill="{helm}"/>
 <path d="M-18 -131 a18 16 0 0 1 18 -16 l0 16 z" fill="#FFFFFF" opacity="0.14"/>
 <rect x="-22" y="-132" width="44" height="5" rx="2.5" fill="{helm}"/>
 <path d="M12 -134 l8 4 -8 4 z" fill="{helm}"/>
</g>'''


def reinigungskraft(x, y, s=1.0, farbe='#B93A46', haut=1):
    """Vorgebeugt am Mopp, beide Haende am Stiel, Wischbezug flach am Boden."""
    return f'''<g transform="translate({x},{y}) scale({s})">
 {schatten(6, 4, 40, 9, 0.28)}
 <path d="M-16 2 l3 -54 h20 l4 54 h-12 l-3 -38 -3 38 Z" fill="#2B3140"/>
 <path d="M-19 2 h16 l1 9 h-20 Z" fill="#171B24"/>
 <path d="M3 2 h16 l1 9 h-20 Z" fill="#171B24"/>
 <path d="M-24 -52 q24 -14 48 0 l4 -40 q-28 -12 -56 0 Z" fill="{farbe}"/>
 <path d="M-24 -52 q12 -8 24 -8 l2 -40 q-14 0 -28 8 Z" fill="#FFFFFF" opacity="0.10"/>
 <path d="M-28 -92 q28 -12 56 0 l-5 13 q-23 -10 -46 0 Z" fill="#8E2F39"/>
 <path d="M-6 -92 l0 22" stroke="#7A2831" stroke-width="2.5"/>
 <path d="M-26 -90 L2 -68 L30 -88" stroke="#39404F" stroke-width="15" fill="none"
   stroke-linecap="round" stroke-linejoin="round" opacity="0"/>
 <path d="M-20 -86 L14 -58 L44 -34" stroke="#39404F" stroke-width="14" fill="none"
   stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M22 -86 L40 -60 L62 -40" stroke="#4A5364" stroke-width="13" fill="none"
   stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M6 -62 L112 24" stroke="#8A93A5" stroke-width="7" stroke-linecap="round"/>
 <path d="M6 -62 L112 24" stroke="#FFFFFF" stroke-width="2" opacity="0.28"/>
 <circle cx="46" cy="-32" r="8" fill="{HAUT[haut]}"/>
 <circle cx="64" cy="-38" r="8" fill="{HAUT[haut]}"/>
 <path d="M-8 -100 h16 l-1 9 h-15 Z" fill="{HAUT[haut]}"/>
 <circle cx="0" cy="-110" r="15" fill="{HAUT[haut]}"/>
 <path d="M-15 -116 a15 13 0 0 1 30 -1 q-8 -8 -16 -6 q-9 2 -14 7 z" fill="#2A2E38"/>
 <path d="M13 -114 q6 3 5 9 l-6 -2 z" fill="#2A2E38"/>
 <g transform="translate(112,24) rotate(38)">
   <rect x="-8" y="-7" width="76" height="15" rx="4" fill="#7E8A9C"/>
   <rect x="-8" y="-7" width="76" height="6" rx="3" fill="#AAB4C2"/>
   <rect x="-4" y="6" width="70" height="10" rx="5" fill="#C6D0DE"/>
 </g>
 <ellipse cx="150" cy="46" rx="86" ry="16" fill="#FFFFFF" opacity="0.22" filter="url(#weich)"/>
</g>'''


def putzwagen(x, y, s=1.0, farbe='#B93A46'):
    return f'''<g transform="translate({x},{y}) scale({s})">
 {schatten(34, 8, 58, 10, 0.45)}
 <rect x="-8" y="-92" width="80" height="92" rx="8" fill="#2C3240"/>
 <rect x="-8" y="-92" width="80" height="18" rx="8" fill="{farbe}"/>
 <rect x="-8" y="-92" width="80" height="6" rx="3" fill="#FFFFFF" opacity="0.12"/>
 <rect x="6" y="-62" width="54" height="38" rx="5" fill="#1B202A"/>
 <rect x="6" y="-62" width="54" height="8" rx="4" fill="#FFFFFF" opacity="0.06"/>
 <circle cx="4" cy="4" r="11" fill="#171C25"/><circle cx="4" cy="4" r="4" fill="#3C4454"/>
 <circle cx="60" cy="4" r="11" fill="#171C25"/><circle cx="60" cy="4" r="4" fill="#3C4454"/>
 <rect x="72" y="-118" width="9" height="118" rx="4.5" fill="#8A93A5"/>
 <rect x="62" y="-124" width="30" height="13" rx="6" fill="#A7B3C6"/>
 <rect x="-2" y="-146" width="26" height="54" rx="4" fill="#E7ECF4" opacity="0.9"/>
 <rect x="-2" y="-146" width="26" height="10" rx="4" fill="#F5A524" opacity="0.8"/>
</g>'''


def wachmann(x, y, s=1.0, akzent='#2F6BFF', haut=0, kegel=True, spiegel=True):
    k = ('<path d="M64 -80 L360 -176 L360 30 L64 -62 Z" fill="#FFF6DC" opacity="0.10" filter="url(#nah)"/>'
         '<circle cx="64" cy="-71" r="9" fill="#FFF9E8"/>'
         '<circle cx="64" cy="-71" r="22" fill="#FFF6DC" opacity="0.4" filter="url(#weich)"/>') if kegel else ''
    r = ('<path d="M-22 -88 q22 -9 44 0 l1 -8 q-23 -9 -46 0 Z" fill="#EDF4FF" opacity="0.55"/>'
         if spiegel else '')
    return f'''<g transform="translate({x},{y}) scale({s})">
 {schatten(2, 4, 34, 8, 0.6)}
 <path d="M-14 2 l3 -62 h21 l3 62 h-12 l-3 -44 -2 44 Z" fill="#161B26"/>
 <path d="M-16 2 h14 l1 8 h-17 Z" fill="#0D1017"/>
 <path d="M5 2 h14 l1 8 h-17 Z" fill="#0D1017"/>
 <path d="M-23 -106 q23 -10 46 0 l-2 50 q-21 -13 -42 0 Z" fill="#232B3B"/>
 <path d="M-21 -60 q21 -14 42 0 l4 -48 q-24 -12 -48 0 Z" fill="#1C2331"/>
 <path d="M-2 -106 l-1 48" stroke="{akzent}" stroke-width="3" opacity="0.8"/>
 <rect x="-20" y="-95" width="13" height="17" rx="2" fill="{akzent}" opacity="0.85"/>
 {r}
 <path d="M-23 -104 q10 -6 22 -6 l-1 52 q-11 0 -21 5 Z" fill="#FFFFFF" opacity="0.05"/>
 <path d="M-9 -113 h18 l-1 10 h-16 Z" fill="{HAUT[haut]}"/>
 <circle cx="0" cy="-126" r="15" fill="{HAUT[haut]}"/>
 <path d="M-17 -131 a17 14 0 0 1 34 0 z" fill="#12161F"/>
 <rect x="-23" y="-132" width="46" height="5" rx="2.5" fill="#12161F"/>
 <path d="M13 -136 l9 4 -9 5 z" fill="#12161F"/>
 <path d="M17 -99 L36 -84 L44 -72" stroke="#232B3B" stroke-width="15" fill="none"
   stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="45" cy="-71" r="8" fill="{HAUT[haut]}"/>
 <rect x="40" y="-79" width="22" height="15" rx="4" fill="#3B4458"/>
 <rect x="40" y="-79" width="22" height="5" rx="2" fill="#FFFFFF" opacity="0.14"/>
 {k}
</g>'''


# --------------------------------------------------------------------------
# Menschen als Silhouetten
# --------------------------------------------------------------------------
#
# Ausgezeichnete Figuren mit Gesicht, Hand und Farbe lesen sich als Clipart —
# je genauer gezeichnet, desto deutlicher. Auf Distanz und gegen das Licht
# sieht ein Mensch anders aus: eine dunkle Form, ein Streifen Reflex, ein
# Saum Licht an der Schulter. Das ist zugleich die Grenze aus DESIGN §4.2 —
# eine Silhouette behauptet kein Gesicht, das es nicht gibt.


def silhouette(x, y, s=1.0, haltung='stehen', reflex='#F5A524', saum='#FFD79A',
               dunkel='#12151C', spiegeln=False, saumseite=1):
    """Ein Mensch auf Distanz: dunkle Form, Reflexstreifen, Lichtsaum."""
    sx = -s if spiegeln else s
    koerper = {
        'stehen': ('M-13 0 l1 -46 h6 l3 30 l3 -30 h6 l1 46 z',
                   'M-15 -46 q15 -8 30 0 l-2 -30 q-13 -6 -26 0 z',
                   'M-15 -76 q15 -7 30 0 l-3 -9 q-12 -5 -24 0 z',
                   'M-15 -76 q-9 6 -11 30 l7 2 q2 -18 6 -24 z'
                   'M15 -76 q9 6 11 30 l-7 2 q-2 -18 -6 -24 z'),
        'gehen': ('M-16 0 l6 -46 h6 l1 30 l8 -28 h6 l-6 44 z',
                  'M-15 -46 q15 -8 30 0 l-2 -30 q-13 -6 -26 0 z',
                  'M-15 -76 q15 -7 30 0 l-3 -9 q-12 -5 -24 0 z',
                  'M-15 -74 q-12 8 -14 30 l7 3 q3 -18 9 -25 z'
                  'M15 -76 q13 5 16 24 l-7 3 q-3 -15 -11 -20 z'),
        'tragen': ('M-14 0 l2 -46 h6 l2 30 l3 -30 h6 l2 46 z',
                   'M-16 -46 q16 -8 32 0 l-3 -30 q-13 -6 -26 0 z',
                   'M-15 -76 q15 -7 30 0 l-3 -9 q-12 -5 -24 0 z',
                   'M-15 -74 q-10 10 -8 30 l7 -1 q-1 -16 4 -22 z'
                   'M15 -74 q10 10 8 30 l-7 -1 q1 -16 -4 -22 z'),
        'zeigen': ('M-13 0 l1 -46 h6 l3 30 l3 -30 h6 l1 46 z',
                   'M-15 -46 q15 -8 30 0 l-2 -30 q-13 -6 -26 0 z',
                   'M-15 -76 q15 -7 30 0 l-3 -9 q-12 -5 -24 0 z',
                   'M13 -74 L36 -88 L52 -96 l3 7 L38 -80 L16 -67 z'
                   'M-15 -74 q-10 8 -11 28 l7 2 q2 -16 8 -22 z'),
        'buecken': ('M-12 0 l0 -40 h6 l2 26 l4 -26 h6 l2 40 z',
                    'M-16 -40 q16 -8 32 -2 l6 -26 q-16 -8 -30 -2 z',
                    'M12 -70 q13 -5 24 3 l-4 8 q-10 -6 -20 -2 z',
                    'M16 -62 L44 -44 L64 -30 l-4 7 L38 -38 L14 -54 z'),
    }[haltung]
    beine, rumpf, kopfteil, arme = koerper
    kopf_y = -84 if haltung != 'buecken' else -74
    kopf_x = 0 if haltung != 'buecken' else 26
    return f'''<g transform="translate({x},{y}) scale({sx},{s})">
 {schatten(2, 3, 26, 6, 0.4)}
 <g fill="{dunkel}">
  <path d="{beine}"/><path d="{rumpf}"/><path d="{arme}"/>
  <circle cx="{kopf_x}" cy="{kopf_y}" r="10"/>
  <path d="{kopfteil}"/>
 </g>
 <path d="M-14 -60 q14 -6 28 0 l1 -7 q-15 -6 -30 0 z" fill="{reflex}" opacity="0.85"/>
 <path d="M-14 -70 q14 -6 28 0 l1 -5 q-15 -5 -30 0 z" fill="#EDF4FF" opacity="0.5"/>
 <g fill="{saum}" opacity="0.55" transform="scale({saumseite},1)">
  <path d="M13 -78 q4 14 3 32 l-4 -1 q1 -17 -2 -30 z"/>
  <circle cx="{kopf_x * saumseite + 7}" cy="{kopf_y - 4}" r="3.5"/>
 </g>
</g>'''


# --------------------------------------------------------------------------
# Bausteine der Kulisse
# --------------------------------------------------------------------------

def skyline(hz, farbe='#39404F', op=0.42, seed=7, von=0, bis=W, hoch=260):
    g = rnd(seed)
    s = f'<g opacity="{op}" filter="url(#fern)">'
    x = von
    while x < bis:
        b = 60 + int(next(g) * 130)
        hh = 70 + int(next(g) * hoch)
        s += f'<rect x="{x}" y="{hz - hh}" width="{b}" height="{hh}" fill="{farbe}"/>'
        if next(g) > 0.6:
            s += f'<rect x="{x + b // 3}" y="{hz - hh - 26}" width="{max(8, b // 4)}" height="26" fill="{farbe}"/>'
        x += b + int(next(g) * 26)
    return s + '</g>'


def fensterraster(x, y, sp, ze, bw, bh, lu, seed, an='#FFD79A', aus='#0D1421',
                  quote=0.34):
    g = rnd(seed)
    s = ''
    for r in range(ze):
        for c in range(sp):
            v = next(g)
            fx = x + c * (bw + lu)
            fy = y + r * (bh + lu)
            if v < quote:
                s += (f'<rect x="{fx}" y="{fy}" width="{bw}" height="{bh}" fill="{an}" '
                      f'opacity="{0.42 + 0.5 * v:.2f}"/>')
            else:
                s += (f'<rect x="{fx}" y="{fy}" width="{bw}" height="{bh}" fill="{aus}" opacity="0.85"/>'
                      f'<rect x="{fx}" y="{fy}" width="{bw}" height="{max(4, bh // 4)}" fill="#8FA6C4" '
                      f'opacity="{0.05 + v * 0.12:.2f}"/>')
    return s


def turmkran(x, y, hoehe, ausleger, farbe='#F5A524'):
    """Mit Gegenausleger, Spannstaeben und Katze — sonst liest es sich als Fehler."""
    k = y - hoehe
    b = 15  # halbe Mastbreite
    s = f'<g stroke="{farbe}" stroke-width="6" fill="none" stroke-linecap="round">'
    s += f'<path d="M{x - b} {y} V{k}"/><path d="M{x + b} {y} V{k}"/>'
    feld = 52
    n = max(1, int((y - k) // feld))
    for i in range(n):
        o = y - i * feld
        u = o - feld
        s += (f'<path d="M{x - b} {o} H{x + b}" stroke-width="3.5" opacity="0.85"/>'
              f'<path d="M{x - b} {o} L{x + b} {u} M{x + b} {o} L{x - b} {u}" '
              f'stroke-width="3" opacity="0.7"/>')
    s += f'<path d="M{x - b} {k} H{x + b}" stroke-width="4"/>'
    # Ausleger und Gegenausleger
    s += f'<path d="M{x} {k + 4} H{x + ausleger}"/>'
    s += f'<path d="M{x} {k + 4} H{x - ausleger // 3}"/>'
    # Turmspitze mit Spannstaeben
    s += f'<path d="M{x} {k + 4} L{x} {k - 46}"/>'
    s += (f'<path d="M{x} {k - 46} L{x + ausleger} {k + 4}" stroke-width="3"/>'
          f'<path d="M{x} {k - 46} L{x + ausleger // 2} {k + 4}" stroke-width="3"/>'
          f'<path d="M{x} {k - 46} L{x - ausleger // 3} {k + 4}" stroke-width="3"/>')
    s += '</g>'
    s += f'<rect x="{x - 26}" y="{k + 8}" width="52" height="34" rx="4" fill="#4C566B"/>'
    s += f'<rect x="{x - 22}" y="{k + 12}" width="30" height="18" rx="2" fill="#9FB4D0" opacity="0.55"/>'
    s += f'<rect x="{x - ausleger // 3 - 22}" y="{k - 4}" width="34" height="26" fill="#556075"/>'
    # Katze mit Last
    kx = x + int(ausleger * 0.62)
    s += f'<rect x="{kx - 12}" y="{k + 2}" width="24" height="12" rx="3" fill="#8A93A5"/>'
    s += f'<path d="M{kx} {k + 14} V{k + 150}" stroke="#8A93A5" stroke-width="3"/>'
    s += (f'<rect x="{kx - 46}" y="{k + 150}" width="92" height="60" rx="4" fill="#6E6154"/>'
          f'<rect x="{kx - 46}" y="{k + 150}" width="92" height="10" rx="4" fill="#8B7C6B"/>')
    return s


def marke(text, farbe):
    """Jede Szene traegt sichtbar, dass sie ein Platzhalter ist (O-13)."""
    return (f'<g opacity="0.92"><rect x="44" y="{H - 92}" width="{22 + len(text) * 11}" height="34" rx="17" '
            f'fill="#07080B" opacity="0.55"/>'
            f'<circle cx="66" cy="{H - 75}" r="6" fill="{farbe}"/>'
            f'<text x="82" y="{H - 69}" font-family="Inter, system-ui, sans-serif" font-size="15" '
            f'fill="#E7ECF4" opacity="0.85">{text}</text></g>')


# ==========================================================================
# 1 — Bau: Rohbau im Abendlicht
# ==========================================================================

def szene_bau():
    hz = 700
    s = kopf('Platzhalter: Rohbau mit Turmdrehkran, Geruest und Bauarbeitern',
             [(0, '#3C4356'), (0.42, '#4A4436'), (0.72, '#2A2A2C'), (1, '#1B1C21')],
             '#FFD79A', 0.72, 0.2, 0.8)
    s += skyline(hz, '#2F3646', 0.45, seed=11, hoch=250)
    s += f'<rect x="0" y="{hz - 330}" width="{W}" height="330" fill="url(#dunst)" opacity="0.55"/>'

    # Rohbau, mittlere Ebene, leicht unscharf
    s += '<g filter="url(#mittel)">'
    s += f'<rect x="742" y="150" width="690" height="{hz - 150}" fill="#3A4150"/>'
    for i, yy in enumerate(range(228, hz, 88)):
        s += f'<rect x="742" y="{yy}" width="690" height="15" fill="#59647A"/>'
        s += f'<rect x="742" y="{yy}" width="690" height="4" fill="#FFFFFF" opacity="0.14"/>'
        s += f'<rect x="742" y="{yy + 15}" width="690" height="8" fill="#07080B" opacity="0.28"/>'
        for j, xx in enumerate(range(766, 1400, 132)):
            if (i * 5 + j) % 3 == 0:
                s += f'<rect x="{xx}" y="{yy + 22}" width="106" height="58" fill="#FFD79A" opacity="0.09"/>'
    for xx in range(742, 1440, 132):
        s += f'<rect x="{xx - 8}" y="150" width="16" height="{hz - 150}" fill="#4A5468"/>'
        s += f'<rect x="{xx - 8}" y="150" width="5" height="{hz - 150}" fill="#FFFFFF" opacity="0.08"/>'
    s += '</g>'

    # Geruest davor, scharf
    s += '<g stroke="#8D97A9" stroke-width="4.5" fill="none" opacity="0.92">'
    for xx in range(730, 1452, 68):
        s += f'<path d="M{xx} 132 V{hz}"/>'
    for yy in range(132, hz, 60):
        s += f'<path d="M730 {yy} H1448"/>'
    s += '</g>'
    s += '<g fill="#C9A227" opacity="0.5">'
    for xx in range(730, 1440, 68):
        s += f'<rect x="{xx}" y="{132 + ((xx // 68) % 4) * 60}" width="68" height="9"/>'
    s += '</g>'
    s += (f'<path d="M1160 132 L1448 132 L1448 {hz} L1160 {hz} Z" fill="#B9C2D0" opacity="0.10"/>')

    s += turmkran(292, hz, 620, 430)

    # Boden
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#4E4336"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="7" fill="#6B5A45"/>'
    s += (f'<path d="M0 {hz + 84} Q400 {hz + 48} 820 {hz + 92} T1600 {hz + 66} '
          f'L1600 {H} L0 {H} Z" fill="#3E3529"/>')
    s += (f'<path d="M0 {hz + 150} Q520 {hz + 118} 1090 {hz + 162} T1600 {hz + 140} '
          f'L1600 {H} L0 {H} Z" fill="#332B21"/>')
    s += f'<ellipse cx="1050" cy="{hz + 40}" rx="440" ry="52" fill="#FFD79A" opacity="0.07" filter="url(#weich)"/>'

    # Material
    for i in range(9):
        s += (f'<g><rect x="{54 + i * 122}" y="{hz + 18}" width="80" height="15" rx="3" fill="#C08B3A" opacity="0.55"/>'
              f'<rect x="{54 + i * 122}" y="{hz + 18}" width="80" height="4" rx="2" fill="#FFE0AC" opacity="0.35"/></g>')
    s += (f'<g filter="url(#nah)"><rect x="1188" y="{hz + 40}" width="268" height="74" rx="7" fill="#2E3440"/>'
          f'<rect x="1188" y="{hz + 40}" width="268" height="15" rx="7" fill="#F5A524" opacity="0.7"/>'
          f'<rect x="1206" y="{hz + 66}" width="76" height="32" fill="#1B202A"/>'
          f'<rect x="1300" y="{hz + 66}" width="76" height="32" fill="#1B202A"/></g>')
    s += (f'<g opacity="0.9"><rect x="944" y="{hz - 96}" width="14" height="96" fill="#B9C2D0"/>'
          f'<path d="M944 {hz - 96} h58 l-10 15 10 15 h-58 Z" fill="#E30613" opacity="0.8"/></g>')

    s += silhouette(1004, hz + 44, 0.74, 'tragen', spiegeln=True)
    s += silhouette(404, hz + 118, 1.16, 'zeigen')
    s += silhouette(546, hz + 128, 1.24, 'stehen', spiegeln=True)
    s += silhouette(1290, hz + 30, 0.62, 'gehen')
    s += marke('REALTIME Service · Platzhalter', '#F5A524')
    return s + fuss()


# ==========================================================================
# 2 — Security: Objektschutz bei Nacht
# ==========================================================================

def szene_security():
    hz = 706
    s = kopf('Platzhalter: Objektschutz bei Nacht — Wachmann auf Streife',
             [(0, '#141F38'), (0.46, '#0E1729'), (0.8, '#0A0F1C'), (1, '#070A13')],
             '#5E8BFF', 0.8, 0.1, 0.7)
    g = rnd(3)
    for i in range(90):
        x, y = next(g) * W, next(g) * (hz - 240)
        s += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{0.7 + next(g):.1f}" fill="#DCE6FF" opacity="{0.1 + next(g) * 0.4:.2f}"/>'
    s += skyline(hz, '#111B2C', 0.7, seed=5, hoch=300)

    # Objekt
    s += f'<rect x="356" y="222" width="726" height="{hz - 222}" fill="#182338"/>'
    s += f'<rect x="356" y="222" width="726" height="9" fill="#2F6BFF" opacity="0.45"/>'
    s += f'<rect x="356" y="222" width="26" height="{hz - 222}" fill="#FFFFFF" opacity="0.04"/>'
    s += fensterraster(378, 250, 10, 6, 52, 48, 18, seed=23, quote=0.36)
    s += f'<rect x="356" y="222" width="726" height="{hz - 222}" fill="url(#dunst)" opacity="0.35"/>'
    # Eingang mit Vordach
    s += f'<rect x="620" y="{hz - 132}" width="196" height="132" fill="#0B1120"/>'
    s += f'<rect x="600" y="{hz - 140}" width="236" height="14" rx="4" fill="#22304A"/>'
    s += f'<rect x="676" y="{hz - 116}" width="84" height="116" fill="#FFF3D0" opacity="0.16"/>'
    s += f'<path d="M676 {hz - 116} h84 v116 h-84 Z" fill="none" stroke="#3A4A66" stroke-width="3"/>'
    s += f'<ellipse cx="718" cy="{hz + 14}" rx="150" ry="34" fill="#FFF3D0" opacity="0.09" filter="url(#weich)"/>'

    # Zaun
    s += '<g stroke="#2C374B" stroke-width="5" opacity="0.95">'
    for xx in range(40, 1580, 46):
        s += f'<path d="M{xx} {hz - 96} V{hz + 6}"/>'
    s += f'<path d="M24 {hz - 94} H1584" stroke-width="6"/><path d="M24 {hz - 26} H1584" stroke-width="6"/></g>'

    # Mast mit Strahler
    s += f'<rect x="1298" y="112" width="13" height="{hz - 112}" fill="#2A3448"/>'
    s += '<rect x="1268" y="94" width="72" height="28" rx="7" fill="#3D4A62"/>'
    s += '<rect x="1274" y="118" width="60" height="8" rx="3" fill="#FFF6DC" opacity="0.85"/>'
    s += (f'<path d="M1272 126 L960 {hz + 40} L1600 {hz + 40} L1338 126 Z" fill="#FFF6DC" '
          f'opacity="0.075" filter="url(#nah)"/>')
    s += '<circle cx="1304" cy="122" r="34" fill="#FFF6DC" opacity="0.3" filter="url(#glanz)"/>'

    # Boden
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#0D1119"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="3" fill="#FFFFFF" opacity="0.07"/>'
    s += f'<ellipse cx="1200" cy="{hz + 96}" rx="360" ry="60" fill="#FFF6DC" opacity="0.06" filter="url(#weich)"/>'
    for i in range(7):
        s += f'<rect x="{110 + i * 226}" y="{hz + 120}" width="120" height="6" rx="3" fill="#E7ECF4" opacity="0.12"/>'

    s += silhouette(1108, hz + 46, 0.8, 'gehen', reflex='#2F6BFF', saum='#BFD4FF', dunkel='#0B0F17')
    s += wachmann(408, hz + 132, 1.34, haut=0)
    s += marke('SSE Security · Platzhalter', '#2F6BFF')
    return s + fuss()


# ==========================================================================
# 3 — Reinigung: Unterhaltsreinigung im Flur
# ==========================================================================

def szene_reinigung():
    """Ein beleuchteter Flur, nicht ein dunkler. Reinigung laeuft im Licht."""
    hz = 618
    s = kopf('Platzhalter: Unterhaltsreinigung — Reinigungskraft mit Wagen im Flur',
             [(0, '#E8E4DC'), (0.5, '#D8D4CC'), (1, '#B9B5AD')], '#FFF3D8', 0.5, 0.1, 0.8)
    s += f'<rect x="0" y="0" width="{W}" height="{hz}" fill="#D5D1C8"/>'

    # Decke mit Lichtbaendern und Lichtkegeln nach unten
    s += f'<rect x="0" y="0" width="{W}" height="112" fill="#C6C3BB"/>'
    s += f'<rect x="0" y="108" width="{W}" height="6" fill="#A29E96"/>'
    for i in range(6):
        cx = 150 + i * 262
        s += f'<rect x="{cx - 88}" y="26" width="176" height="20" rx="10" fill="#FFFDF4"/>'
        s += f'<rect x="{cx - 88}" y="26" width="176" height="8" rx="4" fill="#FFFFFF"/>'
        s += (f'<path d="M{cx - 88} 46 L{cx - 250} {H} L{cx + 250} {H} L{cx + 88} 46 Z" '
              f'fill="#FFF6DC" opacity="0.16" filter="url(#weich)"/>')
        s += f'<ellipse cx="{cx}" cy="60" rx="150" ry="52" fill="#FFF6DC" opacity="0.5" filter="url(#glanz)"/>'

    # Glasfront links: Bueros dahinter, dunkel
    for i in range(3):
        x = 40 + i * 246
        s += f'<rect x="{x}" y="126" width="196" height="{hz - 126}" rx="3" fill="#8E8B84"/>'
        s += f'<rect x="{x}" y="126" width="196" height="{hz - 126}" rx="3" fill="url(#wand)"/>'
        s += f'<rect x="{x + 10}" y="136" width="176" height="{hz - 146}" fill="#3E4652"/>'
        s += f'<rect x="{x + 10}" y="136" width="176" height="{hz - 146}" fill="url(#dunst)" opacity="0.5"/>'
        s += f'<path d="M{x + 10} 136 l96 0 l-96 216 Z" fill="#FFFFFF" opacity="0.16"/>'
        s += f'<path d="M{x + 120} 136 l40 0 l-40 96 Z" fill="#FFFFFF" opacity="0.09"/>'
        s += f'<rect x="{x + 94}" y="136" width="6" height="{hz - 146}" fill="#8E8B84"/>'
        s += f'<rect x="{x + 10}" y="{hz - 96}" width="176" height="86" fill="#2F3742" opacity="0.5"/>'
    s += f'<rect x="0" y="126" width="40" height="{hz - 126}" fill="#CFCBC2"/>'

    # Rueckwand rechts mit Tueren und Infotafel
    s += f'<rect x="792" y="118" width="808" height="{hz - 118}" fill="#DAD6CD"/>'
    s += f'<rect x="792" y="118" width="808" height="{hz - 118}" fill="url(#wand)"/>'
    s += f'<rect x="792" y="{hz - 74}" width="808" height="74" fill="#B4B0A7"/>'
    s += f'<rect x="792" y="{hz - 74}" width="808" height="7" fill="#9A968E"/>'
    for i in range(3):
        x = 856 + i * 226
        s += f'<rect x="{x}" y="238" width="152" height="{hz - 238}" fill="#B9B5AC"/>'
        s += f'<rect x="{x + 9}" y="247" width="134" height="{hz - 256}" fill="#E4E0D7"/>'
        s += f'<rect x="{x + 9}" y="247" width="134" height="{hz - 256}" fill="url(#tuer)"/>'
        s += f'<rect x="{x + 32}" y="284" width="88" height="30" rx="3" fill="#5D6673" opacity="0.5"/>'
        s += f'<circle cx="{x + 130}" cy="{hz - 178}" r="6" fill="#7C838E"/>'
        s += f'<rect x="{x}" y="{hz - 78}" width="152" height="10" fill="#07080B" opacity="0.10"/>'
    s += (f'<g><rect x="1476" y="272" width="104" height="140" rx="5" fill="#E4E0D7"/>'
          f'<rect x="1476" y="272" width="104" height="10" rx="5" fill="#E30613" opacity="0.75"/>'
          f'<rect x="1490" y="296" width="76" height="30" rx="3" fill="#C4C0B7"/>'
          f'<rect x="1490" y="336" width="76" height="9" rx="4" fill="#C4C0B7"/>'
          f'<rect x="1490" y="352" width="54" height="9" rx="4" fill="#C4C0B7"/>'
          f'<rect x="1490" y="368" width="66" height="9" rx="4" fill="#C4C0B7"/></g>')

    # Boden: hell, spiegelnd
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#BEB9AF"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="6" fill="#8F8B83"/>'
    s += f'<rect x="0" y="{hz + 6}" width="{W}" height="26" fill="#FFFFFF" opacity="0.14"/>'
    for i in range(6):
        cx = 150 + i * 262
        s += (f'<ellipse cx="{cx + 10}" cy="{hz + 150}" rx="188" ry="86" fill="#FFF9E8" '
              f'opacity="0.30" filter="url(#weich)"/>')
        s += (f'<ellipse cx="{cx + 10}" cy="{hz + 120}" rx="96" ry="34" fill="#FFFDF4" '
              f'opacity="0.22" filter="url(#weich)"/>')
    for i in range(6):
        s += (f'<path d="M{-120 + i * 340} {H} L{190 + i * 340} {hz + 6}" stroke="#FFFFFF" '
              f'stroke-width="2.5" opacity="0.16"/>')
    # Frisch gewischter, noch feuchter Streifen
    s += (f'<path d="M640 {hz + 208} q250 -40 520 8 q-260 52 -520 -8 Z" fill="#FFFFFF" '
          f'opacity="0.22" filter="url(#weich)"/>')
    # Warnaufsteller
    s += (f'<g transform="translate(1288,{hz + 244})">{schatten(40, 6, 56, 10, 0.22)}'
          f'<path d="M0 0 l40 -112 l40 112 Z" fill="#F5C518"/>'
          f'<path d="M0 0 l40 -112 l10 112 Z" fill="#FFFFFF" opacity="0.18"/>'
          f'<path d="M31 -84 l18 0 l-4 36 l-10 0 Z" fill="#4A3D12"/>'
          f'<circle cx="40" cy="-34" r="5" fill="#4A3D12"/></g>')

    s += putzwagen(992, hz + 186, 1.26)
    s += silhouette(636, hz + 158, 1.08, 'buecken', reflex='#B93A46', saum='#FFF3D8', dunkel='#232833')
    s += marke('CSE Dienstleistungen · Platzhalter', '#E30613')
    return s + fuss()


# ==========================================================================
# 4 — Operations: Leitstand
# ==========================================================================

def balken(x, y, b, h, farbe, op=0.85):
    return f'<rect x="{x}" y="{y - h}" width="{b}" height="{h}" rx="2" fill="{farbe}" opacity="{op}"/>'


def szene_operations():
    hz = 660
    s = kopf('Platzhalter: Leitstand der Gruppe — Kennzahlen auf der Wand',
             [(0, '#1A1B2A'), (0.55, '#14151F'), (1, '#0D0E15')], '#7C5CFF', 0.5, 0.3, 0.8)
    s += f'<rect x="0" y="0" width="{W}" height="{hz}" fill="#15161F"/>'
    s += f'<rect x="0" y="0" width="{W}" height="68" fill="#1B1D28"/>'
    for i in range(4):
        s += f'<rect x="{150 + i * 380}" y="26" width="180" height="10" rx="5" fill="#B9A7FF" opacity="0.35"/>'

    # Grosse Wandmonitore
    def monitor(x, y, b, h, seed, akzent):
        t = f'<g><rect x="{x - 8}" y="{y - 8}" width="{b + 16}" height="{h + 16}" rx="10" fill="#0A0B11"/>'
        t += f'<rect x="{x}" y="{y}" width="{b}" height="{h}" rx="4" fill="#101725"/>'
        t += f'<rect x="{x}" y="{y}" width="{b}" height="{h}" rx="4" fill="url(#dunst)" opacity="0.25"/>'
        gg = rnd(seed)
        t += f'<rect x="{x + 16}" y="{y + 16}" width="{int(b * 0.42)}" height="9" rx="4" fill="#E7ECF4" opacity="0.4"/>'
        basis = y + h - 28
        n = 11
        bb = int((b - 40) / n) - 6
        for i in range(n):
            hh = int(16 + next(gg) * (h - 90))
            t += balken(x + 20 + i * (bb + 6), basis, bb, hh, akzent, 0.35 + next(gg) * 0.5)
        t += f'<path d="M{x + 20} {basis + 6} H{x + b - 20}" stroke="#E7ECF4" stroke-width="2" opacity="0.25"/>'
        return t + '</g>'

    def linienmonitor(x, y, b, h, seed, akzent):
        t = f'<g><rect x="{x - 8}" y="{y - 8}" width="{b + 16}" height="{h + 16}" rx="10" fill="#0A0B11"/>'
        t += f'<rect x="{x}" y="{y}" width="{b}" height="{h}" rx="4" fill="#101725"/>'
        gg = rnd(seed)
        pts, py = [], y + h * 0.6
        for i in range(14):
            py = max(y + 26, min(y + h - 26, py + (next(gg) - 0.45) * h * 0.28))
            pts.append(f'{x + 18 + i * (b - 36) / 13:.0f},{py:.0f}')
        t += f'<polyline points="{" ".join(pts)}" fill="none" stroke="{akzent}" stroke-width="3.5" opacity="0.9"/>'
        t += (f'<polygon points="{x + 18},{y + h - 14} {" ".join(pts)} {x + b - 18},{y + h - 14}" '
              f'fill="{akzent}" opacity="0.13"/>')
        for r in range(4):
            t += f'<path d="M{x + 18} {y + 30 + r * (h - 60) / 3:.0f} H{x + b - 18}" stroke="#E7ECF4" stroke-width="1" opacity="0.08"/>'
        return t + '</g>'

    s += monitor(150, 120, 520, 300, 31, '#4CC38A')
    s += linienmonitor(714, 120, 420, 300, 17, '#2F6BFF')
    s += monitor(1178, 120, 280, 300, 41, '#F5A524')
    s += (f'<g opacity="0.9"><rect x="150" y="452" width="1308" height="128" rx="8" fill="#0F1017"/>')
    for i in range(6):
        x = 172 + i * 218
        s += (f'<rect x="{x}" y="472" width="184" height="88" rx="6" fill="#171A25"/>'
              f'<rect x="{x + 14}" y="490" width="{60 + i * 12}" height="10" rx="5" fill="#E7ECF4" opacity="0.3"/>'
              f'<rect x="{x + 14}" y="512" width="{96 - i * 7}" height="20" rx="4" fill="#7C5CFF" opacity="0.4"/>')
    s += '</g>'
    s += f'<rect x="0" y="120" width="{W}" height="470" fill="#7C5CFF" opacity="0.05" filter="url(#glanz)"/>'

    # Tisch und zwei Personen von hinten (keine Gesichter — DESIGN §4.2)
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#12131B"/>'
    s += f'<rect x="0" y="{hz + 96}" width="{W}" height="18" fill="#232634"/>'
    s += f'<rect x="0" y="{hz + 114}" width="{W}" height="{H - hz - 114}" fill="#191B25"/>'
    for i in range(3):
        x = 300 + i * 500
        s += (f'<g><rect x="{x}" y="{hz + 24}" width="150" height="76" rx="6" fill="#0A0B11"/>'
              f'<rect x="{x + 6}" y="{hz + 30}" width="138" height="64" rx="3" fill="#16202F"/>'
              f'<rect x="{x + 16}" y="{hz + 42}" width="80" height="7" rx="3" fill="#4CC38A" opacity="0.6"/>'
              f'<rect x="{x + 16}" y="{hz + 56}" width="110" height="7" rx="3" fill="#E7ECF4" opacity="0.2"/>'
              f'<rect x="{x + 16}" y="{hz + 70}" width="64" height="7" rx="3" fill="#E7ECF4" opacity="0.14"/>'
              f'<rect x="{x + 40}" y="{hz + 100}" width="70" height="10" rx="4" fill="#2A2E3C"/></g>')

    def ruecken(x, y, s2, farbe, kopf_f):
        return (f'<g transform="translate({x},{y}) scale({s2})">'
                f'<path d="M-52 0 q0 -78 52 -78 q52 0 52 78 Z" fill="{farbe}"/>'
                f'<path d="M-52 0 q0 -78 52 -78 l0 78 Z" fill="#FFFFFF" opacity="0.05"/>'
                f'<circle cx="0" cy="-104" r="27" fill="{kopf_f}"/>'
                f'<path d="M-27 -110 a27 24 0 0 1 54 0 q-14 -16 -27 -16 q-14 0 -27 16 z" fill="#181A22"/>'
                f'</g>')

    s += silhouette(462, H + 4, 1.34, 'stehen', reflex='#3A4256', saum='#9C8CFF',
                    dunkel='#0C0D13', saumseite=-1)
    s += silhouette(1104, H + 18, 1.46, 'tragen', reflex='#3A4256', saum='#7FE3B4',
                    dunkel='#0C0D13')
    s += marke('CSE Operations · Platzhalter', '#7C5CFF')
    return s + fuss()


# ==========================================================================
# 5 — Gruppe / Hero: die vier Haeuser in der blauen Stunde
# ==========================================================================

def szene_hero():
    hz = 720
    s = kopf('Platzhalter: Gebaeudezeile der vier Gesellschaften in der blauen Stunde',
             [(0, '#1B2A47'), (0.34, '#2A3A58'), (0.62, '#5B4A57'), (0.82, '#7A5A48'), (1, '#3A2E33')],
             '#FFB870', 0.5, 0.72, 0.85)
    g = rnd(9)
    for i in range(70):
        x, y = next(g) * W, next(g) * 420
        s += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{0.6 + next(g) * 1.1:.1f}" fill="#DCE6FF" opacity="{0.08 + next(g) * 0.3:.2f}"/>'
    s += skyline(hz - 40, '#26314A', 0.55, seed=13, hoch=300)
    s += f'<rect x="0" y="{hz - 420}" width="{W}" height="420" fill="url(#dunst)" opacity="0.4"/>'

    haeuser = [
        (120, 250, 300, '#E30613', 21),   # Reinigung
        (450, 190, 330, '#2F6BFF', 22),   # Security
        (810, 300, 280, '#F5A524', 24),   # Bau
        (1120, 220, 360, '#7C5CFF', 26),  # Operations
    ]
    for x, y, b, akz, seed in haeuser:
        h = hz - y
        s += f'<rect x="{x}" y="{y}" width="{b}" height="{h}" fill="#1C263B"/>'
        s += f'<rect x="{x}" y="{y}" width="{b}" height="10" fill="{akz}" opacity="0.5"/>'
        s += f'<rect x="{x}" y="{y}" width="24" height="{h}" fill="#FFFFFF" opacity="0.05"/>'
        sp = max(3, (b - 30) // 58)
        ze = max(4, (h - 60) // 62)
        s += fensterraster(x + 18, y + 34, sp, ze, 40, 44, 18, seed=seed, quote=0.42)
        s += f'<rect x="{x}" y="{y}" width="{b}" height="{h}" fill="url(#dunst)" opacity="0.28"/>'
        s += f'<rect x="{x + b // 2 - 44}" y="{hz - 94}" width="88" height="94" fill="#0E1522"/>'
        s += f'<rect x="{x + b // 2 - 34}" y="{hz - 82}" width="68" height="82" fill="#FFF3D0" opacity="0.2"/>'
        s += f'<ellipse cx="{x + b // 2}" cy="{hz + 14}" rx="96" ry="26" fill="#FFF3D0" opacity="0.08" filter="url(#weich)"/>'

    # Strasse mit Lichtspuren
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#141824"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="4" fill="#FFFFFF" opacity="0.08"/>'
    s += f'<rect x="0" y="{hz + 30}" width="{W}" height="2" fill="#FFFFFF" opacity="0.05"/>'
    s += (f'<path d="M-40 {hz + 132} Q700 {hz + 96} 1660 {hz + 150}" stroke="#FFD9A8" stroke-width="9" '
          f'fill="none" opacity="0.45" filter="url(#nah)"/>')
    s += (f'<path d="M-40 {hz + 158} Q700 {hz + 124} 1660 {hz + 176}" stroke="#FF6B6B" stroke-width="7" '
          f'fill="none" opacity="0.3" filter="url(#nah)"/>')
    for i in range(9):
        s += f'<rect x="{40 + i * 186}" y="{hz + 106}" width="96" height="5" rx="2" fill="#E7ECF4" opacity="0.14"/>'
    # Laternen
    for i in range(4):
        x = 210 + i * 400
        s += (f'<g opacity="0.9"><rect x="{x}" y="{hz - 180}" width="8" height="180" fill="#2A3448"/>'
              f'<path d="M{x + 4} {hz - 180} q0 -26 34 -26" stroke="#2A3448" stroke-width="8" fill="none"/>'
              f'<circle cx="{x + 40} " cy="{hz - 204}" r="9" fill="#FFF6DC"/>'
              f'<circle cx="{x + 40}" cy="{hz - 204}" r="30" fill="#FFF6DC" opacity="0.28" filter="url(#glanz)"/></g>')
    s += marke('CSE Group · Platzhalter', '#E7ECF4')
    return s + fuss()


# ==========================================================================
# 6 — Objekt: Gewerbeobjekt in der Dämmerung
# ==========================================================================

def szene_objekt():
    hz = 700
    s = kopf('Platzhalter: Gewerbeobjekt in der Daemmerung mit Vorfahrt',
             [(0, '#26344F'), (0.4, '#3B4763'), (0.72, '#6A5C5E'), (1, '#2C2B33')],
             '#FFC48A', 0.24, 0.24, 0.8)
    s += skyline(hz - 20, '#2B3448', 0.4, seed=19, hoch=210)
    s += f'<rect x="0" y="{hz - 360}" width="{W}" height="360" fill="url(#dunst)" opacity="0.45"/>'

    # Baukoerper: niedriger Riegel + hoeherer Kopfbau
    s += f'<rect x="120" y="380" width="820" height="{hz - 380}" fill="#232C3D"/>'
    s += f'<rect x="120" y="380" width="820" height="10" fill="#39445C"/>'
    s += fensterraster(146, 404, 12, 4, 50, 46, 16, seed=29, quote=0.44)
    s += f'<rect x="940" y="236" width="500" height="{hz - 236}" fill="#1D2534"/>'
    s += f'<rect x="940" y="236" width="500" height="10" fill="#465272"/>'
    s += f'<rect x="940" y="236" width="22" height="{hz - 236}" fill="#FFFFFF" opacity="0.05"/>'
    s += fensterraster(964, 262, 8, 7, 46, 44, 16, seed=33, quote=0.4)
    s += f'<rect x="120" y="380" width="1320" height="{hz - 380}" fill="url(#dunst)" opacity="0.22"/>'

    # Eingang mit Vordach und Fahnen
    s += f'<rect x="560" y="{hz - 150}" width="260" height="150" fill="#111726"/>'
    s += f'<rect x="536" y="{hz - 162}" width="308" height="16" rx="5" fill="#39445C"/>'
    s += f'<rect x="600" y="{hz - 132}" width="82" height="132" fill="#FFF3D0" opacity="0.2"/>'
    s += f'<rect x="698" y="{hz - 132}" width="82" height="132" fill="#FFF3D0" opacity="0.14"/>'
    s += f'<ellipse cx="690" cy="{hz + 26}" rx="200" ry="40" fill="#FFF3D0" opacity="0.1" filter="url(#weich)"/>'
    for i, c in enumerate(['#E30613', '#2F6BFF', '#F5A524']):
        x = 268 + i * 74
        s += (f'<g><rect x="{x}" y="{hz - 300}" width="6" height="300" fill="#4A5468"/>'
              f'<path d="M{x + 6} {hz - 298} q30 12 54 0 l0 76 q-26 12 -54 0 Z" fill="{c}" opacity="0.7"/></g>')

    # Vorfahrt
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#1A1E28"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="4" fill="#FFFFFF" opacity="0.07"/>'
    s += f'<path d="M0 {hz + 70} H{W}" stroke="#E7ECF4" stroke-width="2" opacity="0.08"/>'
    for i in range(8):
        s += f'<rect x="{60 + i * 200}" y="{hz + 118}" width="112" height="6" rx="3" fill="#E7ECF4" opacity="0.12"/>'
    # Poller mit Licht
    for i in range(6):
        x = 120 + i * 260
        s += (f'<g><rect x="{x}" y="{hz + 24}" width="14" height="46" rx="6" fill="#39445C"/>'
              f'<circle cx="{x + 7}" cy="{hz + 24}" r="6" fill="#FFF6DC" opacity="0.9"/>'
              f'<circle cx="{x + 7}" cy="{hz + 24}" r="22" fill="#FFF6DC" opacity="0.22" filter="url(#glanz)"/></g>')
    # Baum links, weich
    s += ('<g filter="url(#mittel)" opacity="0.85">'
          f'<rect x="70" y="{hz - 96}" width="12" height="100" fill="#2A2620"/>'
          f'<ellipse cx="76" cy="{hz - 140}" rx="72" ry="58" fill="#233028"/>'
          f'<ellipse cx="44" cy="{hz - 122}" rx="46" ry="38" fill="#1D2822"/>'
          f'<ellipse cx="106" cy="{hz - 160}" rx="44" ry="36" fill="#2A3A2F"/></g>')
    s += marke('Objekt · Platzhalter', '#2F6BFF')
    return s + fuss()


# ==========================================================================
# 7 — Projekt: Baustelle am Tag mit Bagger
# ==========================================================================

def szene_projekt():
    hz = 680
    s = kopf('Platzhalter: Bauprojekt am Tag — Erdarbeiten und Rohbau',
             [(0, '#7FA0C4'), (0.42, '#A6BBD3'), (0.74, '#C9CDC6'), (1, '#9E937F')],
             '#FFF0CE', 0.7, 0.14, 0.9)
    s += ('<g opacity="0.5" filter="url(#fern)">'
          '<ellipse cx="320" cy="150" rx="180" ry="52" fill="#FFFFFF" opacity="0.55"/>'
          '<ellipse cx="430" cy="128" rx="120" ry="44" fill="#FFFFFF" opacity="0.45"/>'
          '<ellipse cx="1180" cy="190" rx="220" ry="56" fill="#FFFFFF" opacity="0.4"/></g>')
    s += skyline(hz - 60, '#7E8AA0', 0.34, seed=37, hoch=200)
    s += f'<rect x="0" y="{hz - 320}" width="{W}" height="320" fill="url(#dunst)" opacity="0.5"/>'

    # Rohbau rechts, unscharf
    s += '<g filter="url(#mittel)">'
    s += f'<rect x="1000" y="238" width="470" height="{hz - 238}" fill="#B7B3AA"/>'
    for yy in range(300, hz, 84):
        s += f'<rect x="1000" y="{yy}" width="470" height="13" fill="#9C978C"/>'
    for xx in range(1000, 1480, 118):
        s += f'<rect x="{xx}" y="238" width="14" height="{hz - 238}" fill="#A8A399"/>'
    s += '</g>'
    s += '<g stroke="#C0C6D0" stroke-width="4" fill="none" opacity="0.8">'
    for xx in range(990, 1490, 64):
        s += f'<path d="M{xx} 228 V{hz}"/>'
    for yy in range(228, hz, 58):
        s += f'<path d="M990 {yy} H1486"/>'
    s += '</g>'
    s += turmkran(760, hz, 540, 360, '#E8952B')

    # Erde
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#8A7358"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="8" fill="#A48A69"/>'
    s += (f'<path d="M0 {hz + 60} Q380 {hz + 24} 760 {hz + 70} T1600 {hz + 46} L1600 {H} L0 {H} Z" fill="#77624B"/>')
    s += (f'<path d="M0 {hz + 140} Q460 {hz + 104} 980 {hz + 150} T1600 {hz + 126} L1600 {H} L0 {H} Z" fill="#645240"/>')
    s += f'<ellipse cx="420" cy="{hz + 150}" rx="330" ry="46" fill="#4E4032" opacity="0.5" filter="url(#weich)"/>'

    # Bagger
    bx, by = 300, hz + 150
    s += schatten(bx + 30, by + 16, 130, 20, 0.4)
    s += (f'<g transform="translate({bx},{by})">'
          f'<rect x="-98" y="-42" width="220" height="44" rx="22" fill="#2C3038"/>'
          f'<rect x="-98" y="-42" width="220" height="10" rx="5" fill="#FFFFFF" opacity="0.07"/>'
          f'<circle cx="-72" cy="-20" r="21" fill="#171A20"/><circle cx="-72" cy="-20" r="8" fill="#3C4450"/>'
          f'<circle cx="96" cy="-20" r="21" fill="#171A20"/><circle cx="96" cy="-20" r="8" fill="#3C4450"/>'
          f'<circle cx="12" cy="-16" r="13" fill="#171A20"/>'
          f'<rect x="-70" y="-124" width="150" height="86" rx="10" fill="#F5A524"/>'
          f'<rect x="-50" y="-112" width="72" height="52" rx="5" fill="#20303F" opacity="0.85"/>'
          f'<rect x="-50" y="-112" width="34" height="52" rx="5" fill="#FFFFFF" opacity="0.12"/>'
          f'<path d="M78 -96 L212 -150" stroke="#E8952B" stroke-width="24" fill="none" stroke-linecap="round"/>'
          f'<path d="M78 -96 L212 -150" stroke="#FFFFFF" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.12"/>'
          f'<path d="M212 -150 L246 -46" stroke="#E8952B" stroke-width="19" fill="none" stroke-linecap="round"/>'
          f'<path d="M96 -108 L206 -142" stroke="#6B7480" stroke-width="6"/>'
          f'<path d="M218 -142 L240 -60" stroke="#6B7480" stroke-width="5"/>'
          f'<circle cx="212" cy="-150" r="12" fill="#C97C1E"/>'
          f'<path d="M244 -44 q34 -6 44 22 q-8 34 -50 30 q-14 -28 6 -52 Z" fill="#8A939F"/>'
          f'<path d="M244 -44 q34 -6 44 22 l-18 4 q-6 -20 -30 -18 Z" fill="#AAB4C2"/>'
          f'<path d="M240 8 l6 14 M262 12 l5 14 M284 6 l5 14" stroke="#6B7480" stroke-width="5" stroke-linecap="round"/>'
          f'</g>')

    # Rohre und Palette
    for i in range(3):
        s += (f'<g><rect x="{980 + i * 6}" y="{hz + 96 + i * 26}" width="300" height="24" rx="12" fill="#9AA6BA"/>'
              f'<rect x="{980 + i * 6}" y="{hz + 96 + i * 26}" width="300" height="7" rx="4" fill="#C3CDDC" opacity="0.6"/></g>')
    s += silhouette(690, hz + 172, 1.06, 'zeigen', dunkel='#2A2419', saum='#FFE7B8')
    s += silhouette(806, hz + 164, 0.98, 'stehen', spiegeln=True, dunkel='#2A2419', saum='#FFE7B8')
    s += marke('Projekt · Platzhalter', '#F5A524')
    return s + fuss()


# ==========================================================================
# 8 — Team: Crew von hinten im Morgenlicht (keine erfundenen Gesichter)
# ==========================================================================

def szene_team():
    hz = 690
    s = kopf('Platzhalter: Crew von hinten im Morgenlicht — bewusst ohne Gesichter',
             [(0, '#2A3A55'), (0.36, '#5D5A64'), (0.62, '#9E7A5C'), (0.84, '#C58F55'), (1, '#5A4130')],
             '#FFD79A', 0.5, 0.62, 0.9)
    s += '<circle cx="800" cy="600" r="210" fill="#FFD08A" opacity="0.5" filter="url(#glanz)"/>'
    s += '<circle cx="800" cy="600" r="120" fill="url(#scheibe)" opacity="0.55"/>'
    s += skyline(hz - 10, '#3A3F4E', 0.62, seed=43, hoch=230)
    s += f'<rect x="0" y="{hz - 380}" width="{W}" height="380" fill="url(#dunst)" opacity="0.5"/>'
    s += '<g opacity="0.5">' + turmkran(1250, hz - 6, 430, 270, '#4E4A42') + '</g>'
    # Blendung vor der Kulisse — so sieht Gegenlicht aus
    s += '<circle cx="800" cy="604" r="150" fill="#FFE7B4" opacity="0.55" filter="url(#glanz)"/>'
    s += '<circle cx="800" cy="604" r="104" fill="url(#scheibe)"/>'
    s += f'<rect x="0" y="520" width="{W}" height="200" fill="#FFDCA0" opacity="0.10" filter="url(#weich)"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="{H - hz}" fill="#3A3128"/>'
    s += f'<rect x="0" y="{hz}" width="{W}" height="6" fill="#544635"/>'
    s += (f'<path d="M0 {hz + 90} Q500 {hz + 54} 1010 {hz + 98} T1600 {hz + 74} L1600 {H} L0 {H} Z" fill="#2E2820"/>')
    s += f'<ellipse cx="800" cy="{hz + 26}" rx="620" ry="56" fill="#FFD79A" opacity="0.20" filter="url(#weich)"/>'

    # Sechs gegen das Licht — Silhouetten, keine erfundenen Gesichter
    reihe = [
        (330, 1.32, '#F5A524'), (496, 1.44, '#B93A46'), (664, 1.56, '#2F6BFF'),
        (856, 1.62, '#F5D14E'), (1032, 1.48, '#A7B3C6'), (1196, 1.34, '#B93A46'),
    ]
    for i, (x, sc, reflex) in enumerate(reihe):
        s += silhouette(x, H - 62, sc, 'stehen' if i % 2 == 0 else 'tragen',
                        reflex=reflex, saum='#FFE3B0', dunkel='#14161D',
                        spiegeln=(i % 3 == 1), saumseite=1 if x > 800 else -1)
    s += marke('Team · Platzhalter', '#E7ECF4')
    return s + fuss()


SZENEN = {
    'bau': szene_bau, 'security': szene_security, 'reinigung': szene_reinigung,
    'operations': szene_operations, 'hero': szene_hero, 'objekt': szene_objekt,
    'projekt': szene_projekt, 'team': szene_team,
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in SZENEN.items():
        with open(os.path.join(OUT, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(fn())
        print(name, os.path.getsize(os.path.join(OUT, f'{name}.svg')))

"""
Builds the WorldJam pitch deck as a single self-contained HTML file, which
Chrome then prints to PDF.

Everything is inlined — images as data URIs, fonts as locally available faces —
because the output has to render identically on a judge's laptop with no
network. Two things learned the hard way and encoded here:

  * Headless Chrome treats a `px` value in `@page` as points, so a deck
    declared as 1920px came out at 1440x810. It is declared in inches instead.
  * Chrome does not block on a Google Fonts <link> before printing, so every
    face silently substituted. The deck names faces that exist on the machine.
"""

import base64
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.join(ROOT, 'deck')
SHOTS = os.path.join(ROOT, 'screens')

# --- palette -----------------------------------------------------------------
INK = '#F4F5F7'
DIM = '#C9CFDC'
MUTE = '#94A3B8'
CYAN = '#7DD3FC'
LILAC = '#C4B5FD'
PINK = '#F9A8D4'
MINT = '#34D399'
BG = '#0A0B10'

DISPLAY = "'Segoe UI Semibold','Segoe UI',Arial,sans-serif"
TEXT = "'Segoe UI','Helvetica Neue',Arial,sans-serif"


def data_uri(path: str) -> str:
    kind = 'jpeg' if path.lower().endswith(('.jpg', '.jpeg')) else 'png'
    with open(path, 'rb') as fh:
        return f'data:image/{kind};base64,' + base64.b64encode(fh.read()).decode()


IMG = {
    name: data_uri(os.path.join(DECK, f'{name}.jpg'))
    for name in [
        'splash', 'home', 'home2', 'scan1', 'scan2', 'object', 'arrange',
        'library', 'track', 'publish', 'create', 'detail',
    ]
}
IMG['dev_scan'] = data_uri(os.path.join(SHOTS, '03-profile.png'))
IMG['dev_studio'] = data_uri(os.path.join(SHOTS, '01-home.png'))


def phone(key: str, height: int = 760) -> str:
    """One phone screen, height-constrained so a row of them lines up."""
    return (
        f'<img src="{IMG[key]}" alt="WorldJam app screen" '
        f'style="height:{height}px; width:auto; object-fit:contain; '
        f'border-radius:18px">'
    )


def slide(body: str, bg: str = BG, pad: str = '96px 128px') -> str:
    return (
        f'<section style="background:{bg}; color:{INK}; font-family:{TEXT}; '
        f'padding:{pad}">{body}</section>'
    )


def kicker(text: str, color: str = LILAC) -> str:
    return (
        f'<p style="font-family:{DISPLAY}; font-size:24px; font-weight:600; '
        f'letter-spacing:5px; text-transform:uppercase; color:{color}">{text}</p>'
    )


def h2(text: str, size: int = 76) -> str:
    return (
        f'<h2 style="font-family:{DISPLAY}; font-size:{size}px; font-weight:700; '
        f'line-height:1.08; margin:0">{text}</h2>'
    )


def card(title: str, body: str, accent: str) -> str:
    return (
        f'<div style="flex:1; display:flex; flex-direction:column; gap:14px; '
        f'background:#141824; padding:40px; border:1px solid #2A3040; '
        f'border-radius:20px">'
        f'<h3 style="font-size:31px; font-weight:600; color:{accent}; margin:0">{title}</h3>'
        f'<p style="font-size:26px; line-height:1.45; color:{DIM}; margin:0">{body}</p>'
        f'</div>'
    )


def stat(value: str, label: str, color: str) -> str:
    return (
        f'<div style="flex:1; display:flex; flex-direction:column; gap:8px; '
        f'align-items:center; background:#141824; padding:36px; '
        f'border:1px solid #2A3040; border-radius:20px">'
        f'<p style="font-family:{DISPLAY}; font-size:76px; font-weight:700; '
        f'color:{color}; margin:0">{value}</p>'
        f'<p style="font-size:25px; color:{DIM}; margin:0; text-align:center">{label}</p>'
        f'</div>'
    )


slides = []

# 1 — cover ---------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; gap:72px; align-items:center; height:100%">'
    '<div style="flex:1; display:flex; flex-direction:column; gap:36px">'
    + kicker('Team PRXFR &middot; iQOO City Battles 2026')
    + f'<h1 style="font-family:{DISPLAY}; font-size:148px; font-weight:700; '
      f'line-height:0.95; letter-spacing:-3px; margin:0">WorldJam</h1>'
      f'<p style="font-size:44px; line-height:1.3; color:{LILAC}; margin:0">'
      'Record the real sound of anything around you. On-device AI turns it into music.</p>'
      f'<p style="font-size:30px; line-height:1.45; color:{MUTE}; margin:0">'
      'Zero bundled sounds. No network. Playable with your eyes closed.</p>'
    '<div style="display:flex; gap:16px; flex-wrap:wrap">'
    + ''.join(
        f'<p style="font-size:24px; font-weight:600; color:#0A0B10; '
        f'background:{c}; padding:12px 24px; border-radius:999px; margin:0">{t}</p>'
        for t, c in [('Android &middot; React Native', CYAN),
                     ('Gemma 4 on-device', LILAC),
                     ('Native C++ audio', PINK)])
    + '</div></div>'
    + f'<img src="{IMG["splash"]}" alt="WorldJam splash screen" '
      'style="height:880px; width:auto; object-fit:contain; border-radius:24px">'
    '</div>',
    bg='linear-gradient(135deg,#0A0B10 0%,#14102A 55%,#2A1145 100%)',
))

# 2 — problem -------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:center; '
    'gap:48px; height:100%">'
    + h2("Music apps hand you someone else's sounds")
    + '<div style="display:flex; gap:24px">'
    + card('The same sample packs',
           'Every beginner opens the same library and makes something that sounds '
           'like everyone else&rsquo;s.', '#F87171')
    + card('A studio you must learn',
           'A DAW is a wall of controls. The idea dies before the first bar is finished.',
           '#FBBF24')
    + card('AI that sends audio away',
           'Generative tools upload your recordings and need a connection to answer.',
           CYAN)
    + '</div>'
    + f'<p style="font-size:36px; line-height:1.35; color:{LILAC}; margin:0">'
      'Meanwhile every room already has instruments in it: a ceramic cup, a wooden '
      'table, a set of keys.</p>'
    '</div>',
))

# 3 — the idea ------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; gap:64px; align-items:center; height:100%">'
    '<div style="flex:1; display:flex; flex-direction:column; gap:32px">'
    + kicker('The idea')
    + h2('Anything can be a studio', 88)
    + '<div style="display:flex; flex-direction:column; gap:18px">'
    + ''.join(
        f'<div style="display:flex; gap:20px; align-items:flex-start">'
        f'<p style="font-family:{DISPLAY}; font-size:30px; font-weight:700; '
        f'color:{c}; width:64px; margin:0">{n}</p>'
        f'<p style="flex:1; font-size:29px; line-height:1.4; color:{DIM}; margin:0">'
        f'<b style="color:{INK}">{t}</b> &mdash; {d}</p></div>'
        for n, t, d, c in [
            ('01', 'Capture', 'Hold and strike an object. The phone records its real '
             'sound and measures how bright, how long and how pitched it is.', CYAN),
            ('02', 'Direct', 'Pick a vibe, or type what you want &mdash; an artist, a '
             'feeling, an instrument. Sing, and the melody becomes the song.', LILAC),
            ('03', 'Compose', 'Gemma, on the phone, arranges your sounds into a '
             'structured track with verses, builds and fills.', PINK),
        ])
    + '</div></div>'
    + f'<img src="{IMG["home"]}" alt="WorldJam home screen" '
      'style="height:860px; width:auto; object-fit:contain; border-radius:24px">'
    '</div>',
    bg='linear-gradient(140deg,#1A0B2E 0%,#0A0B10 70%)',
))

# 4 — the flow ------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; gap:34px; height:100%">'
    + h2('Four steps, one screen each', 68)
    + '<div style="display:flex; gap:22px; align-items:flex-start">'
    + ''.join(
        '<div style="flex:1; display:flex; flex-direction:column; gap:14px; '
        'align-items:center">'
        + phone(k, 620)
        + f'<p style="font-family:{DISPLAY}; font-size:27px; font-weight:700; '
          f'color:{c}; margin:0">{n}</p>'
          f'<p style="font-size:22px; line-height:1.35; color:{MUTE}; '
          f'text-align:center; margin:0">{d}</p></div>'
        for k, n, d, c in [
            ('scan2', '1 &middot; Scan', 'Point, hold, strike. The real sound is captured.', CYAN),
            ('object', '2 &middot; Customize', 'Vibe, tempo, and a box that takes plain English.', LILAC),
            ('arrange', '3 &middot; Compose', 'The arrangement, laid out on a timeline.', PINK),
            ('detail', '4 &middot; Your Jam', 'Transport, layer mixer, export.', MINT),
        ])
    + '</div></div>',
))

# 5 — blind accessibility (the heart) -------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:center; '
    'gap:40px; height:100%">'
    + kicker('Why this matters most', MINT)
    + h2('Music has no boundaries.<br>Neither should the instrument.', 72)
    + f'<p style="font-size:34px; line-height:1.45; color:{DIM}; margin:0; width:1620px">'
      'For a blind user, WorldJam is not a music app with accessibility bolted on. '
      'It is a way to <b style="color:'+MINT+'">hear the room</b>: the phone names '
      'what is in front of you, confirms every capture aloud, and places each object '
      'in the stereo field where it actually sits. The mix becomes a map of your '
      'surroundings &mdash; and then it becomes a song.</p>'
    + '<div style="display:flex; gap:24px">'
    + card('Sense the surroundings',
           'Spoken guidance describes what is nearby and confirms each recording, '
           'so a track can be built entirely by touch and sound.', MINT)
    + card('Spatial by default',
           'Objects are panned to their real position. Hearing the mix tells you '
           'where things are, not just how they sound.', CYAN)
    + card('Connect through it',
           'A jam needs no sight, no reading and no shared language. It is the '
           'least gated way two people can make something together.', LILAC)
    + '</div>'
    + f'<p style="font-size:30px; line-height:1.4; color:{MUTE}; margin:0; width:1620px">'
      'Every control carries a screen-reader label and role &mdash; including the knobs '
      'and faders, which adjust by gesture. An instrument you must watch is not an '
      'instrument.</p>'
    '</div>',
    bg='linear-gradient(135deg,#0E1A16 0%,#0A0B10 72%)',
))

# 6 — running on device ---------------------------------------------------
slides.append(slide(
    '<div style="display:flex; gap:56px; align-items:center; height:100%">'
    '<div style="flex:1; display:flex; flex-direction:column; gap:30px">'
    + kicker('Not a mockup')
    + h2('Running on the handset today', 68)
    + f'<p style="font-size:30px; line-height:1.45; color:{DIM}; margin:0">'
      'These are screenshots from the device, beside the design they were built to. '
      'Capture, playback, arrangement, sung-melody analysis, lyrics, export and '
      'session saving all work now.</p>'
    + '<div style="display:flex; gap:16px">'
    + stat('389', 'tests passing', CYAN)
    + stat('24.8', 'ms tap to sound', LILAC)
    + stat('9', 'screens shipped', PINK)
    + stat('0', 'bundled sounds', MINT)
    + '</div>'
    + f'<p style="font-size:27px; line-height:1.4; color:{MUTE}; margin:0">'
      'The last number is the point: every sound in a WorldJam track is one the '
      'user recorded.</p>'
    '</div>'
    + f'<img src="{IMG["dev_scan"]}" alt="WorldJam scan screen running on the device" '
      'style="height:840px; width:auto; object-fit:contain; border-radius:20px">'
    + f'<img src="{IMG["dev_studio"]}" alt="WorldJam studio screen running on the device" '
      'style="height:840px; width:auto; object-fit:contain; border-radius:20px">'
    '</div>',
))

# 7 — latency -------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:center; '
    'gap:40px; height:100%">'
    + kicker('Measured on device, not claimed', MINT)
    + '<div style="display:flex; align-items:baseline; gap:24px">'
      f'<h1 style="font-family:{DISPLAY}; font-size:200px; font-weight:700; '
      f'line-height:0.9; color:{MINT}; margin:0">24.8</h1>'
      f'<p style="font-size:58px; font-weight:500; color:#A7F3D0; margin:0">'
      'ms from tap to sound</p></div>'
    + f'<p style="font-size:36px; line-height:1.4; color:{DIM}; margin:0; width:1600px">'
      'Below the ~50 ms threshold where a tap stops feeling like an instrument and '
      'starts feeling like a button. The whole product rests on this number, so the '
      'app measures it live &mdash; a judge can reproduce it on the spot.</p>'
    + '<div style="display:flex; gap:20px; flex-wrap:wrap">'
    + ''.join(
        f'<p style="font-size:26px; font-weight:600; color:#0A0B10; background:{c}; '
        f'padding:14px 26px; border-radius:999px; margin:0">{t}</p>'
        for t, c in [('Oboe exclusive-mode stream', '#A7F3D0'),
                     ('Lock-free trigger ring buffer', CYAN),
                     ('Zero-allocation audio callback', LILAC),
                     ('Look-ahead scheduler', PINK)])
    + '</div></div>',
    bg='linear-gradient(120deg,#052E2B 0%,#0A0B10 65%)',
))

# 8 — architecture --------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:center; '
    'gap:44px; height:100%">'
    + h2('Three layers, each doing one job')
    + '<div style="display:flex; flex-direction:column; gap:20px">'
    + ''.join(
        '<div style="display:flex; gap:28px; align-items:center; background:#171A24; '
        'padding:36px 44px; border:1px solid #2E3342; border-radius:18px">'
        f'<p style="width:290px; font-size:32px; font-weight:700; color:{c}; margin:0">{t}</p>'
        f'<p style="flex:1; font-size:28px; line-height:1.4; color:{DIM}; margin:0">{d}</p></div>'
        for t, d, c in [
            ('Native audio',
             'C++ and Oboe, 651 lines. A lock-free ring buffer carries taps to a '
             'callback that never allocates, locks or logs.', CYAN),
            ('Signal analysis',
             'FFT, YIN pitch tracking, onset detection and Krumhansl-Schmuckler key '
             'estimation decide what each recording should be.', LILAC),
            ('On-device model',
             'Gemma 4 E2B via llama.cpp emits a validated JSON plan. A rule-based '
             'arranger answers in microseconds if it is slow.', PINK),
        ])
    + '</div>'
    + f'<p style="font-size:29px; line-height:1.4; color:{MUTE}; margin:0; width:1620px">'
      'The fallback matters: the app is fully playable before the model has answered '
      'anything, and stays playable if no model is installed at all. The status line '
      'names which arranger produced the plan.</p>'
    '</div>',
    bg='#101018',
))

# 9 — what makes it music -------------------------------------------------
slides.append(slide(
    '<div style="display:flex; gap:56px; align-items:center; height:100%">'
    '<div style="flex:1; display:flex; flex-direction:column; gap:28px">'
    + kicker('What makes it sound like music')
    + h2('A loop repeats.<br>A song goes somewhere.', 62)
    + '<div style="display:flex; flex-direction:column; gap:14px">'
    + ''.join(
        f'<div style="background:#1A1430; padding:24px 28px; border-radius:14px; '
        f'border-left:4px solid {c}">'
        f'<p style="font-size:26px; line-height:1.4; color:{DIM}; margin:0">'
        f'<b style="color:{INK}">{t}</b> &mdash; {d}</p></div>'
        for t, d, c in [
            ('Sections with per-role density',
             'A verse thins parts to their strong beats instead of muting them.', CYAN),
            ('Velocity follows the bar',
             'Flat velocity is the clearest sign something was sequenced, not played.', LILAC),
            ('Fills on every turnaround',
             'Quieter than the downbeat they lead into, so the arrival is not swallowed.', PINK),
            ('Your sung melody drives it',
             'Hum a line: it is tuned, timed, and the arrangement is built around it.', MINT),
            ('No synthetic drums',
             'Your objects are the percussion. A synth kit over them sounds canned.', '#FBBF24'),
        ])
    + '</div></div>'
    + f'<img src="{IMG["create"]}" alt="Create Your Jam screen with mood and effect controls" '
      'style="height:860px; width:auto; object-fit:contain; border-radius:24px">'
    '</div>',
    bg='linear-gradient(135deg,#2A1145 0%,#0A0B10 70%)',
))

# 10 — the product surface ------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; gap:30px; height:100%">'
    + h2('A finished product, not a demo path', 66)
    + f'<p style="font-size:28px; line-height:1.4; color:{MUTE}; margin:0">'
      'Library, track detail, publishing and sharing are designed and built, so a jam '
      'has somewhere to live after it is made.</p>'
    + '<div style="display:flex; gap:20px; align-items:flex-start">'
    + ''.join(
        '<div style="flex:1; display:flex; flex-direction:column; gap:12px; '
        'align-items:center">' + phone(k, 600)
        + f'<p style="font-size:25px; font-weight:700; color:{c}; margin:0">{n}</p>'
          f'<p style="font-size:21px; line-height:1.3; color:{MUTE}; '
          f'text-align:center; margin:0">{d}</p></div>'
        for k, n, d, c in [
            ('library', 'My Jams', 'Search, filter and stats over everything saved.', CYAN),
            ('track', 'Track Detail', 'Transport, layers, ambience, similar jams.', LILAC),
            ('publish', 'Publish', 'Covers, visibility, MP3 / WAV / MP4 export.', PINK),
            ('home2', 'Home', 'Explore sounds and pick up where you left off.', MINT),
        ])
    + '</div></div>',
))

# 11 — AR tiles roadmap ---------------------------------------------------
slides.append(slide(
    '<div style="display:flex; gap:64px; align-items:center; height:100%">'
    '<div style="flex:1; display:flex; flex-direction:column; gap:30px">'
    + kicker('What we are building next', PINK)
    + h2('AR Tiles &mdash; play the beat you just made', 64)
    + f'<p style="font-size:31px; line-height:1.45; color:{DIM}; margin:0">'
      'Your generated track becomes a game. Tiles rise through the room in AR, timed '
      'to the beats of <i>your</i> recording, and you tap them in the air with the '
      'phone. Every note you hit is the sound of your own cup, table or keys.</p>'
    + '<div style="display:flex; flex-direction:column; gap:16px">'
    + ''.join(
        f'<div style="display:flex; gap:18px; align-items:flex-start">'
        f'<p style="font-size:28px; color:{c}; margin:0">&#9679;</p>'
        f'<p style="flex:1; font-size:27px; line-height:1.4; color:{DIM}; margin:0">{t}</p></div>'
        for t, c in [
            ('The chart is generated from the arrangement, so every song plays differently.', CYAN),
            ('Scores reward timing against the 24.8&nbsp;ms audio path already built.', LILAC),
            ('An audio-only mode: tiles announced by spatial sound, playable without sight.', MINT),
            ('Share a jam and a friend plays your beat as a level.', PINK),
        ])
    + '</div>'
    + f'<p style="font-size:26px; line-height:1.4; color:{MUTE}; margin:0">'
      'The AR anchoring, spatial mixer and low-latency scheduler this needs are '
      'already in the build.</p>'
    '</div>'
    + f'<img src="{IMG["arrange"]}" alt="Arrangement timeline with 3D preview and AR toggle" '
      'style="height:860px; width:auto; object-fit:contain; border-radius:24px">'
    '</div>',
    bg='linear-gradient(140deg,#2A1145 0%,#14102A 50%,#0A0B10 100%)',
))

# 12 — rubric -------------------------------------------------------------
rows = [
    ('End product quality', '30%',
     'Runs on device now. 389 tests. Every screen reachable, every feature wired to real audio.'),
    ('Novelty and impact', '20%',
     'No sample packs. The instrument is whatever is on your desk &mdash; and it works without sight or a network.'),
    ('Creative phone use', '15%',
     'Microphone, camera, haptics and an on-device LLM are all load-bearing, not decoration.'),
    ('Technical depth', '15%',
     'Custom C++ audio engine, lock-free scheduling, FFT and pitch analysis, a validated JSON contract with a fallback.'),
    ('Office Kit usage', '10%',
     'Built and debugged phone-to-laptop throughout, with live device logs driving the fixes.'),
    ('Demo and presentation', '10%',
     'The demo is the product: tap a cup on stage, then play the song it became.'),
]
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:center; '
    'gap:36px; height:100%">'
    + h2('Against the rubric', 66)
    + '<table style="width:100%; border-collapse:collapse; font-size:26px; '
      f'color:{DIM}">'
      '<tr style="background:#1E2230">'
      f'<th style="width:26%; text-align:left; padding:16px 20px; color:{INK}; '
      'font-weight:600">Criterion</th>'
      f'<th style="width:10%; text-align:left; padding:16px 20px; color:{INK}; '
      'font-weight:600">Weight</th>'
      f'<th style="width:64%; text-align:left; padding:16px 20px; color:{INK}; '
      'font-weight:600">What WorldJam brings</th></tr>'
    + ''.join(
        f'<tr style="background:{"#171A24" if i % 2 else "transparent"}">'
        f'<td style="padding:16px 20px; color:{INK}">{c}</td>'
        f'<td style="padding:16px 20px; color:{LILAC}; font-weight:600">{w}</td>'
        f'<td style="padding:16px 20px">{d}</td></tr>'
        for i, (c, w, d) in enumerate(rows))
    + '</table>'
    + f'<p style="font-size:27px; line-height:1.4; color:{MUTE}; margin:0">'
      'The 25% read from device data is where an on-device model and real sensor use '
      'pay off &mdash; nothing there is self-reported.</p>'
    '</div>',
    bg='#101018',
))

# 13 — close --------------------------------------------------------------
slides.append(slide(
    '<div style="display:flex; flex-direction:column; justify-content:space-between; '
    'height:100%">'
    + kicker('What happens on stage')
    + '<div style="display:flex; flex-direction:column; gap:30px">'
    + h2('Hand us any object.<br>We will make a song out of it.', 92)
    + f'<p style="font-size:36px; line-height:1.4; color:{DIM}; margin:0; width:1500px">'
      'Three minutes: record two objects from the judging table, hum eight bars, and '
      'play back the track the phone composed &mdash; with no connection and nothing '
      'pre-loaded. Then close your eyes and play it again.</p>'
    '</div>'
    '<div style="display:flex; gap:24px; align-items:center">'
    f'<p style="font-size:28px; font-weight:700; color:#0A0B10; background:{CYAN}; '
    'padding:16px 30px; border-radius:999px; margin:0">Team PRXFR</p>'
    f'<p style="font-size:28px; color:{LILAC}; margin:0">'
    'WorldJam &middot; Anything can be a studio</p>'
    '</div></div>',
    bg='linear-gradient(135deg,#2A1145 0%,#14102A 45%,#0A0B10 100%)',
))

doc = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WorldJam - iQOO City Battles 2026</title>
<style>
  @page {{ size: 20in 11.25in; margin: 0; }}
  html, body {{ margin:0; padding:0; background:#000; }}
  section {{
    width:1920px; height:1080px; box-sizing:border-box;
    page-break-after: always; break-after: page;
    overflow:hidden; position:relative;
  }}
  section:last-child {{ page-break-after: auto; break-after: auto; }}
  h1,h2,h3,p {{ margin:0; }}
  table {{ border-collapse:collapse; }}
  td, th {{ border-bottom:1px solid rgba(255,255,255,0.08); vertical-align:top; }}
</style></head><body>
{chr(10).join(slides)}
</body></html>"""

out_html = os.path.join(ROOT, 'WorldJam-Deck.html')
with open(out_html, 'w', encoding='utf-8') as fh:
    fh.write(doc)
print(f'slides: {len(slides)}')
print(f'html: {os.path.getsize(out_html) / 1048576:.2f} MB -> {out_html}')

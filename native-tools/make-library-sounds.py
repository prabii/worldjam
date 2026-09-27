"""Synthesises the object sounds that ship with WorldJam (assets/library/*.wav).

Physical-model style: pitch-dropping membranes for knocks, inharmonic partials
for metal and glass, Karplus-Strong for a plucked band, breath-noise tones for
a blown bottle, and a formant voice for the hummed melody. 48 kHz mono, 16-bit.
Run: python native-tools/make-library-sounds.py
"""
import os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter, sosfilt

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'library')
rng = np.random.default_rng(7)


def t(sec):
    return np.arange(int(sec * SR)) / SR


def env(n, attack=0.002, decay=0.3):
    x = np.arange(n) / SR
    a = np.clip(x / max(attack, 1e-4), 0, 1)
    return a * np.exp(-x / decay)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return sosfilt(sos, x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype='high', fs=SR, output='sos'), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=SR, output='sos'), x)


def place(total_sec, hits):
    out = np.zeros(int(total_sec * SR))
    for at, sig, g in hits:
        i = int(at * SR)
        j = min(len(out), i + len(sig))
        out[i:j] += sig[: j - i] * g
    return out


def save(name, x):
    x = x - np.mean(x)
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.89
    fade = int(0.01 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    wavfile.write(os.path.join(OUT, name), SR, (x * 32767).astype(np.int16))
    print(f'{name}: {len(x) / SR:.2f}s')


def knock():
    # Knuckle on a wooden desk: low body thump with a fast pitch drop + a woody click.
    n = t(0.45)
    f = 150 * np.exp(-n / 0.05) + 62
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(n), 0.001, 0.12)
    click = bp(rng.standard_normal(len(n)), 1500, 4500) * env(len(n), 0.0005, 0.008) * 0.6
    wood = bp(rng.standard_normal(len(n)), 300, 900) * env(len(n), 0.001, 0.04) * 0.5
    one = body + click + wood
    return place(2.0, [(0.02, one, 1.0), (0.52, one, 0.8), (1.02, one, 0.95), (1.52, one, 0.75)])


def can():
    # Pen on a steel can: bright inharmonic ring + snappy noise.
    n = t(0.5)
    partials = [(820, 1.0), (1370, 0.7), (2140, 0.5), (3310, 0.35), (4780, 0.2)]
    ring = sum(a * np.sin(2 * np.pi * f * n + rng.uniform(0, 6)) * np.exp(-n / (0.09 + 0.05 * a)) for f, a in partials)
    snap = bp(rng.standard_normal(len(n)), 1800, 7000) * env(len(n), 0.0005, 0.05)
    one = ring * 0.6 + snap * 0.8
    return place(2.0, [(0.02, one, 1.0), (0.5, one, 0.9), (1.0, one, 1.0), (1.5, one, 0.85)])


def keys():
    # Key ring shaken: clusters of tiny high metallic ticks.
    n = t(0.12)
    def tick():
        f = rng.uniform(4500, 9000)
        return np.sin(2 * np.pi * f * n) * np.exp(-n / 0.02) + hp(rng.standard_normal(len(n)), 6000) * np.exp(-n / 0.01) * 0.5
    hits = []
    for beat in range(8):
        for k in range(rng.integers(2, 5)):
            hits.append((0.02 + beat * 0.25 + k * rng.uniform(0.004, 0.02), tick(), rng.uniform(0.4, 1.0)))
    return place(2.1, hits)


def shaker():
    # Rice in a jar: grains of noise with a swaying envelope, eighth-note strokes.
    out = np.zeros(int(2.1 * SR))
    for s in range(8):
        n = t(0.22)
        grains = hp(rng.standard_normal(len(n)), 3500) * (rng.random(len(n)) < 0.3)
        e = np.sin(np.pi * np.clip(n / 0.2, 0, 1)) ** 2
        i = int((0.02 + s * 0.25) * SR)
        out[i:i + len(n)] += grains * e * (1.0 if s % 2 == 0 else 0.7)
    return lp(out, 11000)


def snap():
    # Finger snap: very short bright crack with a tiny room tail.
    n = t(0.35)
    crack = bp(rng.standard_normal(len(n)), 1200, 6500) * env(len(n), 0.0003, 0.012)
    tail = bp(rng.standard_normal(len(n)), 800, 3000) * env(len(n), 0.002, 0.07) * 0.15
    one = crack + tail
    return place(1.6, [(0.02, one, 1.0), (0.8, one, 0.9)])


def glass():
    # Spoon on a wine glass: clear bell partials, long ring (E6).
    n = t(2.4)
    f0 = 1318.5
    ratios = [(1.0, 1.0, 1.4), (2.32, 0.35, 0.8), (4.25, 0.18, 0.4), (6.63, 0.08, 0.25)]
    x = sum(a * np.sin(2 * np.pi * f0 * r * n) * np.exp(-n / d) for r, a, d in ratios)
    x += bp(rng.standard_normal(len(n)), 2000, 8000) * env(len(n), 0.0003, 0.004) * 0.3
    return x * np.clip(n / 0.001, 0, 1)


def bottle():
    # Blowing across a bottle: breathy sustained A3 with gentle vibrato.
    n = t(3.0)
    f = 220 * (1 + 0.004 * np.sin(2 * np.pi * 5.2 * n))
    phase = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(phase) + 0.18 * np.sin(2 * phase) + 0.06 * np.sin(3 * phase)
    breath = bp(rng.standard_normal(len(n)), 180, 1400) * 0.12
    a = np.clip(n / 0.25, 0, 1) * np.clip((3.0 - n) / 0.5, 0, 1)
    return (tone + breath) * a


def band():
    # Rubber band plucked over a box: Karplus-Strong string at A2, played as a riff.
    def pluck(freq, dur=0.9):
        N = int(SR / freq)
        buf = rng.uniform(-1, 1, N)
        out = np.zeros(int(dur * SR))
        for i in range(len(out)):
            out[i] = buf[i % N]
            buf[i % N] = 0.996 * 0.5 * (buf[i % N] + buf[(i + 1) % N])
        return lp(out, 2500)
    notes = [(0.02, 110.0), (0.52, 110.0), (1.02, 130.8), (1.52, 98.0)]
    return place(2.4, [(at, pluck(f), 1.0) for at, f in notes])


def hum():
    # A hummed tune: voiced source through "mm" formants, A minor at 90 BPM.
    beat = 60 / 90
    melody = [(69, 1), (72, 1), (71, 0.5), (69, 0.5), (67, 1), (64, 1.5), (65, 0.5), (67, 1), (69, 2)]
    total = sum(d for _, d in melody) * beat + 0.4
    n = t(total)
    freq = np.zeros(len(n))
    amp = np.zeros(len(n))
    pos = 0.1
    for midi, d in melody:
        i, j = int(pos * SR), int((pos + d * beat) * SR)
        freq[i:j] = 440 * 2 ** ((midi - 69) / 12) / 2  # an octave down: a hummed voice
        k = j - i
        a = np.ones(k)
        r = min(int(0.06 * SR), k // 3)
        a[:r] = np.linspace(0, 1, r)
        a[-r:] = np.linspace(1, 0.3, r)
        amp[i:j] = a
        pos += d * beat
    freq[freq == 0] = 220
    # Slide between notes like a real voice.
    freq = lp(freq, 12, order=1)
    freq *= 1 + 0.006 * np.sin(2 * np.pi * 5.5 * n)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    src = sum(np.sin(k * phase) / k ** 1.3 for k in range(1, 14))
    voiced = bp(src, 180, 400) * 1.0 + bp(src, 900, 1300) * 0.25 + bp(src, 2400, 2800) * 0.06
    breath = bp(rng.standard_normal(len(n)), 300, 3000) * 0.01
    return (voiced + breath) * lp(amp, 30, order=1)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save('desk-knock.wav', knock())
    save('steel-can.wav', can())
    save('key-ring.wav', keys())
    save('rice-jar.wav', shaker())
    save('finger-snap.wav', snap())
    save('wine-glass.wav', glass())
    save('bottle-note.wav', bottle())
    save('rubber-band.wav', band())
    save('evening-hum.wav', hum())

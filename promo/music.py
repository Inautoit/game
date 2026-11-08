"""Música original para el vídeo de Isla Rodante (sintetizada, sin derechos de terceros).

Uso: python3 -I music.py <timeline.json> <salida.wav>
"""
import json, sys, wave
import numpy as np

tl = json.load(open(sys.argv[1]))
SR = 44100
DUR = tl['frames'] / tl['fps'] + 0.3
N = int(SR * DUR)
BPM = 120
BEAT = 60 / BPM
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))

cuts = [e['cut'] for e in tl['events'] if 'cut' in e]
win = next((e['win'] for e in tl['events'] if 'win' in e), None)
GAME_START = cuts[0] if cuts else 3.0       # entra la batería
END_CARD = cuts[-1] if cuts else DUR - 3.5  # cartel final

def note(n):  # MIDI -> Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(length, a=0.005, d=0.25, s=0.0, r=0.05):
    t = np.arange(length) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    tail = int(r * SR)
    if tail and length > tail:
        e[-tail:] *= np.linspace(1, 0, tail)
    return e

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    mix[i:i + len(sig), 0] += sig * (1 - max(0, pan))
    mix[i:i + len(sig), 1] += sig * (1 + min(0, pan))

def osc(freq, length, kind='tri'):
    t = np.arange(length) / SR
    ph = (freq * t) % 1.0
    if kind == 'tri':
        return 2 * np.abs(2 * ph - 1) - 1
    if kind == 'saw':
        return 2 * ph - 1
    if kind == 'sq':
        return np.where(ph < 0.5, 1.0, -1.0)
    return np.sin(2 * np.pi * freq * t)

# Progresión alegre: C - G - Am - F (un acorde por compás)
CHORDS = [(60, [60, 64, 67]), (55, [55, 59, 62]), (57, [57, 60, 64]), (53, [53, 57, 60])]
BAR = BEAT * 4

t = 0.0
bar = 0
while t < DUR:
    root, tones = CHORDS[bar % 4]
    playing_end = t >= END_CARD
    # Pad suave
    L = int(BAR * SR)
    pad = sum(osc(note(n), L, 'saw') * 0.5 + osc(note(n) * 1.003, L, 'saw') * 0.5 for n in tones) / 3
    k = np.ones(L); a = int(0.3 * SR); k[:a] = np.linspace(0, 1, a); k[-a:] = np.linspace(1, 0, a)
    pad = np.convolve(pad, np.ones(24) / 24, mode='same')  # filtro paso bajo sencillo
    add(pad * k, t, gain=0.05)
    # Arpegio en semicorcheas
    arp = tones + [tones[0] + 12, tones[1] + 12, tones[2] + 12, tones[1] + 12, tones[0] + 12]
    for i in range(16):
        n = arp[i % len(arp)] + 12
        L2 = int(BEAT / 4 * SR * 0.95)
        s = osc(note(n), L2, 'tri') * env(L2, d=0.09)
        add(s, t + i * BEAT / 4, pan=0.35 if i % 2 else -0.35, gain=0.11 if t >= GAME_START else 0.08)
    if t >= GAME_START and not playing_end:
        # Bajo en corcheas
        for i in range(8):
            L3 = int(BEAT / 2 * SR * 0.9)
            s = (osc(note(root - 24), L3, 'sq') * 0.4 + osc(note(root - 24), L3, 'sin') * 0.8) * env(L3, d=0.18, s=0.3)
            s = np.convolve(s, np.ones(12) / 12, mode='same')
            add(s, t + i * BEAT / 2, gain=0.22)
        # Batería: bombo en cada pulso, caja en 2 y 4, charles a contratiempo
        for i in range(4):
            bt = t + i * BEAT
            L4 = int(0.22 * SR); tt = np.arange(L4) / SR
            kick = np.sin(2 * np.pi * (45 * tt + (110 - 45) * (1 - np.exp(-tt * 28)) / 28)) * np.exp(-tt * 14)
            add(kick, bt, gain=0.55)
            if i % 2 == 1:
                L5 = int(0.18 * SR)
                sn = rng.standard_normal(L5) * np.exp(-np.arange(L5) / SR * 22)
                sn = sn - np.convolve(sn, np.ones(6) / 6, mode='same')
                add(sn + osc(190, L5, 'sin') * np.exp(-np.arange(L5) / SR * 30) * 0.5, bt, gain=0.22)
            L6 = int(0.05 * SR)
            hh = rng.standard_normal(L6) * np.exp(-np.arange(L6) / SR * 80)
            hh = hh - np.convolve(hh, np.ones(3) / 3, mode='same')
            add(hh, bt + BEAT / 2, pan=0.2, gain=0.12)
    t += BAR
    bar += 1

# Golpe de transición en cada corte
for c in cuts:
    L = int(0.35 * SR)
    sw = rng.standard_normal(L) * np.linspace(0, 1, L) ** 2
    sw = np.convolve(sw, np.ones(8) / 8, mode='same')
    add(sw, max(0, c - 0.35), gain=0.08)
    L = int(0.4 * SR)
    add(osc(note(84), L, 'sin') * env(L, d=0.12), c, gain=0.05)

# Destello de victoria
if win:
    for i, n in enumerate([72, 76, 79, 84, 88, 91]):
        L = int(0.35 * SR)
        add(osc(note(n), L, 'tri') * env(L, d=0.2), win + i * 0.07, pan=(-0.3 + 0.12 * i), gain=0.16)
    for i in range(3):  # estrellas del panel (~1,1 s después)
        L = int(0.3 * SR)
        add(osc(note(79 + i * 4), L, 'tri') * env(L, d=0.15), win + 1.35 + i * 0.23, gain=0.14)

# Acorde final
L = int(min(3.0, DUR - END_CARD) * SR)
fin = sum(osc(note(n), L, 'tri') for n in [60, 64, 67, 72]) / 4 * env(L, a=0.02, d=1.2, s=0.15, r=0.6)
add(fin, END_CARD + 0.1, gain=0.3)

# Mezcla final: normaliza, compresión suave y fundidos
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
fi, fo = int(0.15 * SR), int(1.2 * SR)
mix[:fi] *= np.linspace(0, 1, fi)[:, None]
mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
pcm = (mix * 0.89 * 32767).astype(np.int16)
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('música', round(DUR, 2), 's')

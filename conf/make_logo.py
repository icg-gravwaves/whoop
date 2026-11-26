"""Build the Whoop! logo templates: a speech bubble holding a GW150914-like chirp.

The waveform is a simple phenomenological model of GW150914, not a numerical-relativity
waveform: a leading-order (Newtonian) inspiral for a detector-frame chirp mass of
30.4 M_sun, with amplitude rising as f^(2/3), joined at merger to a ringdown of the
final ~62 M_sun, spin ~0.67 black hole (f ~ 251 Hz, damping time ~ 4 ms).
Colours are palette placeholders filled in by sync_palette.py.
"""
import logging
import math
from pathlib import Path

logging.basicConfig(level=logging.INFO)
TEMPLATES = Path(__file__).resolve().parent / 'templates'

MSUN_S = 4.925491e-6           # G M_sun / c^3 in seconds
CHIRP_MASS = 30.4 * MSUN_S     # detector-frame chirp mass
F_START, F_MERGE = 42.0, 150.0  # Hz: start of drawn window, frequency at peak amplitude
F_RD, TAU_RD = 251.0, 0.004     # ringdown frequency (Hz) and damping time (s)
T_AFTER = 0.025                 # seconds of ringdown drawn after the peak
RATE = 16384


def time_to_merger(f):
    """Leading-order time before coalescence at gravitational-wave frequency f."""
    return 5 / 256 * CHIRP_MASS ** (-5 / 3) * (math.pi * f) ** (-8 / 3)


def waveform():
    """Return (t, h) samples, t = 0 at peak amplitude, h normalised to peak 1."""
    t0 = time_to_merger(F_START) - time_to_merger(F_MERGE)
    out, phase, t = [], 0.0, -t0
    while t <= T_AFTER:
        if t < 0:
            # Inspiral: invert t(f) measured from the merger frequency.
            f = (256 / 5 * CHIRP_MASS ** (5 / 3) * (time_to_merger(F_MERGE) - t)) ** (-3 / 8) / math.pi
            amp = (f / F_MERGE) ** (2 / 3)
        else:
            # Ringdown: frequency eases from merger to ringdown value, amplitude decays.
            f = F_RD - (F_RD - F_MERGE) * math.exp(-t / 0.0015)
            amp = math.exp(-t / TAU_RD)
        phase += 2 * math.pi * f / RATE
        out.append((t, amp * math.cos(phase)))
        t += 1 / RATE
    logging.debug('waveform: %d samples, %.3f s', len(out), t0 + T_AFTER)
    return out


def polyline(x0, x1, yc, amp, points=600):
    """Waveform as an SVG path, linear in time between x0 and x1."""
    h = waveform()
    step = max(1, len(h) // points)
    t_first, t_last = h[0][0], h[-1][0]
    xy = [(x0 + (x1 - x0) * (t - t_first) / (t_last - t_first), yc - amp * v) for t, v in h[::step]]
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in xy)


BUBBLE = ('M20 14h56a10 10 0 0 1 10 10v36a10 10 0 0 1 -10 10h-34l-16 15v-15h-6'
          'a10 10 0 0 1 -10 -10v-36a10 10 0 0 1 10 -10z')


def mark(title):
    """96x96 transparent mark: bubble outline in accent, chirp in signal blue."""
    wave = polyline(13.5, 82.5, 42, 23.5)
    return (f'<title id="title">{title}</title>'
            f'<path d="{BUBBLE}" fill="none" stroke="{{{{accent}}}}" stroke-width="5" stroke-linejoin="round"/>'
            f'<path d="{wave}" fill="none" stroke="{{{{signal}}}}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>')


def main():
    title = 'Whoop!: a speech bubble holding the GW150914 chirp'
    (TEMPLATES / 'whoop.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-labelledby="title">'
        + mark(title) + '</svg>\n')
    (TEMPLATES / 'whoop-mark.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-labelledby="title">'
        '<rect width="320" height="320" rx="68" fill="{{bg}}"/><g transform="translate(40 36) scale(2.5)">'
        + mark('Whoop! logo') + '</g></svg>\n')
    logging.info('wrote logo templates to %s', TEMPLATES)


if __name__ == '__main__':
    main()

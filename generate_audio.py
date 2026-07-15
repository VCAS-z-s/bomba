import math
import os
import random
import struct
import wave
import zlib

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")
SAMPLE_RATE = 44100


def ensure_assets_dir():
    os.makedirs(ASSETS_DIR, exist_ok=True)


def clamp(sample):
    return max(-0.98, min(0.98, sample))


def apply_fade(samples, fade_in_s, fade_out_s):
    fade_in_frames = max(1, int(fade_in_s * SAMPLE_RATE))
    fade_out_frames = max(1, int(fade_out_s * SAMPLE_RATE))
    total = len(samples)

    for index in range(total):
        sample = samples[index]
        if index < fade_in_frames:
            sample *= index / fade_in_frames
        if index >= total - fade_out_frames:
            sample *= max(0.0, (total - index - 1) / fade_out_frames)
        samples[index] = sample


def write_wav(path, samples):
    pcm_frames = bytearray()
    for sample in samples:
        value = int(clamp(sample) * 32767)
        pcm_frames.extend(struct.pack("<h", value))

    with wave.open(path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(bytes(pcm_frames))


def tone(frequency, duration_s, amplitude=1.0, phase=0.0):
    frame_count = int(duration_s * SAMPLE_RATE)
    return [
        amplitude * math.sin((2.0 * math.pi * frequency * index / SAMPLE_RATE) + phase)
        for index in range(frame_count)
    ]


def white_noise(duration_s, amplitude=1.0):
    frame_count = int(duration_s * SAMPLE_RATE)
    return [amplitude * random.uniform(-1.0, 1.0) for _ in range(frame_count)]


def mix_layers(*layers):
    longest = max(len(layer) for layer in layers)
    mixed = [0.0] * longest
    for layer in layers:
        for index, sample in enumerate(layer):
            mixed[index] += sample
    return mixed


def normalize(samples, peak=0.96):
    max_value = max((abs(sample) for sample in samples), default=0.0)
    if max_value <= 0.0:
        return samples
    scale = peak / max_value
    return [sample * scale for sample in samples]


def soft_clip(samples, drive=1.0):
    clipped = []
    for sample in samples:
        clipped.append(math.tanh(sample * drive) / math.tanh(drive))
    return clipped


def low_pass(samples, smoothing=0.18):
    filtered = []
    previous = 0.0
    for sample in samples:
        previous += (sample - previous) * smoothing
        filtered.append(previous)
    return filtered


def envelope(samples, attack_s, decay_s):
    attacked = max(1, int(attack_s * SAMPLE_RATE))
    decayed = max(1, int(decay_s * SAMPLE_RATE))
    total = len(samples)
    shaped = []
    for index, sample in enumerate(samples):
        if index < attacked:
            gain = index / attacked
        else:
            distance = min(index - attacked, decayed)
            gain = math.exp(-3.6 * distance / decayed)
        if index > total - decayed:
            gain *= max(0.0, (total - index - 1) / decayed)
        shaped.append(sample * gain)
    return shaped


def generate_tick():
    beat_duration = 0.5
    hit = tone(1800, 0.016, amplitude=0.72)
    body = tone(940, 0.048, amplitude=0.36, phase=0.3)
    resonance = tone(280, 0.07, amplitude=0.18)
    noise = low_pass(white_noise(0.05, amplitude=0.09), smoothing=0.24)

    impact = mix_layers(
        hit + [0.0] * (int((beat_duration - 0.016) * SAMPLE_RATE)),
        body + [0.0] * (int((beat_duration - 0.048) * SAMPLE_RATE)),
        resonance + [0.0] * (int((beat_duration - 0.07) * SAMPLE_RATE)),
        noise + [0.0] * (int((beat_duration - 0.05) * SAMPLE_RATE)),
    )

    apply_fade(impact, 0.001, 0.07)
    return [sample * 0.68 for sample in impact]


def generate_explosion():
    duration_s = 1.95
    frame_count = int(duration_s * SAMPLE_RATE)

    sub_boom = envelope(tone(41, duration_s, amplitude=1.12), 0.001, 1.6)
    low_boom = envelope(tone(55, duration_s, amplitude=0.92, phase=0.2), 0.002, 1.42)
    mid_boom = envelope(tone(88, duration_s, amplitude=0.54, phase=0.7), 0.002, 1.12)
    punch = envelope(tone(128, duration_s, amplitude=0.26, phase=0.4), 0.001, 0.44)

    crack = envelope(tone(2100, 0.13, amplitude=0.42), 0.0006, 0.12)
    crack.extend([0.0] * (frame_count - len(crack)))

    slap = envelope(tone(940, 0.18, amplitude=0.34, phase=0.5), 0.0008, 0.14)
    slap.extend([0.0] * (frame_count - len(slap)))

    attack_noise = low_pass(white_noise(duration_s, amplitude=1.22), smoothing=0.038)
    attack_noise = envelope(attack_noise, 0.0008, 1.2)

    tail_noise = low_pass(white_noise(duration_s, amplitude=0.62), smoothing=0.014)
    tail_noise = envelope(tail_noise, 0.01, 1.9)

    wave_samples = mix_layers(
        sub_boom, low_boom, mid_boom, punch, crack, slap, attack_noise, tail_noise
    )
    apply_fade(wave_samples, 0.001, 0.18)
    wave_samples = soft_clip(wave_samples, drive=1.45)
    return normalize(wave_samples, peak=0.97)


def png_chunk(chunk_type, payload):
    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)
    )


def write_png(path, size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            dx = (x - size / 2) / (size / 2)
            dy = (y - size * 0.58) / (size / 2)
            distance = math.sqrt(dx * dx + dy * dy)

            r = 255
            g = 205
            b = 120
            a = 255

            if distance < 0.42:
                shade = max(0.0, min(1.0, 1.0 - distance / 0.42))
                r = int(18 + 52 * shade)
                g = int(20 + 56 * shade)
                b = int(25 + 68 * shade)
            elif distance < 0.6:
                shade = max(0.0, min(1.0, 1.0 - (distance - 0.42) / 0.18))
                r = int(205 + 46 * shade)
                g = int(129 + 68 * shade)
                b = int(61 + 28 * shade)
            else:
                a = 0

            fuse = y < int(size * 0.28) and abs(x - int(size * 0.68)) < int(size * 0.04)
            fuse = fuse or (
                y < int(size * 0.34)
                and abs((x - int(size * 0.68)) + (y - size * 0.28) * 0.55) < int(size * 0.03)
            )
            spark = (x - int(size * 0.82)) ** 2 + (y - int(size * 0.18)) ** 2 < int(size * 0.04) ** 2

            if fuse:
                r, g, b, a = 222, 225, 231, 255
            if spark:
                r, g, b, a = 255, 207, 102, 255

            pixels.extend((r, g, b, a))

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
    png.extend(png_chunk(b"IDAT", zlib.compress(bytes(pixels), level=9)))
    png.extend(png_chunk(b"IEND", b""))

    with open(path, "wb") as png_file:
        png_file.write(png)


def write_svg_icon(path):
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Bomba">
  <defs>
    <linearGradient id="bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffd166"/>
      <stop offset="100%" stop-color="#e58f3d"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <circle cx="64" cy="76" r="34" fill="#1e1518"/>
  <circle cx="51" cy="65" r="6" fill="#9da5b1" opacity="0.9"/>
  <path d="M74 39c5-9 12-15 21-19" stroke="#1e1518" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M91 18c8 1 15 7 17 15" stroke="#1e1518" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M98 31c5 0 10 2 14 6" stroke="#1e1518" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="103" cy="24" r="8" fill="#ffd166"/>
</svg>
"""
    with open(path, "w", encoding="utf-8") as svg_file:
        svg_file.write(svg)


def main():
    ensure_assets_dir()
    tick_path = os.path.join(ASSETS_DIR, "tick.wav")
    explosion_path = os.path.join(ASSETS_DIR, "explosion.wav")
    icon_192_path = os.path.join(ASSETS_DIR, "icon-192.png")
    icon_512_path = os.path.join(ASSETS_DIR, "icon-512.png")
    icon_svg_path = os.path.join(ASSETS_DIR, "icon.svg")

    write_wav(tick_path, generate_tick())
    write_wav(explosion_path, generate_explosion())
    write_png(icon_192_path, 192)
    write_png(icon_512_path, 512)
    write_svg_icon(icon_svg_path)

    print("Vygenerováno:")
    for output_path in (tick_path, explosion_path, icon_192_path, icon_512_path, icon_svg_path):
        print(f"- {output_path} ({os.path.getsize(output_path)} B)")


if __name__ == "__main__":
    random.seed(7)
    main()

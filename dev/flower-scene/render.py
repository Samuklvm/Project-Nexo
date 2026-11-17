"""
Campo de flores do Nexo: o fundo animado do app e do instalador (arte original do projeto).

Por cima do vídeo do espaço (assets/space/espaco*.mp4, que já é um loop perfeito de 30 s), desenha:
  - três morros no horizonte (o de trás mais claro, com a névoa azul que sobe do campo);
  - um tapete de pontinhos de luz ao longe (as flores distantes);
  - flores azuis que brilham, pintadas pétala por pétala (degradê do centro claro para a borda funda, nervura e miolo),
    no meio de tufos de capim que balançam e cobrem parte delas;
  - flores grandes desfocadas nos cantos, como numa lente;
  - pétalas levadas pelo vento e vaga-lumes.
Todo movimento tem um número inteiro de ciclos no loop, então o último quadro emenda no primeiro, como no espaço.

Uso: python3 dev/flower-scene/render.py <espaco.mp4> <saída.mp4> [--scale 1|2] [--frame N --still saída.png]
(1920×1080 com --scale 1 e 3840×2160 com --scale 2; as medidas abaixo são da versão Full HD e crescem com a escala.)
"""
import argparse
import math
import subprocess

import cv2
import numpy as np

BASE_W, BASE_H = 1920, 1080
FPS = 30
SECONDS = 30
FRAMES = FPS * SECONDS
TAU = 2 * math.pi
SPRITE = 256


def bgr(hex_color):
    value = hex_color.lstrip('#')
    r, g, b = (int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return np.array([b, g, r], np.float32)


PETAL_CORE = bgr('#d6f0ff')
PETAL_MID = bgr('#5ea8ff')
PETAL_EDGE = bgr('#2346c8')
PETAL_DEEP = bgr('#1a2a8a')
HEART = bgr('#fff1c4')
STEM = bgr('#06161f')
HILL_FAR = bgr('#0a1430')
HILL_MID = bgr('#08122b')
GROUND_NEAR = bgr('#060c1e')
GROUND_DEEP = bgr('#020409')
BLADE = bgr('#081428')
BLADE_TIP = bgr('#173462')
FIREFLY = bgr('#d9ff9c')
HAZE = bgr('#2a5cd6')


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def make_sprite(petals, hue, seed):
    """Uma flor vista de frente, em RGBA pré-multiplicado, e o mapa de brilho dela."""
    rng = np.random.default_rng(seed)
    n = SPRITE
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    cx = cy = (n - 1) / 2
    dx, dy = x - cx, y - cy
    rho = np.hypot(dx, dy) / (n / 2)
    theta = np.arctan2(dy, dx)
    k = theta * petals / TAU
    a = (k - np.round(k))  # -0.5..0.5: posição dentro da pétala
    idx = np.round(k).astype(np.int32) % petals
    jitter = rng.uniform(0.9, 1.0, petals)[idx]
    width = 0.56
    shape = np.sqrt(np.clip(1 - (a / width) ** 2, 0, 1))
    notch = 1 - 0.10 * np.exp(-(a / 0.07) ** 2)  # pontinha em coração
    R = 0.94 * jitter * shape ** 0.55 * notch
    R = np.maximum(R, 0.001)
    t = rho / R
    alpha = 1 - smoothstep(0.96, 1.0, t)
    alpha *= (shape > 0)
    # Cor: centro claro, azul vivo no meio, borda funda; as laterais da pétala um pouco mais escuras (dobra).
    c1 = smoothstep(0.08, 0.55, t)[..., None]
    c2 = smoothstep(0.62, 1.0, t)[..., None]
    color = PETAL_CORE * (1 - c1) + PETAL_MID * c1
    color = color * (1 - c2) + PETAL_EDGE * c2
    side = smoothstep(0.18, 0.5, np.abs(a))[..., None]
    color = color * (1 - 0.45 * side) + PETAL_DEEP * 0.45 * side
    vein = np.exp(-(a / 0.018) ** 2) * smoothstep(0.15, 0.3, t) * (1 - smoothstep(0.75, 0.95, t))
    color = color + vein[..., None] * 0.18
    # Variação de tom (mais violeta ou mais ciano).
    color = color * np.array([1 + hue * 0.6, 1 - abs(hue) * 0.4, 1 - hue * 0.8], np.float32)
    # Miolo: um disco claro e um anel de pontinhos.
    heart = 1 - smoothstep(0.10, 0.14, rho)
    ring = np.zeros_like(rho)
    for i in range(petals * 2):
        ang = TAU * i / (petals * 2) + 0.2
        px, py = cx + math.cos(ang) * 0.17 * n / 2, cy + math.sin(ang) * 0.17 * n / 2
        ring = np.maximum(ring, 1 - smoothstep(2.0, 3.6, np.hypot(x - px, y - py)))
    color = color * (1 - heart[..., None]) + HEART * heart[..., None]
    color = color * (1 - ring[..., None] * 0.8) + HEART * 0.9 * ring[..., None] * 0.8
    alpha = np.maximum(alpha, heart)
    glow = ((1 - smoothstep(0.0, 0.85, t)) ** 1.4 * alpha)[..., None] * (PETAL_CORE * 0.6 + PETAL_MID * 0.4) + heart[..., None] * HEART * 0.6
    color = np.clip(color, 0, 1) * alpha[..., None]
    return np.dstack([color, alpha]).astype(np.float32), glow.astype(np.float32)


def stamp(canvas, glow_canvas, sprite, glow, cx, cy, radius, rot, tilt, light):
    """Cola a flor (girada, achatada pela inclinação) na tela, só na região dela."""
    s = radius / (SPRITE / 2)
    c, si = math.cos(rot), math.sin(rot)
    # Matriz: sprite -> tela (girar depois de achatar em y).
    A = np.array([[c * s, -si * s * tilt], [si * s, c * s * tilt]], np.float32)
    half = SPRITE / 2
    ext = abs(A[0, 0]) * half + abs(A[0, 1]) * half, abs(A[1, 0]) * half + abs(A[1, 1]) * half
    x0, y0 = int(math.floor(cx - ext[0])) - 1, int(math.floor(cy - ext[1])) - 1
    x1, y1 = int(math.ceil(cx + ext[0])) + 2, int(math.ceil(cy + ext[1])) + 2
    H, W = canvas.shape[:2]
    X0, Y0, X1, Y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if X1 <= X0 or Y1 <= Y0:
        return
    M = np.zeros((2, 3), np.float32)
    M[:, :2] = A
    M[:, 2] = np.array([cx - X0, cy - Y0], np.float32) - A @ np.array([half, half], np.float32)
    size = (X1 - X0, Y1 - Y0)
    patch = cv2.warpAffine(sprite, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    gpatch = cv2.warpAffine(glow, M, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    eight = canvas.dtype == np.uint8
    region = canvas[Y0:Y1, X0:X1].astype(np.float32) / 255 if eight else canvas[Y0:Y1, X0:X1]
    a = patch[..., 3:4]
    region[..., :3] = region[..., :3] * (1 - a) + patch[..., :3] * light
    region[..., 3:4] = region[..., 3:4] * (1 - a) + a
    if eight:
        canvas[Y0:Y1, X0:X1] = np.clip(region * 255 + 0.5, 0, 255).astype(np.uint8)
    glow_canvas[Y0:Y1, X0:X1] += gpatch * light


class Scene:
    def __init__(self, scale, seed=11):
        self.S = scale
        self.W, self.H = W, H = BASE_W * scale, BASE_H * scale
        S = scale
        rng = np.random.default_rng(seed)
        self.sprites = [make_sprite(p, h, i) for i, (p, h) in enumerate([(5, 0.0), (5, 0.12), (5, -0.1), (6, 0.05), (5, 0.2), (6, -0.06)])]
        # Morros: (altura base, ondulação, cor, maciez da borda).
        self.hills = [
            (0.640, [(0.018, 0.7, 0.1), (0.010, 2.1, 0.6)], HILL_FAR, 2.5),
            (0.675, [(0.022, 0.9, 0.4), (0.008, 2.7, 0.2)], HILL_MID, 1.8),
            (0.715, [(0.020, 0.6, 0.8), (0.010, 1.9, 0.3)], GROUND_NEAR, 1.4),
        ]
        self.static = self.make_static()
        # Tapete de luz ao longe (flores distantes): pontinhos que respiram devagar.
        self.specks = []
        for i in range(1300):
            x = rng.uniform(0, W)
            hill = 0 if i < 500 else 1  # o morro de trás também tem flores, menores e mais apagadas
            top = self.hill_y(hill, x)
            y = top + rng.uniform(2, 70 if hill else 45) * S * rng.uniform(0.3, 1.0)
            light = rng.uniform(0.25, 0.8) * (0.6 if hill == 0 else 1.0)
            self.specks.append((x, y, rng.uniform(0.5, 1.4) * S * (0.7 if hill == 0 else 1.0) * (1 + (y - top) / (60 * S)), light, int(rng.integers(1, 4)), rng.uniform(0, TAU)))
        # Itens do campo (flores e tufos), desenhados de trás para a frente.
        self.items = []
        top_near = lambda x: self.hill_y(2, x)
        for _ in range(240):  # flores
            x = rng.uniform(-0.02, 1.02) * W
            top = top_near(x)
            depth = rng.uniform(0, 1) ** 1.6  # mais flores ao fundo
            y = top + 8 * S + depth * (H - top) * 0.92
            r = (5 + 40 * depth ** 1.2) * S * rng.uniform(0.85, 1.15)
            stem = r * rng.uniform(1.6, 2.8)
            self.items.append(('flor', y + stem * 0.6, {
                'x': x, 'y': y, 'r': r, 'stem': stem, 'sprite': int(rng.integers(len(self.sprites))),
                'spin': rng.uniform(0, TAU), 'tilt': rng.uniform(0.5, 0.92), 'lean': rng.uniform(-0.3, 0.3),
                'sway': rng.uniform(0.02, 0.06), 'k': int(rng.integers(2, 6)), 'phase': rng.uniform(0, TAU),
                'pk': int(rng.integers(1, 4)), 'pp': rng.uniform(0, TAU), 'light': rng.uniform(0.75, 1.0) * (0.55 + 0.45 * depth),
            }))
        for _ in range(2000):  # tufos de capim
            x = rng.uniform(-0.02, 1.02) * W
            top = top_near(x)
            depth = rng.uniform(0, 1) ** 1.3
            y = top + 4 * S + depth * (H - top) * 1.0
            blades = []
            for _ in range(int(rng.integers(3, 7))):
                blades.append((rng.uniform(-6, 6) * S * (0.4 + depth), rng.uniform(-0.5, 0.5), rng.uniform(0.45, 1.0), rng.uniform(0.75, 1.35)))
            self.items.append(('tufo', y, {
                'x': x, 'y': y, 'h': (5 + 30 * depth ** 1.3) * S * rng.uniform(0.7, 1.2), 'w': (0.5 + 1.6 * depth) * S,
                'blades': blades, 'k': int(rng.integers(1, 4)), 'phase': rng.uniform(0, TAU), 'depth': depth,
            }))
        self.items.sort(key=lambda item: item[1])
        # Flores grandes desfocadas nos cantos de baixo.
        self.front = []
        for i in range(7):
            side = i % 2
            x = (rng.uniform(-0.05, 0.16) if side == 0 else rng.uniform(0.84, 1.05)) * W
            self.front.append({'x': x, 'y': H * rng.uniform(0.86, 1.02), 'r': rng.uniform(75, 125) * S, 'sprite': int(rng.integers(len(self.sprites))),
                               'spin': rng.uniform(0, TAU), 'tilt': rng.uniform(0.55, 0.85), 'rot': rng.uniform(-0.4, 0.4),
                               'k': int(rng.integers(1, 3)), 'phase': rng.uniform(0, TAU)})
        self.petals = []
        for _ in range(18):
            self.petals.append({'x0': rng.uniform(0, 1), 'laps': int(rng.integers(1, 3)), 'y': rng.uniform(0.3, 0.9) * H,
                                'amp': rng.uniform(20, 70) * S, 'wk': int(rng.integers(2, 6)), 'wp': rng.uniform(0, TAU),
                                'size': rng.uniform(6, 11) * S, 'rk': int(rng.integers(3, 8)) * int(rng.choice([-1, 1])), 'rp': rng.uniform(0, TAU),
                                'sprite': int(rng.integers(len(self.sprites))), 'light': rng.uniform(0.5, 0.85)})
        self.fireflies = []
        for _ in range(48):
            x = rng.uniform(0.02, 0.98) * W
            self.fireflies.append({'x': x, 'y': self.hill_y(2, x) + rng.uniform(-0.14, 0.2) * H,
                                   'ax': rng.uniform(15, 60) * S, 'ay': rng.uniform(10, 40) * S, 'kx': int(rng.integers(1, 4)), 'ky': int(rng.integers(1, 5)),
                                   'px': rng.uniform(0, TAU), 'py': rng.uniform(0, TAU), 'bk': int(rng.integers(2, 7)), 'bp': rng.uniform(0, TAU),
                                   'size': rng.uniform(2.0, 3.6) * S})

    def hill_y(self, index, x):
        base, waves, _, _ = self.hills[index]
        u = x / self.W
        return self.H * (base - sum(a * math.sin(TAU * (u * f + p)) for a, f, p in waves))

    def make_static(self):
        """Morros e névoa: não mudam entre os quadros (só o céu e o campo se mexem)."""
        W, H, S = self.W, self.H, self.S
        ys = np.arange(H, dtype=np.float32)[:, None]
        color = np.zeros((H, W, 3), np.float32)
        alpha = np.zeros((H, W, 1), np.float32)
        haze = np.zeros((H, W, 3), np.float32)
        for i, (_, _, tone, soft) in enumerate(self.hills):
            tops = np.array([self.hill_y(i, x) for x in range(W)], np.float32)[None, :]
            inside = smoothstep(-soft * S, soft * S, ys - tops)[..., None]
            depth = np.clip((ys - tops) / (H * 0.3), 0, 1)[..., None]
            shade = tone * (1 - depth * (0.6 if i == 2 else 0.3)) + (GROUND_DEEP * depth if i == 2 else 0)
            color = color * (1 - inside) + shade * inside
            alpha = alpha * (1 - inside) + inside
            if i == 0:
                # Névoa azul que sobe do campo e clareia a linha do horizonte.
                above = np.clip((tops - ys) / (90 * S), 0, 1)
                band = np.exp(-((ys - tops) / (45 * S)) ** 2)
                haze += (band * (1 - above * 0.5))[..., None] * HAZE * 0.16
        return color, alpha, haze

    def render(self, sky, index):
        W, H, S = self.W, self.H, self.S
        t = index / FRAMES
        out = sky.astype(np.float32) / 255.0
        color, alpha, haze = self.static
        out = out * (1 - alpha) + color * alpha + haze
        glow = np.zeros((H, W, 3), np.float32)
        # Tapete de luz ao longe.
        specks = np.zeros((H, W), np.uint8)
        for x, y, size, light, k, p in self.specks:
            v = light * (0.75 + 0.25 * math.sin(TAU * k * t + p))
            cv2.circle(specks, (int(x * 4), int(y * 4)), max(1, int(size * 4)), int(255 * v), -1, cv2.LINE_AA, 2)
        sp = (specks.astype(np.float32) / 255)[..., None]
        out += sp * (PETAL_MID * 0.6 + PETAL_CORE * 0.35)
        glow += sp * PETAL_MID * 0.9
        # Campo: flores e tufos, de trás para a frente (o capim da frente cobre as flores de trás).
        # Tela de 8 bits: o anti-serrilhado do OpenCV (capim e caules) só funciona nela. Cor pré-multiplicada.
        field = np.zeros((H, W, 4), np.uint8)
        c8 = lambda tone: (*[int(min(255, round(float(c) * 255))) for c in tone], 255)
        for kind, _, it in self.items:
            if kind == 'tufo':
                sway = 0.10 * math.sin(TAU * it['k'] * t + it['phase'] + it['x'] * 0.003)
                for off, lean, height, shade in it['blades']:
                    # Lâmina fina e curva: larga na base, afinando até a ponta, que pega a luz azul do campo.
                    bend = lean + sway
                    hgt = it['h'] * height
                    bx, by = it['x'] + off, it['y']
                    w = it['w']
                    left, right = [], []
                    for u in (0.0, 0.35, 0.7, 1.0):
                        cx = bx + math.sin(bend) * hgt * u ** 1.6
                        cy = by - hgt * u * (1 - 0.18 * abs(bend) * u)
                        half = w * (1 - u) ** 0.8
                        left.append((cx - half, cy))
                        right.append((cx + half, cy))
                    poly = np.array(left + right[::-1], np.float32)
                    cv2.fillPoly(field, [np.round(poly * 4).astype(np.int32)], c8(BLADE * shade * (0.6 + 0.6 * it['depth'])), cv2.LINE_AA, 2)
                    tip = np.array([left[2], left[3], right[2]], np.float32)
                    cv2.fillPoly(field, [np.round(tip * 4).astype(np.int32)], c8(BLADE_TIP * shade * (0.45 + 0.4 * it['depth'])), cv2.LINE_AA, 2)
            else:
                sway = it['sway'] * math.sin(TAU * it['k'] * t + it['phase'])
                hx = it['x'] + (it['lean'] + sway) * it['stem'] * 0.5
                hy = it['y'] - it['stem'] * 0.15
                base = (it['x'], it['y'] + it['stem'] * 0.6)
                pts = np.array([(base[0] + (hx - base[0]) * (u ** 1.5), base[1] + (hy - base[1]) * u) for u in np.linspace(0, 1, 10)], np.float32)
                cv2.polylines(field, [np.round(pts * 4).astype(np.int32)], False, c8(STEM), max(1, int(it['r'] * 0.07)), cv2.LINE_AA, 2)
                pulse = 0.88 + 0.12 * math.sin(TAU * it['pk'] * t + it['pp'])
                sprite, sglow = self.sprites[it['sprite']]
                stamp(field, glow, sprite, sglow, hx, hy, it['r'], it['spin'] + sway * 2, it['tilt'], it['light'] * pulse)
        field = field.astype(np.float32) / 255
        fa = field[..., 3:4]
        out = out * (1 - fa) + field[..., :3]
        # Flores desfocadas da frente.
        front = np.zeros((H, W, 4), np.float32)
        fglow = np.zeros((H, W, 3), np.float32)
        for f in self.front:
            sway = 0.04 * math.sin(TAU * f['k'] * t + f['phase'])
            sprite, sglow = self.sprites[f['sprite']]
            stamp(front, fglow, sprite, sglow, f['x'] + sway * f['r'], f['y'], f['r'], f['spin'] + sway, f['tilt'], 0.42)
        blur = 14 * S
        front = cv2.GaussianBlur(front, (0, 0), blur)
        out = out * (1 - front[..., 3:4]) + front[..., :3]
        glow += cv2.GaussianBlur(fglow, (0, 0), blur) * 0.25
        # Brilho das flores: perto, largo e a névoa do campo inteiro.
        small = cv2.resize(glow, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        out += cv2.GaussianBlur(glow, (0, 0), 3 * S) * 0.35
        out += cv2.resize(cv2.GaussianBlur(small, (0, 0), 4), (W, H)) * 0.35
        out += cv2.resize(cv2.GaussianBlur(small, (0, 0), 16), (W, H)) * 0.3
        # Pétalas no vento (pequenas flores de uma pétala só, girando).
        petals = np.zeros((H, W, 4), np.float32)
        pglow = np.zeros((H, W, 3), np.float32)
        span = W + 160 * S
        for p in self.petals:
            x = ((p['x0'] + p['laps'] * t) % 1.0) * span - 80 * S
            y = p['y'] + p['amp'] * math.sin(TAU * p['wk'] * t + p['wp'])
            spin = TAU * p['rk'] * t + p['rp']
            flat = 0.25 + 0.75 * abs(math.cos(TAU * p['rk'] * t * 0.5 + p['rp']))
            sprite, sglow = self.sprites[p['sprite']]
            stamp(petals, pglow, sprite, sglow, x, y, p['size'], spin, flat * 0.6, p['light'])
        out = out * (1 - petals[..., 3:4] * 0.8) + petals[..., :3] * 0.8
        out += cv2.GaussianBlur(pglow, (0, 0), 4 * S) * 0.5
        # Vaga-lumes.
        light = np.zeros((H, W), np.uint8)
        for v in self.fireflies:
            x = v['x'] + v['ax'] * math.sin(TAU * v['kx'] * t + v['px'])
            y = v['y'] + v['ay'] * math.sin(TAU * v['ky'] * t + v['py'])
            blink = max(0.0, math.sin(TAU * v['bk'] * t + v['bp'])) ** 2
            if blink < 0.02:
                continue
            cv2.circle(light, (int(x * 4), int(y * 4)), int(v['size'] * 4), int(255 * blink), -1, cv2.LINE_AA, 2)
        lf = (light.astype(np.float32) / 255)[..., None]
        out += lf * FIREFLY * 0.9 + cv2.GaussianBlur(lf, (0, 0), 4 * S)[..., None] * FIREFLY * 1.4 + cv2.GaussianBlur(lf, (0, 0), 14 * S)[..., None] * FIREFLY * 0.8
        # Tom final: mantém o céu e só suaviza os brilhos fortes.
        out = out / (1 + np.maximum(out - 0.85, 0) * 0.8)
        return np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)


def frames_of(video, W, H):
    proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', video, '-vf', f'scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    size = W * H * 3
    try:
        while True:
            data = proc.stdout.read(size)
            if len(data) < size:
                break
            yield np.frombuffer(data, np.uint8).reshape(H, W, 3)
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sky')
    ap.add_argument('out', nargs='?')
    ap.add_argument('--scale', type=int, default=1)
    ap.add_argument('--frame', type=int, default=None, help='só um quadro (para conferir ou gerar a imagem parada)')
    ap.add_argument('--still', default=None)
    ap.add_argument('--crf', type=int, default=21)
    ap.add_argument('--preset', default='slow')
    args = ap.parse_args()
    scene = Scene(args.scale)
    W, H = scene.W, scene.H
    if args.frame is not None:
        for i, sky in enumerate(frames_of(args.sky, W, H)):
            if i == args.frame:
                cv2.imwrite(args.still, scene.render(sky, i))
                return
        raise SystemExit('quadro fora do vídeo')
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                            '-c:v', 'libx264', '-preset', args.preset, '-crf', str(args.crf), '-profile:v', 'high', '-level:v', '5.1' if args.scale > 1 else '4.1',
                            '-pix_fmt', 'yuv420p', '-x264-params', 'keyint=60:min-keyint=30', '-movflags', '+faststart', args.out], stdin=subprocess.PIPE)
    count = 0
    for i, sky in enumerate(frames_of(args.sky, W, H)):
        if i >= FRAMES:
            break
        enc.stdin.write(scene.render(sky, i).tobytes())
        count += 1
        if count % 100 == 0:
            print(f'{count}/{FRAMES}', flush=True)
    enc.stdin.close()
    enc.wait()
    if count != FRAMES:
        raise SystemExit(f'o vídeo do céu tinha {count} quadros, eram esperados {FRAMES}')


if __name__ == '__main__':
    main()

"""
Anima o fundo do espaço da Análise e otimização e grava um vídeo em loop perfeito (o último quadro emenda no primeiro).

Entrada: as camadas que dev/space-video/layers.cjs gera com o mesmo desenho de src/space.js (céu, estrelas em 2x e
aurora), com uma sobra nas bordas para a câmera andar. O que se mexe:
  - cada estrela cintila no próprio ritmo (as fracas tremeluzem, as brilhantes respiram devagar; algumas dão um brilho);
  - a nebulosa "respira" por regiões, cada uma no seu tempo;
  - a aurora ondula e a luz corre pelas cortinas;
  - estrelas cadentes de vez em quando e um cometa que atravessa o canto do céu;
  - a câmera anda num círculo quase imperceptível, com paralaxe (estrelas um pouco mais que a nebulosa).
Todo movimento periódico tem um número inteiro de ciclos no loop, e os eventos começam e terminam dentro dele.

Uso: python3 dev/space-video/render.py <pasta das camadas> <saída.mp4> [--seconds 30] [--fps 30] [--crf 22] [--preset slow]
(o vídeo do app: 1920×1080, 30 quadros por segundo, H.264 com CRF 22 no preset slow, porque o arquivo vai no instalador)
"""
import argparse
import math
import subprocess
import sys
import time

import cv2
import numpy as np

W, H = 1920, 1080


def load(folder):
    sky = cv2.imread(f'{folder}/sky.png', cv2.IMREAD_COLOR).astype(np.float32) / 255.0
    aur = cv2.imread(f'{folder}/aurora.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 255.0
    stars = cv2.imread(f'{folder}/stars.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 255.0
    aurora = aur[..., :3] * aur[..., 3:4]
    star_rgb = stars[..., :3] * stars[..., 3:4]
    return sky, aurora, star_rgb


def label_stars(star_rgb, rng):
    """Cada pixel da camada de estrelas ganha o número da estrela mais perto (pico local), e cada estrela um ritmo."""
    lum = star_rgb.max(axis=2)
    peak = cv2.dilate(lum, np.ones((5, 5), np.uint8))
    seeds = ((lum >= peak) & (lum > 0.05)).astype(np.uint8)
    src = (1 - seeds).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
    labels = labels.astype(np.int32)
    count = int(labels.max()) + 1
    bright = np.zeros(count, np.float32)
    np.maximum.at(bright, labels[seeds > 0], lum[seeds > 0])
    # Ritmo de cada estrela: fracas tremeluzem mais e mais rápido; brilhantes respiram devagar.
    amp = np.where(bright < 0.35, rng.uniform(0.12, 0.55, count), np.where(bright < 0.8, rng.uniform(0.1, 0.3, count), rng.uniform(0.05, 0.14, count)))
    steady = rng.random(count) < 0.22
    amp[steady] *= 0.25
    k1 = np.where(bright < 0.35, rng.integers(2, 9, count), np.where(bright < 0.8, rng.integers(1, 5, count), rng.integers(1, 3, count)))
    k2 = np.where(bright < 0.35, rng.integers(5, 14, count), np.where(bright < 0.8, rng.integers(3, 8, count), rng.integers(2, 5, count)))
    p1 = rng.uniform(0, 2 * math.pi, count)
    p2 = rng.uniform(0, 2 * math.pi, count)
    # Algumas estrelas brilhantes dão um "brilho" (cintilação forte e curta) uma vez por loop.
    flare = np.zeros(count, np.float32)
    flare_at = rng.uniform(0, 1, count)
    big = np.flatnonzero(bright >= 0.8)
    if big.size:
        chosen = rng.choice(big, size=max(1, big.size // 3), replace=False)
        flare[chosen] = rng.uniform(0.35, 0.7, chosen.size)
    return labels, dict(amp=amp.astype(np.float32), k1=k1, k2=k2, p1=p1, p2=p2, flare=flare, flare_at=flare_at)


def star_weights(params, phase):
    """phase em [0, 1): posição no loop."""
    tau = 2 * math.pi
    w = 1 + params['amp'] * (0.62 * np.sin(tau * params['k1'] * phase + params['p1']) + 0.38 * np.sin(tau * params['k2'] * phase + params['p2']))
    d = np.abs(((phase - params['flare_at']) + 0.5) % 1.0 - 0.5)  # distância circular no loop
    w = w + params['flare'] * np.exp(-((d / 0.012) ** 2))
    return np.maximum(0.12, w).astype(np.float32)


def noise_fields(rng, shape, count, cells):
    out = []
    for _ in range(count):
        small = rng.standard_normal((cells[1], cells[0])).astype(np.float32)
        small = cv2.GaussianBlur(small, (0, 0), 1.2)
        small /= max(1e-6, np.abs(small).max())
        out.append(cv2.resize(small, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC))
    return out


def soft_dot(canvas, x, y, sigma, color, strength):
    r = int(sigma * 4) + 1
    x0, y0 = int(math.floor(x)) - r, int(math.floor(y)) - r
    xs = np.arange(x0, x0 + 2 * r + 1, dtype=np.float32)
    ys = np.arange(y0, y0 + 2 * r + 1, dtype=np.float32)
    g = np.exp(-(((xs[None, :] - x) ** 2 + (ys[:, None] - y) ** 2) / (2 * sigma * sigma)))
    ax0, ay0 = max(0, x0), max(0, y0)
    ax1, ay1 = min(canvas.shape[1], x0 + 2 * r + 1), min(canvas.shape[0], y0 + 2 * r + 1)
    if ax1 <= ax0 or ay1 <= ay0:
        return
    patch = g[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0]
    canvas[ay0:ay1, ax0:ax1] += patch[..., None] * (np.array(color, np.float32) * strength)


def streak(canvas, hx, hy, dx, dy, length, color_head, color_tail, strength, width=1.0):
    """Rastro que some para trás (estrela cadente / cauda): várias linhas finas com brilho caindo, depois suavizadas."""
    layer = np.zeros(canvas.shape[:2], np.uint8)
    steps = 28
    for i in range(steps):
        a = i / steps
        b = (i + 1) / steps
        x1, y1 = hx - dx * length * a, hy - dy * length * a
        x2, y2 = hx - dx * length * b, hy - dy * length * b
        value = int(255 * (1 - a) ** 1.6)
        if value <= 0:
            continue
        cv2.line(layer, (int(round(x1 * 16)), int(round(y1 * 16))), (int(round(x2 * 16)), int(round(y2 * 16))), value, max(1, int(round(width))), cv2.LINE_AA, shift=4)
    glow = layer.astype(np.float32) / 255.0
    glow = cv2.GaussianBlur(glow, (0, 0), 0.7) * 0.85 + cv2.GaussianBlur(glow, (0, 0), 2.4) * 0.6
    # Cor: perto da cabeça (brilho alto) a cor da cabeça; no fim da cauda (brilho baixo), a da cauda.
    tint = np.array(color_tail, np.float32)[None, None, :] + (np.array(color_head, np.float32) - np.array(color_tail, np.float32))[None, None, :] * glow[..., None]
    canvas += glow[..., None] * tint * strength


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('layers')
    ap.add_argument('out')
    ap.add_argument('--seconds', type=float, default=30)
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--crf', type=int, default=22)
    ap.add_argument('--preset', default='slow')
    ap.add_argument('--frames', type=int, default=0, help='só os N primeiros quadros (teste)')
    ap.add_argument('--still', default='', help='grava também o primeiro quadro como imagem')
    args = ap.parse_args()

    rng = np.random.default_rng(59)
    sky, aurora, star_rgb = load(args.layers)
    sh, sw = sky.shape[:2]
    mx, my = (sw - W) / 2, (sh - H) / 2
    labels, params = label_stars(star_rgb, rng)
    breath = noise_fields(rng, (sh // 4, sw // 4), 4, (22, 13))
    breath_k = [1, 1, 2, 3]
    breath_p = rng.uniform(0, 2 * math.pi, 4)
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    dither = (rng.random((H, W, 3), dtype=np.float32) - 0.5) / 255.0

    total = int(round(args.seconds * args.fps))
    frames = args.frames or total
    T = args.seconds
    # Estrelas cadentes: (início em s, duração, x, y, ângulo em graus, percurso em px, cauda em px, força)
    meteors = [(3.6, 0.85, 1500, 140, 152, 420, 170, 1.0), (12.9, 0.7, 520, 90, 28, 360, 140, 0.8), (21.4, 0.95, 1180, 230, 160, 480, 200, 0.95), (27.0, 0.6, 300, 420, 20, 300, 120, 0.6)]
    comet = dict(t0=7.0, t1=21.0, a=(2010.0, 120.0), b=(1230.0, 345.0))
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(args.fps), '-i', '-',
                            '-c:v', 'libx264', '-preset', args.preset, '-crf', str(args.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                            '-x264-params', 'keyint=60:min-keyint=30', '-movflags', '+faststart', args.out], stdin=subprocess.PIPE)
    started = time.time()
    tau = 2 * math.pi
    for i in range(frames):
        phase = i / total
        t = phase * T
        # Câmera: um círculo pequeno no loop; estrelas andam 1,35× a nebulosa (paralaxe), a aurora 0,7×.
        cx, cy = 10.0 * math.cos(tau * phase), 6.0 * math.sin(tau * phase)
        # Nebulosa respirando por regiões.
        b = np.ones_like(breath[0])
        for field, k, p in zip(breath, breath_k, breath_p):
            b += 0.085 * field * math.sin(tau * k * phase + p)
        b = cv2.resize(b, (sw, sh), interpolation=cv2.INTER_LINEAR)
        lit = sky * b[..., None]
        m = np.float32([[1, 0, -(mx + cx)], [0, 1, -(my + cy)]])
        frame = cv2.warpAffine(lit, m, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        # Aurora: cortinas ondulando e pulsos de luz correndo por elas.
        ax, ay = mx + cx * 0.7, my + cy * 0.7
        sx = gx + ax
        sy = gy + ay
        dx = 7.0 * np.sin(tau * (sy / 260.0 + phase)) + 5.0 * np.sin(tau * (sx / 610.0 - 2 * phase) + 1.3)
        dy = 6.0 * np.sin(tau * (sx / 420.0 - 2 * phase)) + 3.0 * np.sin(tau * (sx / 150.0 + 3 * phase))
        moved = cv2.remap(aurora, sx + dx, sy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        pulse = 0.74 + 0.26 * np.sin(tau * (gx[0] / 520.0 - 3 * phase)) + 0.12 * np.sin(tau * (gx[0] / 190.0 + 5 * phase))
        frame += moved * (pulse * (0.92 + 0.08 * math.sin(tau * phase)))[None, :, None]
        # Estrelas: cada uma no seu ritmo, posicionadas em 2x e reduzidas (sem tremer entre os pixels).
        wv = star_weights(params, phase)
        lit_stars = star_rgb * wv[labels][..., None]
        sx2, sy2 = 2 * (mx + cx * 1.35), 2 * (my + cy * 1.35)
        m2 = np.float32([[1, 0, -sx2], [0, 1, -sy2]])
        moved_stars = cv2.warpAffine(lit_stars, m2, (2 * W, 2 * H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        frame += cv2.resize(moved_stars, (W, H), interpolation=cv2.INTER_AREA)
        # Estrelas cadentes.
        for (t0, dur, x0, y0, ang, path, tail, power) in meteors:
            if t0 <= t <= t0 + dur:
                p = min(1.0, max(0.0, (t - t0) / dur))
                env = max(0.0, math.sin(math.pi * p)) ** 0.8
                ddx, ddy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                hx, hy = x0 + ddx * path * p - cx * 1.35, y0 + ddy * path * p - cy * 1.35
                streak(frame, hx, hy, ddx, ddy, tail * min(1.0, 0.3 + p * 1.6), (1.0, 0.98, 0.95), (1.0, 0.82, 0.62), 0.9 * env * power)
                soft_dot(frame, hx, hy, 1.6, (1.0, 0.98, 0.96), 0.8 * env * power)
        # Cometa: atravessa o canto de cima com a cauda longa e a cabeleira azulada.
        if comet['t0'] <= t <= comet['t1']:
            p = (t - comet['t0']) / (comet['t1'] - comet['t0'])
            env = max(0.0, min(1.0, p / 0.12) * min(1.0, (1 - p) / 0.2))
            hx = comet['a'][0] + (comet['b'][0] - comet['a'][0]) * p - cx * 1.35
            hy = comet['a'][1] + (comet['b'][1] - comet['a'][1]) * p - cy * 1.35
            vx, vy = comet['b'][0] - comet['a'][0], comet['b'][1] - comet['a'][1]
            n = math.hypot(vx, vy)
            ux, uy = vx / n, vy / n
            # Cores em BGR. Cauda de íons reta e azulada; cauda de poeira mais curta, curvada e amarelada.
            streak(frame, hx, hy, ux, uy, 300, (1.0, 0.97, 0.92), (1.0, 0.72, 0.45), 0.42 * env, width=2)
            qx, qy = ux * 0.97 + 0.14, uy * 0.97 - 0.22
            qn = math.hypot(qx, qy)
            streak(frame, hx, hy, qx / qn, qy / qn, 190, (0.85, 0.93, 1.0), (0.62, 0.84, 1.0), 0.22 * env, width=3)
            soft_dot(frame, hx, hy, 6.0, (1.0, 0.95, 0.85), 0.32 * env)
            soft_dot(frame, hx, hy, 1.5, (1.0, 1.0, 1.0), 0.9 * env)
        out = np.clip(frame + dither, 0, 1)
        data = (out * 255.0 + 0.5).astype(np.uint8)
        if i == 0 and args.still:
            cv2.imwrite(args.still, data)
        enc.stdin.write(data.tobytes())
        if i % 30 == 0:
            el = time.time() - started
            print(f'quadro {i}/{frames} ({el:.0f} s, {el / (i + 1):.2f} s/quadro)', flush=True)
    enc.stdin.close()
    enc.wait()
    print(f'pronto em {time.time() - started:.0f} s')


if __name__ == '__main__':
    sys.exit(main())

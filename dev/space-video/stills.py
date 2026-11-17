"""
Gera as imagens paradas do Nexo a partir de um quadro do campo de flores (arte original do projeto):
  - assets/wallpaper.webp: fundo padrão do app (2560×1440);
  - installer-launcher/assets/bg.jpg: fundo do instalador visual (1920×1080);
  - installer/installer-sidebar.bmp e installer/uninstaller-sidebar.bmp: faixas laterais do instalador NSIS (164×314),
    com a estrela do Nexo em cima e o nome embaixo.

Uso: python3 dev/space-video/stills.py <quadro.png>  (o primeiro quadro do campo de flores: o fundo animado começa nele)
(python3 dev/flower-scene/render.py assets/space/espaco-4k.mp4 --frame 0 --still quadro.png --scale 2)
"""
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = 'assets/fonts/InterVariable.woff2'


def cover(image, width, height, focus=(0.5, 0.5)):
    """Recorta e redimensiona como o background-size: cover do CSS, puxando o recorte para o ponto de foco."""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = round((resized.width - width) * focus[0])
    top = round((resized.height - height) * focus[1])
    return resized.crop((left, top, left + width, top + height))


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    # A Inter variável tem dois eixos, nessa ordem: tamanho óptico (14 a 32) e peso (100 a 900).
    face.set_variation_by_axes([min(32, max(14, size / 2)), weight])
    return face


def spaced(draw, origin, text, face, fill, tracking):
    """Escreve letra por letra com espaço extra entre elas (o nome do Nexo é espaçado como no logotipo)."""
    x, y = origin
    for letter in text:
        draw.text((x, y), letter, font=face, fill=fill)
        x += draw.textlength(letter, font=face) + tracking


def sidebar(frame, focus):
    """Faixa do NSIS: céu escurecido embaixo para o nome ler bem, estrela do Nexo no alto."""
    side = cover(frame, 164 * 2, 314 * 2, focus)
    shade = Image.linear_gradient('L').resize(side.size).point(lambda v: int(v * 0.72))
    side = Image.composite(Image.new('RGB', side.size, (4, 6, 18)), side, shade)
    star = Image.open('assets/nexo-star.png').convert('RGBA')
    star.thumbnail((64, 64), Image.LANCZOS)
    glow = Image.new('RGBA', side.size, (0, 0, 0, 0))
    glow.paste(star, (36, 36), star)
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    side = Image.alpha_composite(side.convert('RGBA'), glow)
    side.alpha_composite(star, (36, 36))
    draw = ImageDraw.Draw(side)
    spaced(draw, (36, side.height - 112), 'NEXO', font(44, 700), (236, 240, 255), 9)
    spaced(draw, (38, side.height - 56), 'DEVICE CARE', font(18, 500), (160, 172, 210), 3)
    return side.convert('RGB').resize((164, 314), Image.LANCZOS)


def main():
    frame = Image.open(sys.argv[1]).convert('RGB')
    cover(frame, 2560, 1440).save('assets/wallpaper.webp', quality=88, method=6)
    cover(frame, 1920, 1080).save('installer-launcher/assets/bg.jpg', quality=90, optimize=True, progressive=True)
    sidebar(frame, (0.28, 0.5)).save('installer/installer-sidebar.bmp')
    sidebar(frame, (0.78, 0.5)).save('installer/uninstaller-sidebar.bmp')


if __name__ == '__main__':
    main()

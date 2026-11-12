"""Draw the Neon Apex Home Screen icons at the required iPad sizes."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
SIZE = 1024
im = Image.new("RGB", (SIZE, SIZE))
px = im.load()
for y in range(SIZE):
    for x in range(SIZE):
        glow = max(0, 1 - ((x - 512) ** 2 / 440**2 + (y - 475) ** 2 / 600**2) ** .5)
        px[x, y] = (int(7 + 13 * glow), int(17 + 30 * glow), int(28 + 43 * glow))

d = ImageDraw.Draw(im)
d.rounded_rectangle((22, 22, 1002, 1002), radius=190, outline=(74, 230, 211), width=18)
d.polygon([(416, 236), (608, 236), (1010, 1010), (14, 1010)], fill=(18, 37, 49))
d.line([(409, 268), (76, 964)], fill=(78, 238, 215), width=25, joint="curve")
d.line([(615, 268), (948, 964)], fill=(255, 157, 106), width=25, joint="curve")
d.line([(512, 280), (512, 482)], fill=(235, 209, 145), width=14)
d.polygon([(300, 541), (724, 541), (777, 798), (247, 798)], fill=(222, 229, 221))
d.polygon([(352, 548), (672, 548), (698, 646), (326, 646)], fill=(41, 85, 101))
d.polygon([(270, 674), (754, 674), (777, 795), (247, 795)], fill=(29, 36, 42))
d.rounded_rectangle((287, 686, 405, 728), radius=12, fill=(255, 66, 75))
d.rounded_rectangle((619, 686, 737, 728), radius=12, fill=(255, 66, 75))
d.rounded_rectangle((459, 696, 565, 737), radius=9, fill=(91, 226, 204))
d.rounded_rectangle((205, 758, 307, 837), radius=20, fill=(9, 15, 21))
d.rounded_rectangle((717, 758, 819, 837), radius=20, fill=(9, 15, 21))
try:
    font = ImageFont.truetype("DejaVuSans-Bold.ttf", 84)
except OSError:
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 94)
d.text((512, 100), "NEON APEX", font=font, fill=(246, 240, 221), anchor="mt", stroke_width=2, stroke_fill=(8, 19, 27))

for size in (180, 192, 512):
    im.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"neon-apex-{size}.png", optimize=True)

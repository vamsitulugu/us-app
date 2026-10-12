# Optional: hue-shift the blue app icons / splash PNGs to the magenta theme.
# Run from the repo root:  pip install pillow && python3 recolor-icons.py
import glob, colorsys
from PIL import Image
files = ['public/icons/icon-512.png','public/icons/icon-192.png','resources/icon.png','resources/splash.png'] \
      + glob.glob('android/app/src/main/res/mipmap-*/*.png') \
      + glob.glob('android/app/src/main/res/drawable*/splash.png')
for f in files:
    im = Image.open(f).convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            h,l,s = colorsys.rgb_to_hls(r/255,g/255,b/255); hd = h*360
            if 184 <= hd <= 266 and s > 0.12:
                nh = 338 - (max(hd,190)-190)*(33/75.0)
                if l < 0.25: nh = 326 + (nh-322)*0.3
                ns = s*0.6 if (s < 0.55 and 0.25 < l < 0.9) else s
                nl = l*0.82 if 0.4 < l < 0.62 else l
                r2,g2,b2 = colorsys.hls_to_rgb(nh/360, nl, min(ns,0.9))
                px[x,y] = (int(r2*255), int(g2*255), int(b2*255), a)
    im.save(f); print('recolored', f)

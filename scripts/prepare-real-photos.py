#!/usr/bin/env python3
"""Fetch licensed-to-storefront product photography and prepare app-local WebP assets.

Only two explicitly approved Vesta/Cutella storefront domains are read. No CMS writes.
Use real product image originals published by the two store owners; no stock art.
Fails closed if an image cannot be verified rather than deploying the old illustration.
"""
import io
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

PHOTOS = {
    "hero-fashion": ("Cutella | بافت دو تیکه مجلسی", "https://cutellashop.ir/wp-content/uploads/2024/09/IMG_5351.jpg"),
    "wardrobe": ("Cutella | کراپ تاپ رومی زارا", "https://cutellashop.ir/wp-content/uploads/2026/08/IMG_20260804_130846_148.jpg"),
    "beauty": ("Vesta | لیپ گلاس تینتی جوجو دایری", "https://vesta-cosmetics.ir/wp-content/uploads/2026/10/photo_1_2026-10-13_17-54-38.jpg"),
    "outfit": ("Cutella | کراپ بندی پاپیون دار", "https://cutellashop.ir/wp-content/uploads/2026/08/IMG_20260804_132254_950.jpg"),
    "shop-mixed": ("Cutella | گردنبند اسپیرال خورشید", "https://cutellashop.ir/wp-content/uploads/2025/12/2-9.jpg"),
    "shop-vesta": ("Vesta | رژلب فلاور نوز", "https://vesta-cosmetics.ir/wp-content/uploads/2026/10/woo_cover_4006e8c8967b41aba86bb3fd21a7c2d5.jpg"),
    "shop-cutella": ("Cutella | کراپ تاپ سه دکمه", "https://cutellashop.ir/wp-content/uploads/2024/11/IMG_6151.jpg"),
    "beauty-care": ("Vesta | کرم دست مارشمالو", "https://vesta-cosmetics.ir/wp-content/uploads/2026/10/woo_cover_6a58d9aecf164f989a25c87dc0c3bc2e.jpg"),
    "closet-blank": ("Cutella | بافت راه راه بندی", "https://cutellashop.ir/wp-content/uploads/2024/11/IMG_4387.jpg"),
}

OUT = Path(os.environ.get("VESTALAND_PHOTO_DEST", "assets/photos"))
OUT.mkdir(parents=True, exist_ok=True)
sources = {}
for name, (caption, url) in PHOTOS.items():
    parsed = urlsplit(url)
    assert parsed.scheme == "https" and parsed.hostname in {"vesta-cosmetics.ir", "cutellashop.ir"}
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (Vestaland Product Gallery; +https://app.vesta-cosmetics.ir)", "Accept": "image/*"})
    with urlopen(req, timeout=27) as response:
        content_type = response.headers.get("Content-Type", "").lower()
        if not content_type.startswith("image/"):
            raise RuntimeError(f"{name}: server returned {content_type}, not a photo")
        raw = response.read(6_000_001)
    if len(raw) > 6_000_000:
        raise RuntimeError(f"{name}: source exceeds 6 MB")
    try:
        picture = Image.open(io.BytesIO(raw))
        picture = ImageOps.exif_transpose(picture)
        if picture.width < 230 or picture.height < 230 or picture.format in ("SVG",):
            raise RuntimeError(f"{name}: image too small or not raster")
        picture = picture.convert("RGB")
        # Product photography: keep natural colour; only resize, no AI or painted effects.
        picture.thumbnail((1050, 1050), Image.Resampling.LANCZOS)
        picture.save(OUT / f"{name}.webp", "WEBP", quality=81, method=5)
    except (UnidentifiedImageError, OSError) as e:
        raise RuntimeError(f"{name}: invalid source image") from e
    actual = (OUT / f"{name}.webp").stat().st_size
    if actual < 3500 or actual > 350_000:
        raise RuntimeError(f"{name}: resulting image file size invalid ({actual})")
    sources[name] = {"caption": caption, "source": url, "dimensions": list(picture.size), "bytes": actual}
    print(f"{name}: verified real photo, {picture.width}x{picture.height}, {actual//1024} KiB")
(OUT / "SOURCES.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
print("SUCCESS: all 9 product photographs ready; no SVG illustrations produced.")

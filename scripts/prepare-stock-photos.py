#!/usr/bin/env python3
"""Prepare licensed Pexels editorial/stock photography for Vestaland.

These photographs are *decorative*, NOT photos of purchasable Vesta/Cutella
items. Actual WooCommerce product thumbnails continue to come from Woo.
Pexels permits stock photos in commercial apps: https://www.pexels.com/license/
Source record is preserved in SOURCES.json. No hotlink in the shipped app.
"""
import io, json, os
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from PIL import Image, ImageOps, UnidentifiedImageError

STOCK={
  "hero-fashion":(4602025,"Pink flat lay casual outfit", "https://www.pexels.com/photo/flatlay-photo-of-a-cute-outfit-4602025/"),
  "wardrobe":(3998646,"Women clothes flat lay", "https://www.pexels.com/photo/flat-lay-of-clothes-3998646/"),
  "beauty":(34567763,"Pink fabric makeup flat lay", "https://www.pexels.com/photo/flat-lay-of-assorted-makeup-products-on-pink-fabric-34567763/"),
  "outfit":(5405644,"Woman outfit and accessories flat lay", "https://www.pexels.com/photo/flat-lay-of-a-woman-s-clothes-and-accessories-5405644/"),
  "shop-mixed":(7318916,"Minimal shopping bags", "https://www.pexels.com/photo/a-person-carrying-paper-bags-7318916/"),
  "shop-vesta":(1502219,"Pink skincare products flat lay", "https://www.pexels.com/photo/stylish-beauty-products-arranged-on-pink-table-1502219/"),
  "shop-cutella":(14481421,"Clothes hanging in a boutique", "https://www.pexels.com/photo/clothes-and-a-shopping-bag-on-a-hanging-rack-in-a-store-14481421/"),
  "beauty-care":(6187609,"Sustainable beauty and skincare on pink", "https://www.pexels.com/photo/beauty-products-on-pink-background-6187609/"),
  "closet-blank":(3927390,"Minimal clothing and accessories", "https://www.pexels.com/photo/flat-lay-of-clothing-and-accessories-3927390/"),
}
DEST=Path(os.environ.get("VESTALAND_PHOTO_DEST","assets/photos"))
DEST.mkdir(parents=True,exist_ok=True)
manifest={}
for name,(ident,description,source) in STOCK.items():
    url=f"https://images.pexels.com/photos/{ident}/pexels-photo-{ident}.jpeg?auto=compress&cs=tinysrgb&w=1100"
    assert urlsplit(url).hostname=="images.pexels.com"
    req=Request(url,headers={"Accept":"image/*","User-Agent":"Mozilla/5.0"})
    with urlopen(req,timeout=24) as response:
        mime=response.headers.get("Content-Type","").lower()
        if not mime.startswith("image/"):raise RuntimeError(f"{name}: source returned {mime}")
        data=response.read(6_000_001)
    if len(data)>6_000_000:raise RuntimeError(f"{name}: source over limit")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img=ImageOps.exif_transpose(img).convert("RGB")
            if min(img.size)<230:raise RuntimeError(f"{name}: image too small")
            img.thumbnail((1050,1050),Image.Resampling.LANCZOS)
            img.save(DEST/f"{name}.webp",format="WEBP",quality=80,method=5)
            dimensions=list(img.size)
    except (UnidentifiedImageError,OSError) as e:
        raise RuntimeError(f"{name}: invalid source image") from e
    size=(DEST/f"{name}.webp").stat().st_size
    if not 3_500<size<350_000:raise RuntimeError(f"{name}: invalid output size {size}")
    manifest[name]={"subject":description,"source_page":source,
                    "license":"https://www.pexels.com/license/","dimensions":dimensions,
                    "bytes":size,"usage":"decorative only, not a product thumbnail"}
    print(f"{name}: Pexels stock photo OK; {dimensions[0]}x{dimensions[1]}, {size//1024}KiB")
(DEST/"SOURCES.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("SUCCESS: nine licensed stock photographs prepared and verified.")

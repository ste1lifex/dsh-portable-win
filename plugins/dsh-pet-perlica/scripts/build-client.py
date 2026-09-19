#!/usr/bin/env python3
"""Build lib/client.js from src/client.template.js + the sprite atlas.

Reads ../spritesheet.webp (the perlica 9x8 atlas), base64-encodes it, and
substitutes the /*__ATLAS__*/ marker in the client template. The generated
client.js is fully self-contained (no host route needed for the sprite).
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "client.template.js"
ATLAS = ROOT.parent / "spritesheet.webp"
OUT = ROOT / "lib" / "client.js"

template = SRC.read_text(encoding="utf-8")
marker = "/*__ATLAS__*/"
assert marker in template, "template missing atlas marker"

data = ATLAS.read_bytes()
encoded = base64.b64encode(data).decode("ascii")
data_url = "data:image/webp;base64," + encoded

out = template.replace(marker, data_url)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(out, encoding="utf-8")

print(f"atlas: {len(data)} bytes -> base64 {len(encoded)} chars")
print(f"wrote {OUT} ({len(out)} bytes)")

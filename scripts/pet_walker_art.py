#!/usr/bin/env python3
"""Manage replacement art for the woman walking the poodle in the "For Pets" panel.

  python3 scripts/pet_walker_art.py list [--markdown]
  python3 scripts/pet_walker_art.py install SLOT IMAGE [--as-displayed]
  python3 scripts/pet_walker_art.py remove SLOT

A slot is one weather/outfit combination (see `list`). Installing a slot replaces only
her panel for that combination; every other combination keeps its original art, and
`remove` puts the original back. Nothing here edits the original scene sheets.

Pictures should be square, like the original panels. Any other shape is placed whole on a softened,
darkened copy of itself so nothing is cropped. Use --as-displayed for a picture that already shows
the final lighting (for example a screenshot of the site) so the night brightening is not applied twice.
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / 'public' / 'weather-fusion'
MANIFEST = DIR / 'pet-walker-art.js'
MAX_SIDE = 1024
SQUARE_TOLERANCE = 0.02


def node(code):
    out = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def slots():
    return node("import {WALKER_SLOTS} from './public/weather-fusion/exposure-scene.js';console.log(JSON.stringify(WALKER_SLOTS))")


def installed():
    return node("import {PET_WALKER_ART} from './public/weather-fusion/pet-walker-art.js';console.log(JSON.stringify(PET_WALKER_ART))")


def write_manifest(art):
    text = MANIFEST.read_text()
    entries = ''.join(
        f" {json.dumps(slot)}:{{file:{json.dumps(a['file'])},width:{a['width']},height:{a['height']}{',asDisplayed:true' if a.get('asDisplayed') else ''}}},\n"
        for slot, a in sorted(art.items()))
    text, n = re.subn(r"export const PET_WALKER_ART=\{.*?\n\};", lambda m: 'export const PET_WALKER_ART={\n' + entries + '};', text, flags=re.S)
    if n != 1:
        sys.exit('Could not find PET_WALKER_ART in ' + str(MANIFEST))
    version = re.search(r"PET_WALKER_VERSION='walker-(\d+)-v(\d+)'", text)
    if version:
        text = text.replace(version.group(0), f"PET_WALKER_VERSION='walker-{version.group(1)}-v{int(version.group(2)) + 1}'")
    MANIFEST.write_text(text)


def cmd_list(args):
    known, have = slots(), installed()
    if args.markdown:
        print('| Done | Slot | Picture to make |\n|---|---|---|')
        for s in known:
            print(f"| {'yes' if s['slot'] in have else ''} | `{s['slot']}` | {s['description']} |")
    else:
        for s in known:
            print(f"{'installed' if s['slot'] in have else 'original '}  {s['slot']:<24} {s['description']}")
    print(f"\n{len(have)} of {len(known)} slots use the new woman.", file=sys.stderr)


def square(image):
    """Return a square picture: square input as is, anything else whole on a softened copy of itself."""
    from PIL import Image, ImageFilter, ImageOps
    w, h = image.size
    side = min(max(w, h), MAX_SIDE)
    if abs(w / h - 1) <= SQUARE_TOLERANCE:
        return image if (w, h) == (side, side) else image.resize((side, side), Image.LANCZOS)
    scale = side / max(w, h)
    sharp = image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    backdrop = ImageOps.fit(image, (side, side), Image.LANCZOS).filter(ImageFilter.GaussianBlur(side * 0.05))
    backdrop = Image.blend(backdrop, Image.new('RGB', (side, side), (7, 18, 43)), 0.5)
    backdrop.paste(sharp, ((side - sharp.width) // 2, (side - sharp.height) // 2))
    return backdrop


def cmd_install(args):
    from PIL import Image
    known = {s['slot'] for s in slots()}
    if args.slot not in known:
        sys.exit(f"Unknown slot {args.slot!r}. Run `list` to see valid slots.")
    picture = square(Image.open(args.image).convert('RGB'))
    name = f'pet-walker-{args.slot}.webp'
    picture.save(DIR / name, 'WEBP', quality=90, method=6)
    art = installed()
    art[args.slot] = {'file': name, 'width': picture.width, 'height': picture.height, **({'asDisplayed': True} if args.as_displayed else {})}
    write_manifest(art)
    print(f"Installed {args.slot}: {name} ({picture.width}x{picture.height}).")


def cmd_remove(args):
    art = installed()
    entry = art.pop(args.slot, None)
    if not entry:
        sys.exit(f"{args.slot!r} is not installed.")
    (DIR / entry['file']).unlink(missing_ok=True)
    write_manifest(art)
    print(f"Removed {args.slot}; the original art shows there again.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('list'); p.add_argument('--markdown', action='store_true'); p.set_defaults(run=cmd_list)
    p = sub.add_parser('install'); p.add_argument('slot'); p.add_argument('image'); p.add_argument('--as-displayed', action='store_true'); p.set_defaults(run=cmd_install)
    p = sub.add_parser('remove'); p.add_argument('slot'); p.set_defaults(run=cmd_remove)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()

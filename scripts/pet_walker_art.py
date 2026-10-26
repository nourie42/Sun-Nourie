#!/usr/bin/env python3
"""Manage replacement art for the woman walking the poodle in the "For Pets" panel.

  python3 scripts/pet_walker_art.py list [--markdown]
  python3 scripts/pet_walker_art.py prompt SLOT
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


CHARACTER = ("Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, "
             "medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle "
             "on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture.")
OUTFIT = {
    'cold': "She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater.",
    'cool': "She wears a teal puffer jacket, jeans and white sneakers.",
    'mild': "She wears a cyan tank top, blue jeans and white sneakers.",
    'warm': "She wears a light tank top, shorts and white sneakers.",
    'hot': "She wears a light tank top, short shorts and white sneakers.",
}
RAIN_OUTFIT = {
    'cold': "She wears a yellow hooded raincoat over her winter clothes, scarf and brown boots; the poodle wears a blue knit sweater.",
    'cool': "She wears a yellow raincoat, jeans and rubber rain boots.",
    'mild': "She wears a yellow raincoat, jeans and rubber rain boots.",
    'warm': "She wears a yellow raincoat over a cyan top, blue shorts and white sneakers.",
}
SETTING = {
    ('night', 'night'): "A night park path under a full moon with glowing street lamps; dry pavement.",
    ('night', 'carry-umbrella'): "A night park path, cloudy moonlit sky, damp pavement; she carries a closed pink umbrella in her free hand.",
    ('night', 'rain'): "A night park path in steady rain, wet reflective pavement; she holds an open pink umbrella; the poodle shakes off water.",
    ('night', 'fog'): "A night park path in thick fog around glowing street lamps, soft moonlight; dry pavement.",
    ('day', 'normal'): "A bright sunny day, blue sky, green park, paved path.",
    ('day', 'watch'): "A cloudy day, soft gray-white sky, no rain gear needed.",
    ('day', 'fog'): "A foggy day, soft diffuse light and no direct sunlight.",
    ('day', 'rain'): "A rainy day, steady rain, wet pavement; she holds an open pink umbrella; the poodle shakes off water.",
    ('day', 'carry-umbrella'): "A cloudy day, rain possible; she carries a closed pink umbrella in her free hand.",
    ('day', 'hot'): "A blazing hot sunny day with heat haze; she wipes her brow and looks sweaty and uncomfortable; the poodle pants.",
    ('snow', 'snow'): "A snowy park with falling snow; she plays in the snow with the poodle, smiling.",
}


def prompt_for(slot_info):
    slot = slot_info['slot']
    kind = 'snow' if slot.startswith('snow') else slot.split('-')[0]
    key = 'snow' if kind == 'snow' else ('hot' if slot == 'day-hot-normal' else slot.split('-', 2)[2])
    setting = SETTING[(kind, key)]
    if slot == 'snow-dawn':
        setting = "A snowy park at dawn in soft blue-pink light, falling snow; she plays in the snow with the poodle, smiling."
    outfit = RAIN_OUTFIT[slot_info['outfit']] if key == 'rain' else OUTFIT[slot_info['outfit']]
    return f"{CHARACTER} {outfit} {setting}"


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
        print('\n## Ready-to-paste prompts\n')
        for s in known:
            print(f"**`{s['slot']}`**\n\n{prompt_for(s)}\n")
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


def cmd_prompt(args):
    match = [s for s in slots() if s['slot'] == args.slot]
    if not match:
        sys.exit(f"Unknown slot {args.slot!r}. Run `list` to see valid slots.")
    print(prompt_for(match[0]))


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
    p = sub.add_parser('prompt'); p.add_argument('slot'); p.set_defaults(run=cmd_prompt)
    p = sub.add_parser('remove'); p.add_argument('slot'); p.set_defaults(run=cmd_remove)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()

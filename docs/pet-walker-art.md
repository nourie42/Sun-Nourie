# Dog-walker art (the woman and her poodle)

The "For Pets" panel shows a woman walking a poodle. Her clothes change with the weather because every
weather/outfit combination has its own picture of her. Those pictures live inside the 3-panel scene sheets
(the boy panels share the same files), so the new woman is installed one combination ("slot") at a time:
a slot that has new art shows her, every other slot keeps showing the original art.

## What the new woman looks like

Dark curly hair in a high ponytail, medium-brown skin, big brown eyes, warm smile. An apricot toy poodle on a
blue leash with a blue collar. Soft pixar-style 3D cartoon look, the same park setting and lighting as the
panel being replaced (daytime park path, night park with moon and street lamps, rain, fog, snow).

## What to make for each slot

One **square** picture (1024 x 1024 or larger) per slot, showing her full body walking left to right with the
poodle at her side, in the same weather as the slot name says. Keep her face, hair and the dog identical
across every picture. Only the clothes and weather change:

* cold: heavy coat or puffer, scarf, warm beanie, gloves, boots; the poodle wears a blue knit sweater
* cool: a light jacket (for example teal puffer), jeans, white sneakers
* mild: cyan tank top, jeans, white sneakers
* warm: tank top and shorts or light pants, white sneakers
* hot: light tank top and shorts, visibly hot (hand to forehead, sweat drops)
* rain: yellow raincoat, open pink umbrella, wet pavement, the poodle shaking off water
* carry-umbrella: the umbrella is closed and carried, cloudy sky
* fog: soft diffuse fog, low light
* snow: heavy winter clothes, playing in the snow with the poodle

## Installing pictures

```
python3 scripts/pet_walker_art.py list                         # what is done / what is left
python3 scripts/pet_walker_art.py install night-cool-night my-picture.png
python3 scripts/pet_walker_art.py remove night-cool-night      # back to the original art
```

Square pictures are used as they are, like the original panels. A picture that is not square is placed whole on a
softened, darkened copy of itself, so nothing is cropped (this is how the first one, a screenshot crop, is made).
Add `--as-displayed` for a picture that already shows its final lighting, such as a screenshot of the site.

## Slots

| Done | Slot | Picture to make |
|---|---|---|
|  | `night-cold-night` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · dry, clear night |
|  | `night-cold-carry-umbrella` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · rain possible, carrying a closed umbrella |
|  | `night-cold-rain` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · steady rain |
|  | `night-cold-fog` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · fog |
|  | `night-cool-night` | Night · cool-weather clothes (light jacket, long pants) · dry, clear night |
|  | `night-cool-carry-umbrella` | Night · cool-weather clothes (light jacket, long pants) · rain possible, carrying a closed umbrella |
|  | `night-cool-rain` | Night · cool-weather clothes (light jacket, long pants) · steady rain |
|  | `night-cool-fog` | Night · cool-weather clothes (light jacket, long pants) · fog |
| yes | `night-mild-night` | Night · mild-weather clothes (top and long pants) · dry, clear night |
|  | `night-mild-carry-umbrella` | Night · mild-weather clothes (top and long pants) · rain possible, carrying a closed umbrella |
|  | `night-mild-rain` | Night · mild-weather clothes (top and long pants) · steady rain |
|  | `night-mild-fog` | Night · mild-weather clothes (top and long pants) · fog |
|  | `night-warm-night` | Night · warm-weather clothes (tank top, shorts or light pants) · dry, clear night |
|  | `night-warm-carry-umbrella` | Night · warm-weather clothes (tank top, shorts or light pants) · rain possible, carrying a closed umbrella |
|  | `night-warm-rain` | Night · warm-weather clothes (tank top, shorts or light pants) · steady rain |
|  | `night-warm-fog` | Night · warm-weather clothes (tank top, shorts or light pants) · fog |
|  | `day-cold-normal` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · clear or partly cloudy |
|  | `day-cold-watch` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · cloudy |
|  | `day-cold-fog` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · fog |
|  | `day-cold-rain` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · steady rain |
|  | `day-cold-carry-umbrella` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · rain possible, carrying a closed umbrella |
|  | `day-cool-normal` | Day · cool-weather clothes (light jacket, long pants) · clear or partly cloudy |
|  | `day-cool-watch` | Day · cool-weather clothes (light jacket, long pants) · cloudy |
|  | `day-cool-fog` | Day · cool-weather clothes (light jacket, long pants) · fog |
|  | `day-cool-rain` | Day · cool-weather clothes (light jacket, long pants) · steady rain |
|  | `day-cool-carry-umbrella` | Day · cool-weather clothes (light jacket, long pants) · rain possible, carrying a closed umbrella |
|  | `day-mild-normal` | Day · mild-weather clothes (top and long pants) · clear or partly cloudy |
|  | `day-mild-watch` | Day · mild-weather clothes (top and long pants) · cloudy |
|  | `day-mild-fog` | Day · mild-weather clothes (top and long pants) · fog |
|  | `day-mild-carry-umbrella` | Day · mild-weather clothes (top and long pants) · rain possible, carrying a closed umbrella |
|  | `day-warm-normal` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · clear or partly cloudy |
|  | `day-warm-watch` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · cloudy |
|  | `day-warm-fog` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · fog |
|  | `day-warm-rain` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · steady rain |
|  | `day-warm-carry-umbrella` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · rain possible, carrying a closed umbrella |
|  | `day-hot-normal` | Day · very hot weather clothes · visibly reacting to extreme heat |
|  | `snow-day` | Day · heavy winter clothes · playing in the snow with the poodle |
|  | `snow-dawn` | Dawn/dusk/night · heavy winter clothes · playing in the snow with the poodle |


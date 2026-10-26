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
| yes | `night-cold-night` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · dry, clear night |
| yes | `night-cold-carry-umbrella` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · rain possible, carrying a closed umbrella |
| yes | `night-cold-rain` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · steady rain |
| yes | `night-cold-fog` | Night · cold-weather clothes (heavy coat, scarf, hat, boots) · fog |
| yes | `night-cool-night` | Night · cool-weather clothes (light jacket, long pants) · dry, clear night |
| yes | `night-cool-carry-umbrella` | Night · cool-weather clothes (light jacket, long pants) · rain possible, carrying a closed umbrella |
| yes | `night-cool-rain` | Night · cool-weather clothes (light jacket, long pants) · steady rain |
| yes | `night-cool-fog` | Night · cool-weather clothes (light jacket, long pants) · fog |
| yes | `night-mild-night` | Night · mild-weather clothes (top and long pants) · dry, clear night |
| yes | `night-mild-carry-umbrella` | Night · mild-weather clothes (top and long pants) · rain possible, carrying a closed umbrella |
| yes | `night-mild-rain` | Night · mild-weather clothes (top and long pants) · steady rain |
| yes | `night-mild-fog` | Night · mild-weather clothes (top and long pants) · fog |
| yes | `night-warm-night` | Night · warm-weather clothes (tank top, shorts or light pants) · dry, clear night |
| yes | `night-warm-carry-umbrella` | Night · warm-weather clothes (tank top, shorts or light pants) · rain possible, carrying a closed umbrella |
| yes | `night-warm-rain` | Night · warm-weather clothes (tank top, shorts or light pants) · steady rain |
| yes | `night-warm-fog` | Night · warm-weather clothes (tank top, shorts or light pants) · fog |
| yes | `day-cold-normal` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · clear or partly cloudy |
| yes | `day-cold-watch` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · cloudy |
| yes | `day-cold-fog` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · fog |
| yes | `day-cold-rain` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · steady rain |
| yes | `day-cold-carry-umbrella` | Day · cold-weather clothes (heavy coat, scarf, hat, boots) · rain possible, carrying a closed umbrella |
| yes | `day-cool-normal` | Day · cool-weather clothes (light jacket, long pants) · clear or partly cloudy |
| yes | `day-cool-watch` | Day · cool-weather clothes (light jacket, long pants) · cloudy |
| yes | `day-cool-fog` | Day · cool-weather clothes (light jacket, long pants) · fog |
| yes | `day-cool-rain` | Day · cool-weather clothes (light jacket, long pants) · steady rain |
| yes | `day-cool-carry-umbrella` | Day · cool-weather clothes (light jacket, long pants) · rain possible, carrying a closed umbrella |
| yes | `day-mild-normal` | Day · mild-weather clothes (top and long pants) · clear or partly cloudy |
| yes | `day-mild-watch` | Day · mild-weather clothes (top and long pants) · cloudy |
| yes | `day-mild-fog` | Day · mild-weather clothes (top and long pants) · fog |
| yes | `day-mild-carry-umbrella` | Day · mild-weather clothes (top and long pants) · rain possible, carrying a closed umbrella |
| yes | `day-warm-normal` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · clear or partly cloudy |
| yes | `day-warm-watch` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · cloudy |
| yes | `day-warm-fog` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · fog |
| yes | `day-warm-rain` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · steady rain |
| yes | `day-warm-carry-umbrella` | Day · warm-weather clothes (tank top, shorts or light pants) (also used when the feels-like temperature is unavailable) · rain possible, carrying a closed umbrella |
| yes | `day-hot-normal` | Day · very hot weather clothes · visibly reacting to extreme heat |
| yes | `snow-day` | Day · heavy winter clothes · playing in the snow with the poodle |
| yes | `snow-dawn` | Dawn/dusk/night · heavy winter clothes · playing in the snow with the poodle |

## Ready-to-paste prompts

**`night-cold-night`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A night park path under a full moon with glowing street lamps; dry pavement.

**`night-cold-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A night park path, cloudy moonlit sky, damp pavement; she carries a closed pink umbrella in her free hand.

**`night-cold-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow hooded raincoat over her winter clothes, scarf and brown boots; the poodle wears a blue knit sweater. A night park path in steady rain, wet reflective pavement; she holds an open pink umbrella; the poodle shakes off water.

**`night-cold-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A night park path in thick fog around glowing street lamps, soft moonlight; dry pavement.

**`night-cool-night`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A night park path under a full moon with glowing street lamps; dry pavement.

**`night-cool-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A night park path, cloudy moonlit sky, damp pavement; she carries a closed pink umbrella in her free hand.

**`night-cool-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow raincoat, jeans and rubber rain boots. A night park path in steady rain, wet reflective pavement; she holds an open pink umbrella; the poodle shakes off water.

**`night-cool-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A night park path in thick fog around glowing street lamps, soft moonlight; dry pavement.

**`night-mild-night`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A night park path under a full moon with glowing street lamps; dry pavement.

**`night-mild-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A night park path, cloudy moonlit sky, damp pavement; she carries a closed pink umbrella in her free hand.

**`night-mild-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow raincoat, jeans and rubber rain boots. A night park path in steady rain, wet reflective pavement; she holds an open pink umbrella; the poodle shakes off water.

**`night-mild-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A night park path in thick fog around glowing street lamps, soft moonlight; dry pavement.

**`night-warm-night`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A night park path under a full moon with glowing street lamps; dry pavement.

**`night-warm-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A night park path, cloudy moonlit sky, damp pavement; she carries a closed pink umbrella in her free hand.

**`night-warm-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow raincoat over a cyan top, blue shorts and white sneakers. A night park path in steady rain, wet reflective pavement; she holds an open pink umbrella; the poodle shakes off water.

**`night-warm-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A night park path in thick fog around glowing street lamps, soft moonlight; dry pavement.

**`day-cold-normal`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A bright sunny day, blue sky, green park, paved path.

**`day-cold-watch`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A cloudy day, soft gray-white sky, no rain gear needed.

**`day-cold-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A foggy day, soft diffuse light and no direct sunlight.

**`day-cold-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow hooded raincoat over her winter clothes, scarf and brown boots; the poodle wears a blue knit sweater. A rainy day, steady rain, wet pavement; she holds an open pink umbrella; the poodle shakes off water.

**`day-cold-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A cloudy day, rain possible; she carries a closed pink umbrella in her free hand.

**`day-cool-normal`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A bright sunny day, blue sky, green park, paved path.

**`day-cool-watch`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A cloudy day, soft gray-white sky, no rain gear needed.

**`day-cool-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A foggy day, soft diffuse light and no direct sunlight.

**`day-cool-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow raincoat, jeans and rubber rain boots. A rainy day, steady rain, wet pavement; she holds an open pink umbrella; the poodle shakes off water.

**`day-cool-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a teal puffer jacket, jeans and white sneakers. A cloudy day, rain possible; she carries a closed pink umbrella in her free hand.

**`day-mild-normal`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A bright sunny day, blue sky, green park, paved path.

**`day-mild-watch`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A cloudy day, soft gray-white sky, no rain gear needed.

**`day-mild-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A foggy day, soft diffuse light and no direct sunlight.

**`day-mild-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cyan tank top, blue jeans and white sneakers. A cloudy day, rain possible; she carries a closed pink umbrella in her free hand.

**`day-warm-normal`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A bright sunny day, blue sky, green park, paved path.

**`day-warm-watch`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A cloudy day, soft gray-white sky, no rain gear needed.

**`day-warm-fog`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A foggy day, soft diffuse light and no direct sunlight.

**`day-warm-rain`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a yellow raincoat over a cyan top, blue shorts and white sneakers. A rainy day, steady rain, wet pavement; she holds an open pink umbrella; the poodle shakes off water.

**`day-warm-carry-umbrella`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, shorts and white sneakers. A cloudy day, rain possible; she carries a closed pink umbrella in her free hand.

**`day-hot-normal`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a light tank top, short shorts and white sneakers. A blazing hot sunny day with heat haze; she wipes her brow and looks sweaty and uncomfortable; the poodle pants.

**`snow-day`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A snowy park with falling snow; she plays in the snow with the poodle, smiling.

**`snow-dawn`**

Pixar-style 3D cartoon illustration, square 1:1 image. A young woman with dark curly hair in a high ponytail, medium-brown skin, big brown eyes and a warm smile, walking left to right on a park path with her apricot toy poodle on a blue leash (blue collar). Full body visible, the dog fully in frame. Keep her face, hair and the dog identical to the reference picture. She wears a cream puffer coat with a fur-trimmed hood, a knit beanie, a blue scarf, gloves, jeans and brown boots; the poodle wears a blue knit sweater. A snowy park at dawn in soft blue-pink light, falling snow; she plays in the snow with the poodle, smiling.


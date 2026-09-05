from pathlib import Path
p=Path('public/weather-fusion/index.html')
s=p.read_text()
old='''        <div class="hero-temperature" id="temperature" role="button" tabindex="0" aria-label="Open temperature forecast graph" aria-haspopup="dialog">—<span>°</span></div>
        <div class="skin-exposure" id="skin-exposure" aria-live="polite">
          <h2 class="skin-kicker">How’s it really gonna feel?</h2>
          <div class="skin-values" id="skin-values">Checking how it will feel…</div>
          <p class="skin-explanation" id="skin-explanation">A little more useful than the temperature alone.</p>
          <a class="science-link" href="#scientific-stuff">Scientific stuff further down ↓</a>
        </div>
        <div class="hero-condition" id="condition">Gathering the latest forecast</div>
        <div class="hero-range" id="high-low">High —° <span>Low —°</span></div>
        <div class="observation-label" id="observation-label">The latest weather near you</div>'''
new='''        <div class="hero-temperature" id="temperature" role="button" tabindex="0" aria-label="Open temperature forecast graph" aria-haspopup="dialog">—<span>°</span></div>
        <div class="hero-condition" id="condition">Gathering the latest forecast</div>
        <div class="hero-range" id="high-low">High —° <span>Low —°</span></div>
        <div class="observation-label" id="observation-label">The latest weather near you</div>
        <div class="skin-exposure" id="skin-exposure" aria-live="polite">
          <h2 class="skin-kicker">How’s it really gonna feel?</h2>
          <div class="skin-values" id="skin-values">Checking how it will feel…</div>
          <p class="skin-explanation" id="skin-explanation">A little more useful than the temperature alone.</p>
          <a class="science-link" href="#scientific-stuff">Scientific stuff further down ↓</a>
        </div>'''
assert old in s, 'Hero markup changed; refusing a blind patch'
p.write_text(s.replace(old,new,1))

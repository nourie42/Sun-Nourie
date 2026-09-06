from pathlib import Path

def replace_once(path,old,new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old,new))

replace_once(
 'scripts/weatherFusionBrowserSmoke.js',
 "return /°.*(?:in the shade|right now)/.test(value)&&/Steadman apparent temperature/.test(science);",
 "return /°.*(?:in the shade|right now)/.test(value)&&/(?:UTCI Tier-3|Steadman apparent temperature)/.test(science);"
)
replace_once(
 'scripts/weatherFusionPersonalBrowser.js',
 "assert.equal((await page.locator('#temperature').innerText()).trim(),'75°');assert.match(await page.locator('.sun-person').innerText(),/Under clouds/);assert.equal(await page.locator('.sun-person .sky-sun').count(),0);assert.ok((await page.locator('.sun-person').innerText()).includes('71°'));report.nightCurrentTemperature=true;",
 "assert.equal((await page.locator('#temperature').innerText()).trim(),'75°');assert.match(await page.locator('.sun-person').innerText(),/Under clouds/);assert.equal(await page.locator('.sun-person .sky-sun').count(),0);assert.ok((await page.locator('.sun-person').innerText()).includes(Math.round(fixture().comfort.shade)+'°'));report.nightCurrentTemperature=true;"
)
print('Updated browser checks to validate the current thermal contract instead of stale hard-coded text.')

from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:90]}")
    p.write_text(text.replace(old, new))


replace_once(
    "src/weatherFusionExperience.js",
    "All numbers are displayed by the app: use no digit characters or numerical quantities in prose.",
    'Weather values and quantities are displayed by the app: do not include numerical weather values or other quantities in prose. Clock times are the only numeric exception: when a time is useful, write it with digits in h:mmam/pm form such as "2:02pm"; never spell out clock times such as "two oh two pm".',
)

replace_once(
    "src/weatherFusion.js",
    "const clean = (v, size = 500) => typeof v === 'string' ? v.slice(0, size) : '';",
    "const clean = (v, size = 500) => typeof v === 'string' ? v.slice(0, size) : '';\nconst CLOCK_TIME = /\\b(1[0-2]|[1-9]):([0-5]\\d)\\s*(am|pm)\\b/gi;\nconst normalizeClockTimes = (value) => typeof value === 'string' ? value.replace(CLOCK_TIME, (_, hour, minute, meridiem) => `${hour}:${minute}${meridiem.toLowerCase()}`) : value;\nconst hasNonClockDigits = (value) => /\\d/.test(String(value).replace(CLOCK_TIME, 'CLOCK'));",
)
replace_once(
    "src/weatherFusion.js",
    "The previous attempt failed automated validation. Return every required source ID exactly. Do not include any digit characters in prose; refer to today, tonight, tomorrow and the week ahead. Keep every prose field nonempty and concise. Do not issue weather warnings or promise safe conditions.",
    "The previous attempt failed automated validation. Return every required source ID exactly. Do not include numeric weather values or quantities. Clock times are the only numeric exception and must use h:mmam/pm form, such as 2:02pm. Keep every prose field nonempty and concise. Do not issue weather warnings or promise safe conditions.",
)
replace_once(
    "src/weatherFusion.js",
    "Copy every required source ID into the sources array. Write concise professional prose with no digit characters.",
    "Copy every required source ID into the sources array. Write concise professional prose without numeric weather values or quantities. Clock times are allowed only in h:mmam/pm form, such as 2:02pm.",
)
replace_once(
    "src/weatherFusion.js",
    "if (fields.some((k) => /\\d/.test(content[k]))) throw Object.assign(new Error('AI numerical prose failed validation.'), { aiDiagnostic: 'AI_PROSE_CONTAINS_DIGITS' });",
    "if (fields.some((k) => hasNonClockDigits(content[k]))) throw Object.assign(new Error('AI numerical prose failed validation.'), { aiDiagnostic: 'AI_PROSE_CONTAINS_NONCLOCK_DIGITS' });",
)
replace_once(
    "src/weatherFusion.js",
    "return { ...content, mode: 'ai', signature: data.signature, generatedAt: iso(now()), model: env.WEATHER_FUSION_AI_MODEL || 'gpt-5-mini' };",
    "for (const k of fields) content[k] = normalizeClockTimes(content[k]);\n        return { ...content, mode: 'ai', signature: data.signature, generatedAt: iso(now()), model: env.WEATHER_FUSION_AI_MODEL || 'gpt-5-mini' };",
)

p = Path("test/weatherFusion.test.js")
text = p.read_text()
old_sources = '\"sources\":[\"nws\",\"afd\"]}'
new_sources = '\"sources\":[\"nws\",\"afd\",\"hrrr\",\"ecmwf\",\"nbm\"]}'
if text.count(old_sources) < 1:
    raise SystemExit("Could not isolate invalid-numerical AI test sources")
text = text.replace(old_sources, new_sources, 1)
marker = "test('fresh NWS forecast and AFD are required for AI', async () => {"
addition = """test('AI outlook allows clock times, normalizes them to h:mmam/pm, and still blocks weather numbers', async () => {\n  const s = createWeatherService({ now: () => now, env: { OPENAI_API_KEY: 'TEST', WEATHER_FUSION_NONCOMMERCIAL: 'true' }, fetchImpl: async (url, options) => {\n    if (url.includes('api.openai.com')) return response({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({headline:'Sunday outlook',summary:'As of Sunday at 2:02 PM, clouds remain nearby.',nearTerm:'Showers may develop later.',extended:'The week starts quieter.',uncertainty:'Rain coverage remains uncertain.',sources:['nws','afd','hrrr','ecmwf','nbm']}) }] }] });\n    return mockFetch(url, options);\n  } });\n  const b = await s.getBriefing({ location: 'knightdale' }); assert.equal(b.mode, 'ai'); assert.match(b.summary,/2:02pm/); assert.ok(!b.summary.includes('2:02 PM'));\n});\n"""
if text.count(marker) != 1:
    raise SystemExit("Could not insert clock-time regression test")
text = text.replace(marker, addition + marker)
p.write_text(text)

p = Path("test/weatherFusionHourlyConsistency.test.js")
text = p.read_text()
old = "assert.match(read('exposure-scene.js'),/person-eyes/);assert.match(read('exposure-scene.js'),/person-smile/);assert.match(read('exposure-scene.js'),/friendly-wave/);\n assert.match(read('hourly-feels.css'),/prefers-reduced-motion:reduce/);"
new = "const scene=read('exposure-scene.js'),css=read('hourly-feels.css');\n assert.match(scene,/person-eyes/);assert.match(scene,/person-smile/);assert.match(scene,/friendly-raised-arm/);assert.match(scene,/friendly-wave/);assert.ok(scene.indexOf('friendly-raised-arm')<scene.indexOf('<g class=\\\"friendly-wave\\\">'));\n assert.match(css,/transform-box:fill-box/);assert.match(css,/prefers-reduced-motion:reduce/);"
if text.count(old) != 1:
    raise SystemExit("Could not strengthen wave regression test")
p.write_text(text.replace(old, new))

// Forecast assembly formats thousands of hourly dates. Reuse the expensive
// ICU formatters, with a bounded registry for different time zones and options.
const formatters = new Map();
const MAX_FORMATTERS = 64;

export function weatherDateTimeFormat(locale, options) {
  const key = JSON.stringify([locale, options]);
  const saved = formatters.get(key);
  if (saved) return saved;
  const formatter = new Intl.DateTimeFormat(locale, options);
  if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value);
  formatters.set(key, formatter);
  return formatter;
}

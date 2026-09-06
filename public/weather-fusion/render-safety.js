/** A chart failure must not suppress alerts, the outlook, metrics, or map startup. */
export function renderWeatherPanel(id, label, renderer, onError = console.error) {
  const target = () => document.getElementById(id);
  target()?.querySelector('[data-weather-render-error]')?.remove();
  try {
    renderer();
    target()?.removeAttribute('data-render-failed');
    return true;
  } catch (error) {
    onError(error);
    const panel = target();
    if (panel) {
      panel.dataset.renderFailed = 'true';
      const message = document.createElement('p');
      message.dataset.weatherRenderError = 'true';
      message.className = 'alert-note warning';
      message.setAttribute('role', 'status');
      message.textContent = `${label} could not be displayed. Other forecasts remain available. Use Refresh to retry.`;
      panel.append(message);
    }
    return false;
  }
}

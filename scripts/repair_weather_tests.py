from pathlib import Path

p = Path('.github/workflows/weather-reviewed-integrity.yml')
text = p.read_text()
text = text.replace(
    'branches: [fix/weather-reviewed-integrity, main]',
    'branches: [fix/weather-reviewed-integrity, fix/weather-current-feels-inputs, main]',
)
text = text.replace(
    "if: github.ref == 'refs/heads/fix/weather-reviewed-integrity'",
    "if: github.ref == 'refs/heads/fix/weather-reviewed-integrity' || github.ref == 'refs/heads/fix/weather-current-feels-inputs'",
)
text = text.replace(
    'git commit -m "Verify forecast integrity: dated Dan take, hourly sky, independent UTCI and centered temperatures"\n          git push origin HEAD:fix/weather-reviewed-integrity',
    'git commit -m "Verify current feels-like fallback and forecast integrity"\n          git push origin HEAD:fix/weather-current-feels-inputs',
)
p.write_text(text)
print('Kept the temporary verification workflow byte-for-byte on the repair branch.')

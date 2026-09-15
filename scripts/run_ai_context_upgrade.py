from pathlib import Path
import runpy

runpy.run_path('scripts/apply_ai_context_upgrade.py', run_name='__main__')

# Repair escaped newlines that must stay inside JavaScript string literals.
p = Path('src/aiCouncil.js')
s = p.read_text()
s = s.replace('].filter(Boolean).join("\n\n");', '].filter(Boolean).join("\\n\\n");')
p.write_text(s)

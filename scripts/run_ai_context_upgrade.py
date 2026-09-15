from pathlib import Path
import runpy

runpy.run_path('scripts/apply_ai_context_upgrade.py', run_name='__main__')

# Repair escaped newlines that must stay inside JavaScript string literals.
p = Path('src/aiCouncil.js')
s = p.read_text()
s = s.replace('].filter(Boolean).join("\n\n");', '].filter(Boolean).join("\\n\\n");')
p.write_text(s)

# The family page originally used an async web-search toggle. Replace the entire
# leftover handler with the new always-automatic Internet behavior.
p = Path('public/ai-council/family-v2.js')
s = p.read_text()
s = s.replace(
    "els.familyWebBtn.onclick=()=>{webOn=true;vault.webOn=true;renderProviderButton()};vault.webOn=webOn;await save();renderProviderButton()};els.familySendBtn.onclick=sendMain;",
    "els.familyWebBtn.onclick=()=>{webOn=true;vault.webOn=true;renderProviderButton()};els.familySendBtn.onclick=sendMain;",
)
p.write_text(s)

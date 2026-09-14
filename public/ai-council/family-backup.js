(() => {
  'use strict';

  const member = document.documentElement.dataset.member || 'Family';
  const slug = member.toLowerCase();
  const storageKey = `ai-family-vault-${slug}-v1`;

  function currentRecord() {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); }
    catch { return null; }
  }

  function saveFile(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    const record = currentRecord();
    if (!record?.salt || !record?.iv || !record?.cipher) {
      alert('Create or restore this private page before making a backup.');
      return;
    }
    const backup = {
      format: 'sun-nourie-family-vault',
      version: 1,
      member,
      exportedAt: new Date().toISOString(),
      encryptedVault: record,
    };
    const date = new Date().toISOString().slice(0, 10);
    saveFile(`${slug}-ai-bots-backup-${date}.json`, JSON.stringify(backup, null, 2));
  }

  async function restoreBackup(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.format !== 'sun-nourie-family-vault' || payload?.version !== 1) {
        throw new Error('That is not a compatible encrypted family-bot backup.');
      }
      if (String(payload.member || '').toLowerCase() !== slug) {
        throw new Error(`This backup belongs to ${payload.member || 'another family page'}, not ${member}.`);
      }
      const record = payload.encryptedVault;
      if (!record?.salt || !record?.iv || !record?.cipher) throw new Error('The encrypted vault is missing from this backup.');
      const existing = currentRecord();
      if (existing && !confirm(`Replace the encrypted ${member} workspace on this device with this backup?`)) return;
      localStorage.setItem(storageKey, JSON.stringify(record));
      alert(`Encrypted ${member} backup restored. Unlock it with the same secret key used when the backup was created.`);
      location.reload();
    } catch (error) {
      alert(error?.message || 'Could not restore that backup.');
    }
  }

  function makeRestoreButton(label = 'Restore Backup') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill';
    button.textContent = label;
    button.addEventListener('click', () => fileInput.click());
    return button;
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await restoreBackup(file);
    fileInput.value = '';
  });
  document.body.appendChild(fileInput);

  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.querySelector('#bots-view .toolbar');
    if (toolbar) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'pill';
      exportButton.textContent = 'Encrypted Backup';
      exportButton.addEventListener('click', exportBackup);
      toolbar.append(exportButton, makeRestoreButton());
    }

    const lockCard = document.querySelector('#lock .lockCard');
    if (lockCard) {
      const area = document.createElement('div');
      area.className = 'actions';
      area.style.marginTop = '12px';
      const restore = makeRestoreButton('Restore Encrypted Backup');
      restore.className = 'secondary';
      area.append(restore);
      lockCard.append(area);
    }
  });
})();

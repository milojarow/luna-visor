const ApiKeysPage = {
  el: null,
  banner: null,
  listEl: null,
  filterSelect: null,
  filterClientId: '',
  keys: [],

  init() {
    this.el = document.getElementById('api-keys-view');
    this.banner = document.getElementById('api-keys-banner');
    this.listEl = document.getElementById('api-keys-list');
    this.filterSelect = document.getElementById('api-keys-filter');

    this.filterSelect.addEventListener('change', () => {
      this.filterClientId = this.filterSelect.value;
      this.renderList();
    });
    document.getElementById('btn-new-api-key').addEventListener('click', () => this.promptCreate());
  },

  async show() {
    this.el.hidden = false;
    document.getElementById('gallery').hidden = true;
    document.querySelector('.toolbar-gallery').hidden = true;
    document.querySelector('.toolbar-api-keys').hidden = false;
    document.getElementById('btn-upload').hidden = true;
    document.getElementById('current-view-title').textContent = 'API Keys';
    this.populateFilter();
    await this.loadKeys();
  },

  hide() {
    this.el.hidden = true;
    document.getElementById('gallery').hidden = false;
    document.querySelector('.toolbar-gallery').hidden = false;
    document.querySelector('.toolbar-api-keys').hidden = true;
    document.getElementById('btn-upload').hidden = false;
    this.banner.hidden = true;
    this.banner.innerHTML = '';
  },

  populateFilter() {
    const current = this.filterSelect.value;
    this.filterSelect.innerHTML = '<option value="">All clients</option>';
    for (const c of App.clients) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      this.filterSelect.appendChild(opt);
    }
    this.filterSelect.value = current;
  },

  async loadKeys() {
    try {
      this.keys = await API.getApiKeys();
      this.renderList();
    } catch (err) {
      this.listEl.innerHTML = `<p class="api-keys-empty">Failed to load keys: ${err.message}</p>`;
    }
  },

  renderList() {
    this.listEl.innerHTML = '';
    const filtered = this.filterClientId
      ? this.keys.filter(k => String(k.client_id) === String(this.filterClientId))
      : this.keys;

    if (filtered.length === 0) {
      const msg = this.filterClientId ? 'No API keys for this client.' : 'No API keys yet.';
      this.listEl.innerHTML = `<p class="api-keys-empty">${msg}</p>`;
      return;
    }

    for (const k of filtered) {
      const row = document.createElement('div');
      const revoked = !!k.revoked_at;
      row.className = revoked ? 'api-key-row api-key-row-revoked' : 'api-key-row';
      row.dataset.id = k.id;
      const dateStr = new Date(k.created_at + 'Z').toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      const revokedDateStr = revoked ? new Date(k.revoked_at + 'Z').toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
      }) : '';
      const revokedBadge = revoked
        ? `<span class="api-key-meta-sep">·</span><span class="api-key-revoked-badge">Revoked ${revokedDateStr}</span>`
        : '';
      const renameBtn = revoked ? '' : `
            <button class="btn-icon-edit" title="Rename" data-action="rename">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M11.5 1.5l3 3-9 9H2.5v-3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>`;
      const deleteBtn = revoked ? '' : `
        <button class="btn-icon-danger" title="Revoke" data-action="delete">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 4h10M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4v9.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" fill="none" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>`;
      row.innerHTML = `
        <div class="api-key-info">
          <div class="api-key-name">
            <span class="api-key-name-text">${escapeHtml(k.name)}</span>${renameBtn}
          </div>
          <div class="api-key-meta">
            <span class="api-key-client">${escapeHtml(k.client_name)}</span>
            <span class="api-key-meta-sep">·</span>
            <span class="api-key-preview">…${k.key_preview}</span>
            <span class="api-key-meta-sep">·</span>
            <span class="api-key-date">Created ${dateStr}</span>
            ${revokedBadge}
          </div>
        </div>
        ${deleteBtn}
      `;
      const renameEl = row.querySelector('[data-action="rename"]');
      if (renameEl) renameEl.addEventListener('click', () => this.promptRename(k));
      const deleteEl = row.querySelector('[data-action="delete"]');
      if (deleteEl) deleteEl.addEventListener('click', () => this.confirmDelete(k));
      this.listEl.appendChild(row);
    }
  },

  promptCreate() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const clientOptions = App.clients
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
    overlay.innerHTML = `
      <div class="modal">
        <h3>New API Key</h3>
        <div class="api-keys-create-form">
          <input type="text" id="ak-create-name" placeholder="Key name (e.g. Production Server)">
          <select id="ak-create-client">
            <option value="">Select a client…</option>
            ${clientOptions}
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" data-action="cancel">Cancel</button>
          <button class="btn-primary" data-action="ok">Generate</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#ak-create-name');
    const clientSelect = overlay.querySelector('#ak-create-client');
    nameInput.focus();

    if (this.filterClientId) clientSelect.value = this.filterClientId;

    const cleanup = () => document.body.removeChild(overlay);

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cleanup();
      if (e.key === 'Enter') overlay.querySelector('[data-action="ok"]').click();
    });

    overlay.querySelector('[data-action="ok"]').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const clientId = parseInt(clientSelect.value);
      if (!name) return alert('Name is required');
      if (!clientId) return alert('Select a client');
      try {
        const result = await API.createApiKey(name, clientId);
        cleanup();
        this.showReveal(result.key);
        await this.loadKeys();
      } catch (err) {
        alert(err.message);
      }
    });
  },

  async promptRename(key) {
    const newName = await App.showPrompt('Rename API key', 'New name:', key.name);
    if (newName == null || newName.trim() === '' || newName === key.name) return;
    try {
      await API.renameApiKey(key.id, newName.trim());
      await this.loadKeys();
    } catch (err) {
      alert(err.message);
    }
  },

  async confirmDelete(key) {
    if (!confirm(`Revoke API key "${key.name}"? Applications using it will lose access.`)) return;
    try {
      await API.deleteApiKey(key.id);
      await this.loadKeys();
    } catch (err) {
      alert(err.message);
    }
  },

  showReveal(rawKey) {
    this.banner.innerHTML = `
      <div class="api-key-warning">⚠ Copy this key now — it will not be shown again.</div>
      <div class="api-key-reveal-row">
        <input type="text" readonly value="${rawKey}">
        <button class="btn-secondary" data-action="copy">Copy</button>
        <button class="btn-secondary" data-action="dismiss">Done</button>
      </div>
    `;
    this.banner.hidden = false;
    const input = this.banner.querySelector('input');
    input.focus();
    input.select();

    this.banner.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      await copyToClipboard(rawKey);
      const btn = this.banner.querySelector('[data-action="copy"]');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
    this.banner.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      this.banner.hidden = true;
      this.banner.innerHTML = '';
    });
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

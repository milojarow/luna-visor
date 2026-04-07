const ApiKeys = {
  async show() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal api-keys-modal">
        <div class="api-keys-header">
          <h3>API Keys</h3>
          <button class="btn-secondary" id="ak-close">Close</button>
        </div>
        <div id="ak-list"></div>
        <div class="api-keys-create">
          <h4>Create New Key</h4>
          <div class="api-keys-form">
            <input type="text" id="ak-name" placeholder="Key name (e.g. Blindando Production)">
            <select id="ak-client"></select>
            <button class="btn-primary" id="ak-generate">Generate</button>
          </div>
        </div>
        <div id="ak-reveal" hidden></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Populate client dropdown
    const select = overlay.querySelector('#ak-client');
    for (const c of App.clients) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    }

    // Load existing keys
    await this.renderList(overlay);

    // Event listeners
    overlay.querySelector('#ak-close').addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    overlay.querySelector('#ak-generate').addEventListener('click', async () => {
      const name = overlay.querySelector('#ak-name').value.trim();
      const clientId = parseInt(overlay.querySelector('#ak-client').value);
      if (!name) return alert('Name is required');
      if (!clientId) return alert('Select a client');
      try {
        const result = await API.createApiKey(name, clientId);
        this.showReveal(overlay, result.key);
        overlay.querySelector('#ak-name').value = '';
        await this.renderList(overlay);
      } catch (err) {
        alert(err.message);
      }
    });
    overlay.querySelector('#ak-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#ak-generate').click();
    });
  },

  async renderList(overlay) {
    const container = overlay.querySelector('#ak-list');
    try {
      const keys = await API.getApiKeys();
      if (keys.length === 0) {
        container.innerHTML = '<p class="api-keys-empty">No API keys created yet.</p>';
        return;
      }
      container.innerHTML = keys.map(k => `
        <div class="api-key-row" data-id="${k.id}">
          <div class="api-key-info">
            <span class="api-key-name">${k.name}</span>
            <span class="api-key-meta">${k.client_name} &middot; ****${k.key_preview} &middot; ${new Date(k.created_at + 'Z').toLocaleDateString()}</span>
          </div>
          <button class="btn-icon-danger" title="Revoke">&#x2715;</button>
        </div>
      `).join('');

      container.querySelectorAll('.btn-icon-danger').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.api-key-row');
          const id = row.dataset.id;
          const name = row.querySelector('.api-key-name').textContent;
          if (!confirm(`Revoke API key "${name}"? Applications using it will lose access.`)) return;
          try {
            await API.deleteApiKey(id);
            await this.renderList(overlay);
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="api-keys-empty">Failed to load keys.</p>`;
    }
  },

  showReveal(overlay, rawKey) {
    const reveal = overlay.querySelector('#ak-reveal');
    reveal.hidden = false;
    reveal.innerHTML = `
      <div class="api-key-reveal">
        <p class="api-key-warning">Save this key now. It will not be shown again.</p>
        <div class="api-key-reveal-row">
          <input type="text" value="${rawKey}" readonly id="ak-raw-key">
          <button class="btn-secondary" id="ak-copy">Copy</button>
        </div>
      </div>
    `;
    const input = reveal.querySelector('#ak-raw-key');
    input.select();
    reveal.querySelector('#ak-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawKey);
        reveal.querySelector('#ak-copy').textContent = 'Copied!';
        setTimeout(() => { reveal.querySelector('#ak-copy').textContent = 'Copy'; }, 2000);
      } catch {
        input.select();
        document.execCommand('copy');
      }
    });
  },
};

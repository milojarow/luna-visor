const App = {
  clients: [],
  currentClientId: null,
  currentView: 'gallery',
  cdnBaseUrl: '',

  async init() {
    const statusRes = await fetch('/api/auth/status');
    if (!statusRes.ok) return;
    const status = await statusRes.json();
    this.cdnBaseUrl = (status.cdn_base_url || '').replace(/\/$/, '');

    ContextMenu.init();
    Sort.init();
    Upload.init();
    ApiKeysPage.init();

    // All files button
    document.getElementById('btn-all-files').addEventListener('click', () => {
      this.showGalleryView();
      this.currentClientId = null;
      this.setActiveClient(null);
      document.getElementById('current-view-title').textContent = 'All Files';
      this.loadFiles();
    });

    // Add client button + dropup
    document.getElementById('btn-add-client').addEventListener('click', () => {
      this.closeDropup();
      this.promptNewClient();
    });
    document.getElementById('btn-add-client-caret').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropup();
    });
    document.getElementById('btn-add-ephemeral-client').addEventListener('click', () => {
      this.closeDropup();
      this.promptNewClient({ ephemeral: true });
    });
    document.addEventListener('click', (e) => {
      const dropup = document.getElementById('dropup-add-client');
      if (!dropup.hidden && !dropup.contains(e.target)) this.closeDropup();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeDropup();
    });

    // API Keys
    document.getElementById('btn-api-keys').addEventListener('click', () => this.showApiKeysPage());

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await API.logout();
      window.location.href = '/login.html';
    });

    await this.loadClients();
    Gallery.init(this.cdnBaseUrl);
    Selection.init();
    await this.loadFiles();
  },

  async loadClients() {
    this.clients = await API.getClients();
    const list = document.getElementById('client-list');
    list.innerHTML = '';
    for (const client of this.clients) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      if (this.currentClientId === client.id) btn.classList.add('active');
      const icon = client.is_ephemeral
        ? `<img src="/calendar-clock.svg" alt="" class="client-ephemeral-icon" title="Cliente temporal (24h)">`
        : '';
      btn.innerHTML = `${icon}${escapeHtml(client.name)} <span class="file-count">${client.file_count}</span>`;
      btn.addEventListener('click', () => {
        this.showGalleryView();
        this.currentClientId = client.id;
        this.setActiveClient(client.id);
        const titleIcon = client.is_ephemeral
          ? `<img src="/calendar-clock.svg" alt="" class="gallery-title-icon" title="Cliente temporal (24h)">`
          : '';
        document.getElementById('current-view-title').innerHTML = `${titleIcon}${escapeHtml(client.name)}`;
        this.loadFiles();
      });

      // Right-click on client for rename/delete
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        ContextMenu.show(e.clientX, e.clientY, [
          { label: 'Rename', action: () => this.promptRenameClient(client) },
          { label: 'Delete', danger: true, action: () => this.promptDeleteClient(client) },
        ]);
      });

      list.appendChild(btn);
    }
  },

  setActiveClient(clientId) {
    document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
    if (clientId === null) {
      document.getElementById('btn-all-files').classList.add('active');
    } else {
      const items = document.querySelectorAll('#client-list .sidebar-item');
      const idx = this.clients.findIndex((c) => c.id === clientId);
      if (idx >= 0 && items[idx]) items[idx].classList.add('active');
    }
  },

  showApiKeysPage() {
    this.currentView = 'api-keys';
    document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
    document.getElementById('btn-api-keys').classList.add('active');
    ApiKeysPage.show();
  },

  showGalleryView() {
    if (this.currentView === 'gallery') return;
    this.currentView = 'gallery';
    document.getElementById('btn-api-keys').classList.remove('active');
    ApiKeysPage.hide();
  },

  async loadFiles() {
    const files = await API.getFiles(this.currentClientId);
    Gallery.render(files);
  },

  async promptNewClient(opts = {}) {
    const title = opts.ephemeral ? 'Nuevo cliente de contenido efímero' : 'New Client';
    const description = opts.ephemeral
      ? 'El cliente y sus API keys son permanentes como los demás. Lo que se autoborra es cada archivo que se suba aquí: 24 horas después del upload, luna lo elimina del CDN automáticamente.'
      : '';
    const name = await this.showPrompt(title, 'Client name:', '', { description });
    if (!name) return;
    try {
      await API.createClient(name, opts);
      await this.loadClients();
    } catch (err) {
      this.showAlert(err.message, { title: 'Could not create client' });
    }
  },

  async promptRenameClient(client) {
    const name = await this.showPrompt('Rename Client', 'New name:', client.name);
    if (!name || name === client.name) return;
    try {
      await API.renameClient(client.id, name);
      await this.loadClients();
      if (this.currentClientId === client.id) {
        const titleIcon = client.is_ephemeral
          ? `<img src="/calendar-clock.svg" alt="" class="gallery-title-icon" title="Cliente temporal (24h)">`
          : '';
        document.getElementById('current-view-title').innerHTML = `${titleIcon}${escapeHtml(name)}`;
      }
    } catch (err) {
      this.showAlert(err.message, { title: 'Could not rename client' });
    }
  },

  toggleDropup() {
    const dropup = document.getElementById('dropup-add-client');
    const caret = document.getElementById('btn-add-client-caret');
    const willOpen = dropup.hidden;
    dropup.hidden = !willOpen;
    caret.setAttribute('aria-expanded', String(willOpen));
  },

  closeDropup() {
    const dropup = document.getElementById('dropup-add-client');
    const caret = document.getElementById('btn-add-client-caret');
    if (dropup.hidden) return;
    dropup.hidden = true;
    caret.setAttribute('aria-expanded', 'false');
  },

  async promptDeleteClient(client) {
    const ok = await this.showConfirm(
      `Delete client "${client.name}"? This will fail if it has files.`,
      { title: 'Delete client', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    try {
      await API.deleteClient(client.id);
      if (this.currentClientId === client.id) {
        this.currentClientId = null;
        document.getElementById('current-view-title').textContent = 'All Files';
      }
      await this.loadClients();
      await this.loadFiles();
    } catch (err) {
      this.showAlert(err.message, { title: 'Could not delete client' });
    }
  },

  async confirmBulkDelete(files) {
    const ok = await this.showConfirm(
      `Delete ${files.length} files? This cannot be undone.`,
      { title: 'Delete files', okLabel: `Delete ${files.length}`, danger: true }
    );
    if (!ok) return;
    try {
      for (const f of files) await API.deleteFile(f.id);
      Selection.clear();
      await this.loadFiles();
      await this.loadClients();
    } catch (err) {
      this.showAlert(err.message, { title: 'Delete failed' });
    }
  },

  async showBulkMoveDialog(files) {
    const items = this.clients.map((c) => ({
      label: c.is_ephemeral ? `⏱ ${c.name}` : c.name,
      action: async () => {
        for (const f of files) await API.moveFile(f.id, c.id);
        Selection.clear();
        await this.loadFiles();
        await this.loadClients();
      },
    }));
    ContextMenu.show(200, 200, items);
  },

  async showBulkCopyDialog(files) {
    const items = this.clients.map((c) => ({
      label: c.is_ephemeral ? `⏱ ${c.name}` : c.name,
      action: async () => {
        for (const f of files) await API.copyFile(f.id, c.id);
        Selection.clear();
        await this.loadFiles();
        await this.loadClients();
      },
    }));
    ContextMenu.show(200, 200, items);
  },

  async confirmDelete(file) {
    const ok = await this.showConfirm(
      `Delete "${file.original_name}"? This cannot be undone.`,
      { title: 'Delete file', okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    try {
      await API.deleteFile(file.id);
      await this.loadFiles();
      await this.loadClients();
    } catch (err) {
      this.showAlert(err.message, { title: 'Delete failed' });
    }
  },

  async showMoveDialog(file) {
    const targets = this.clients.filter((c) => c.id !== file.client_id);
    if (targets.length === 0) {
      this.showAlert('No other clients to move to', { title: 'Move file' });
      return;
    }
    const items = targets.map((c) => ({
      label: c.is_ephemeral ? `⏱ ${c.name}` : c.name,
      action: async () => {
        await API.moveFile(file.id, c.id);
        await this.loadFiles();
        await this.loadClients();
      },
    }));
    // Re-show as context menu submenu
    const rect = document.querySelector(`[data-file-id="${file.id}"]`);
    const pos = rect ? rect.getBoundingClientRect() : { left: 200, top: 200 };
    ContextMenu.show(pos.left + 50, pos.top + 50, items);
  },

  async showCopyDialog(file) {
    const items = this.clients.map((c) => ({
      label: c.is_ephemeral ? `⏱ ${c.name}` : c.name,
      action: async () => {
        await API.copyFile(file.id, c.id);
        await this.loadFiles();
        await this.loadClients();
      },
    }));
    const rect = document.querySelector(`[data-file-id="${file.id}"]`);
    const pos = rect ? rect.getBoundingClientRect() : { left: 200, top: 200 };
    ContextMenu.show(pos.left + 50, pos.top + 50, items);
  },

  showPrompt(title, label, defaultValue = '', opts = {}) {
    const { description = '' } = opts;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const descHtml = description
        ? `<p class="modal-description">${escapeHtml(description)}</p>`
        : '';
      overlay.innerHTML = `
        <div class="modal">
          <h3>${escapeHtml(title)}</h3>
          ${descHtml}
          <input type="text" id="modal-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(label)}">
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-ok">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#modal-input');
      input.focus();
      input.select();

      const cleanup = (value) => {
        document.body.removeChild(overlay);
        resolve(value);
      };

      overlay.querySelector('#modal-cancel').addEventListener('click', () => cleanup(null));
      overlay.querySelector('#modal-ok').addEventListener('click', () => cleanup(input.value.trim()));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cleanup(input.value.trim());
        if (e.key === 'Escape') cleanup(null);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });
    });
  },

  showAlert(message, opts = {}) {
    const { title = '', okLabel = 'OK', variant = 'info' } = opts;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const titleHtml = title ? `<h3>${escapeHtml(title)}</h3>` : '';
      overlay.innerHTML = `
        <div class="modal modal-${variant}">
          ${titleHtml}
          <p class="modal-message">${escapeHtml(String(message))}</p>
          <div class="modal-actions">
            <button class="btn-primary" id="modal-ok">${escapeHtml(okLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const ok = overlay.querySelector('#modal-ok');
      ok.focus();

      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        document.body.removeChild(overlay);
        resolve();
      };
      const onKey = (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); cleanup(); }
      };
      document.addEventListener('keydown', onKey);
      ok.addEventListener('click', cleanup);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
    });
  },

  showConfirm(message, opts = {}) {
    const { title = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = opts;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const titleHtml = title ? `<h3>${escapeHtml(title)}</h3>` : '';
      const okClass = danger ? 'btn-danger' : 'btn-primary';
      overlay.innerHTML = `
        <div class="modal${danger ? ' modal-danger' : ''}">
          ${titleHtml}
          <p class="modal-message">${escapeHtml(String(message))}</p>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">${escapeHtml(cancelLabel)}</button>
            <button class="${okClass}" id="modal-ok">${escapeHtml(okLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const ok = overlay.querySelector('#modal-ok');
      ok.focus();

      const cleanup = (val) => {
        document.removeEventListener('keydown', onKey);
        document.body.removeChild(overlay);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      };
      document.addEventListener('keydown', onKey);
      overlay.querySelector('#modal-cancel').addEventListener('click', () => cleanup(false));
      ok.addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

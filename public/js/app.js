const App = {
  clients: [],
  currentClientId: null,
  cdnBaseUrl: '',

  async init() {
    // Get CDN base URL from server config
    const statusRes = await fetch('/api/auth/status');
    if (!statusRes.ok) return;

    this.cdnBaseUrl = document.body.dataset.cdnBase || '';
    // Fetch CDN base from a meta or deduce from files
    // We'll set it when we get the first file response
    this.cdnBaseUrl = ''; // Will be set from file responses

    ContextMenu.init();
    Upload.init();

    // Size toggle
    document.querySelectorAll('.size-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        Gallery.setSize(btn.dataset.size);
      });
    });

    // All files button
    document.getElementById('btn-all-files').addEventListener('click', () => {
      this.currentClientId = null;
      this.setActiveClient(null);
      document.getElementById('current-view-title').textContent = 'All Files';
      this.loadFiles();
    });

    // Add client button
    document.getElementById('btn-add-client').addEventListener('click', () => this.promptNewClient());

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await API.logout();
      window.location.href = '/login.html';
    });

    await this.loadClients();
    await this.loadCdnBase();
    Gallery.init(this.cdnBaseUrl);
    await this.loadFiles();
  },

  async loadCdnBase() {
    // Fetch any file to get cdn_url base, or use a config endpoint
    // For simplicity, we'll hardcode from the server
    try {
      const files = await API.getFiles();
      if (files.length > 0 && files[0].cdn_url) {
        const url = new URL(files[0].cdn_url);
        this.cdnBaseUrl = `${url.protocol}//${url.host}`;
      } else {
        // Default fallback
        this.cdnBaseUrl = 'https://cdn.solutions45.com';
      }
    } catch {
      this.cdnBaseUrl = 'https://cdn.solutions45.com';
    }
  },

  async loadClients() {
    this.clients = await API.getClients();
    const list = document.getElementById('client-list');
    list.innerHTML = '';
    for (const client of this.clients) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      if (this.currentClientId === client.id) btn.classList.add('active');
      btn.innerHTML = `${client.name} <span class="file-count">${client.file_count}</span>`;
      btn.addEventListener('click', () => {
        this.currentClientId = client.id;
        this.setActiveClient(client.id);
        document.getElementById('current-view-title').textContent = client.name;
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

  async loadFiles() {
    const files = await API.getFiles(this.currentClientId);
    Gallery.render(files);
  },

  async promptNewClient() {
    const name = await this.showPrompt('New Client', 'Client name:');
    if (!name) return;
    try {
      await API.createClient(name);
      await this.loadClients();
    } catch (err) {
      alert(err.message);
    }
  },

  async promptRenameClient(client) {
    const name = await this.showPrompt('Rename Client', 'New name:', client.name);
    if (!name || name === client.name) return;
    try {
      await API.renameClient(client.id, name);
      await this.loadClients();
      if (this.currentClientId === client.id) {
        document.getElementById('current-view-title').textContent = name;
      }
    } catch (err) {
      alert(err.message);
    }
  },

  async promptDeleteClient(client) {
    if (!confirm(`Delete client "${client.name}"? This will fail if it has files.`)) return;
    try {
      await API.deleteClient(client.id);
      if (this.currentClientId === client.id) {
        this.currentClientId = null;
        document.getElementById('current-view-title').textContent = 'All Files';
      }
      await this.loadClients();
      await this.loadFiles();
    } catch (err) {
      alert(err.message);
    }
  },

  async confirmDelete(file) {
    if (!confirm(`Delete "${file.original_name}"? This cannot be undone.`)) return;
    try {
      await API.deleteFile(file.id);
      await this.loadFiles();
      await this.loadClients();
    } catch (err) {
      alert(err.message);
    }
  },

  async showMoveDialog(file) {
    const targets = this.clients.filter((c) => c.id !== file.client_id);
    if (targets.length === 0) {
      alert('No other clients to move to');
      return;
    }
    const items = targets.map((c) => ({
      label: c.name,
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
      label: c.name,
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

  showPrompt(title, label, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <h3>${title}</h3>
          <input type="text" id="modal-input" value="${defaultValue}" placeholder="${label}">
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
};

document.addEventListener('DOMContentLoaded', () => App.init());

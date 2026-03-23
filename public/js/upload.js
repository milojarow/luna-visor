const Upload = {
  zoneEl: null,
  overlayEl: null,
  fileInput: null,
  progressEl: null,

  init() {
    this.zoneEl = document.getElementById('upload-zone');
    this.overlayEl = this.zoneEl.querySelector('.upload-overlay');
    this.fileInput = document.getElementById('file-input');
    this.progressEl = document.getElementById('upload-progress');

    document.getElementById('btn-upload').addEventListener('click', () => this.show());
    document.getElementById('btn-close-upload').addEventListener('click', () => this.hide());

    this.fileInput.addEventListener('change', () => this.handleFiles(this.fileInput.files));

    this.overlayEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.overlayEl.classList.add('dragover');
    });
    this.overlayEl.addEventListener('dragleave', () => {
      this.overlayEl.classList.remove('dragover');
    });
    this.overlayEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.overlayEl.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });

    this.zoneEl.addEventListener('click', (e) => {
      if (e.target === this.zoneEl) this.hide();
    });

    // Ctrl+V paste from clipboard
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length === 0) return;

      if (!App.currentClientId) {
        alert('Select a client first');
        return;
      }

      this.show();
      this.handleFiles(files);
    });
  },

  show() {
    if (!App.currentClientId) {
      alert('Select a client first');
      return;
    }
    this.progressEl.innerHTML = '';
    this.fileInput.value = '';
    this.zoneEl.hidden = false;
  },

  hide() {
    this.zoneEl.hidden = true;
  },

  async handleFiles(fileList) {
    if (!fileList.length) return;
    if (!App.currentClientId) {
      alert('Select a client first');
      return;
    }

    this.progressEl.innerHTML = '<div class="upload-item">Uploading...</div>';

    try {
      const results = await API.uploadFiles(fileList, App.currentClientId, (pct) => {
        this.progressEl.innerHTML = `<div class="upload-item">${Math.round(pct * 100)}% uploaded</div>`;
      });

      this.progressEl.innerHTML = '';
      for (const r of results) {
        const item = document.createElement('div');
        item.className = 'upload-item';
        if (r.error) {
          item.innerHTML = `<span class="status error">\u2717</span> ${r.original_name}: ${r.error}`;
        } else {
          item.innerHTML = `<span class="status">\u2713</span> ${r.original_name}`;
        }
        this.progressEl.appendChild(item);
      }

      App.loadFiles();
      App.loadClients();
    } catch (err) {
      this.progressEl.innerHTML = `<div class="upload-item"><span class="status error">\u2717</span> ${err.message}</div>`;
    }
  },
};

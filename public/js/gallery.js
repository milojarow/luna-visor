const Gallery = {
  el: null,
  files: [],
  currentSize: 'normal',
  cdnBase: '',

  init(cdnBase) {
    this.el = document.getElementById('gallery');
    this.cdnBase = cdnBase;
    this.el.classList.add('size-normal');
  },

  setSize(size) {
    this.currentSize = size;
    this.el.classList.remove('size-normal', 'size-big', 'size-bigger');
    this.el.classList.add(`size-${size}`);
    this.el.querySelectorAll('.file-card-preview[data-type="image"]').forEach((img) => {
      const fileId = img.dataset.fileId;
      const ext = img.dataset.ext;
      img.src = `${this.cdnBase}/${fileId}-${size}.${ext}`;
    });
  },

  render(files) {
    this.files = files;
    this.el.innerHTML = '';

    if (files.length === 0) {
      this.el.innerHTML = '<p class="empty-state">No files yet. Upload some!</p>';
      return;
    }

    if (Sort.groupByDate) {
      this.renderGrouped(Sort.applyGrouped(files));
    } else {
      const sorted = Sort.apply(files);
      for (const file of sorted) {
        this.el.appendChild(this.createCard(file));
      }
    }

  },

  renderGrouped(groups) {
    for (const group of groups) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      const d = new Date(group.date + 'T00:00:00');
      divider.textContent = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      this.el.appendChild(divider);

      for (const file of group.files) {
        this.el.appendChild(this.createCard(file));
      }
    }
  },

  createCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.fileId = file.id;

    const previewContainer = document.createElement('div');
    previewContainer.className = 'file-card-preview-container';

    if (file.type === 'image' && file.has_resized) {
      const img = document.createElement('img');
      img.className = 'file-card-preview';
      img.dataset.type = 'image';
      img.dataset.fileId = file.id;
      img.dataset.ext = file.extension;
      img.src = `${this.cdnBase}/${file.id}-${this.currentSize}.${file.extension}`;
      img.alt = file.original_name;
      img.loading = 'lazy';
      previewContainer.appendChild(img);
    } else if (file.type === 'video' && file.has_thumbnail) {
      const img = document.createElement('img');
      img.className = 'file-card-preview';
      img.src = `${this.cdnBase}/${file.id}-thumb.jpg`;
      img.alt = file.original_name;
      img.loading = 'lazy';
      previewContainer.appendChild(img);

      const badge = document.createElement('span');
      badge.className = 'video-badge';
      badge.textContent = '\u25B6';
      previewContainer.appendChild(badge);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'file-card-preview';
      placeholder.style.display = 'flex';
      placeholder.style.alignItems = 'center';
      placeholder.style.justifyContent = 'center';
      placeholder.style.color = 'var(--text-muted)';
      placeholder.textContent = file.extension.toUpperCase();
      previewContainer.appendChild(placeholder);
    }

    card.appendChild(previewContainer);

    const info = document.createElement('div');
    info.className = 'file-card-info';
    if (file.referenced) info.classList.add('file-card-info-referenced');
    info.innerHTML = `
      <div class="file-card-name" title="${file.original_name}">${file.original_name}</div>
      <div class="file-card-meta">${formatSize(file.size_bytes)} &middot; ${formatDate(file.created_at)}</div>
    `;
    card.appendChild(info);

    // Double-click: open original in new tab
    card.addEventListener('dblclick', () => {
      window.open(file.cdn_url, '_blank');
    });

    // Right-click: context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, file);
    });

    return card;
  },

  showContextMenu(x, y, file) {
    // Multi-selection context menu
    if (Selection.selected.size > 1 && Selection.selected.has(file.id)) {
      const selectedFiles = Selection.getSelectedFiles();
      const count = selectedFiles.length;
      const items = [
        {
          label: `Copy ${count} URLs`,
          action: async () => {
            const urls = selectedFiles.map((f) => f.cdn_url).join('\n');
            await copyToClipboard(urls);
          },
        },
        { separator: true },
        {
          label: `Move ${count} files to...`,
          action: () => App.showBulkMoveDialog(selectedFiles),
        },
        {
          label: `Copy ${count} files to...`,
          action: () => App.showBulkCopyDialog(selectedFiles),
        },
        { separator: true },
        {
          label: `Delete ${count} files`,
          danger: true,
          action: () => App.confirmBulkDelete(selectedFiles),
        },
      ];
      ContextMenu.show(x, y, items);
      return;
    }

    // If right-clicking a non-selected card, select it
    if (!Selection.selected.has(file.id)) {
      Selection.clear();
      Selection.select(file.id);
      Selection.anchor = file.id;
    }

    const items = [
      {
        label: 'Copy CDN URL',
        action: async () => {
          await copyToClipboard(file.cdn_url);
        },
      },
      {
        label: 'Open original',
        action: () => window.open(file.cdn_url, '_blank'),
      },
      { separator: true },
      {
        label: 'Move to...',
        action: () => App.showMoveDialog(file),
      },
      {
        label: 'Copy to...',
        action: () => App.showCopyDialog(file),
      },
      { separator: true },
      {
        label: 'Delete',
        danger: true,
        action: () => App.confirmDelete(file),
      },
    ];
    ContextMenu.show(x, y, items);
  },
};

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const Selection = {
  selected: new Set(),
  anchor: null,
  dragActive: false,
  dragStart: null,
  boxEl: null,

  init() {
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'selection-box';
    this.boxEl.hidden = true;
    Gallery.el.appendChild(this.boxEl);

    // Click on cards (delegated)
    Gallery.el.addEventListener('click', (e) => {
      if (e.detail !== 1) return; // ignore dblclick
      const card = e.target.closest('.file-card');
      if (!card) {
        // Clicked empty area
        this.clear();
        return;
      }

      const fileId = card.dataset.fileId;

      if (e.shiftKey && this.anchor) {
        e.preventDefault();
        this.selectRange(this.anchor, fileId);
      } else if (e.ctrlKey || e.metaKey) {
        this.toggle(fileId);
        if (this.selected.has(fileId)) this.anchor = fileId;
      } else {
        this.clear();
        this.select(fileId);
        this.anchor = fileId;
      }
    });

    // Drag selection
    Gallery.el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.file-card')) return;
      if (e.target.closest('.date-divider')) return;

      this.dragActive = true;
      const rect = Gallery.el.getBoundingClientRect();
      this.dragStart = {
        x: e.clientX - rect.left + Gallery.el.scrollLeft,
        y: e.clientY - rect.top + Gallery.el.scrollTop,
      };

      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        this.clear();
      }

      this.boxEl.hidden = false;
      this.boxEl.style.left = this.dragStart.x + 'px';
      this.boxEl.style.top = this.dragStart.y + 'px';
      this.boxEl.style.width = '0';
      this.boxEl.style.height = '0';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.dragActive) return;

      const rect = Gallery.el.getBoundingClientRect();
      const curX = e.clientX - rect.left + Gallery.el.scrollLeft;
      const curY = e.clientY - rect.top + Gallery.el.scrollTop;

      const x = Math.min(this.dragStart.x, curX);
      const y = Math.min(this.dragStart.y, curY);
      const w = Math.abs(curX - this.dragStart.x);
      const h = Math.abs(curY - this.dragStart.y);

      this.boxEl.style.left = x + 'px';
      this.boxEl.style.top = y + 'px';
      this.boxEl.style.width = w + 'px';
      this.boxEl.style.height = h + 'px';

      // Check intersection with cards
      const boxRect = {
        left: x, top: y,
        right: x + w, bottom: y + h,
      };

      Gallery.el.querySelectorAll('.file-card').forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const galRect = Gallery.el.getBoundingClientRect();
        const cardRelative = {
          left: cardRect.left - galRect.left + Gallery.el.scrollLeft,
          top: cardRect.top - galRect.top + Gallery.el.scrollTop,
          right: cardRect.right - galRect.left + Gallery.el.scrollLeft,
          bottom: cardRect.bottom - galRect.top + Gallery.el.scrollTop,
        };

        const intersects = !(
          cardRelative.right < boxRect.left ||
          cardRelative.left > boxRect.right ||
          cardRelative.bottom < boxRect.top ||
          cardRelative.top > boxRect.bottom
        );

        const fileId = card.dataset.fileId;
        if (intersects) {
          this.select(fileId);
        } else if (!e.ctrlKey && !e.metaKey) {
          this.deselect(fileId);
        }
      });
    });

    document.addEventListener('mouseup', () => {
      if (!this.dragActive) return;
      this.dragActive = false;
      this.boxEl.hidden = true;
    });

    // Escape clears selection
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.clear();
    });
  },

  clear() {
    this.selected.clear();
    this.anchor = null;
    Gallery.el.querySelectorAll('.file-card.selected').forEach((el) => {
      el.classList.remove('selected');
    });
  },

  select(fileId) {
    this.selected.add(fileId);
    const card = Gallery.el.querySelector(`[data-file-id="${fileId}"]`);
    if (card) card.classList.add('selected');
  },

  deselect(fileId) {
    this.selected.delete(fileId);
    const card = Gallery.el.querySelector(`[data-file-id="${fileId}"]`);
    if (card) card.classList.remove('selected');
  },

  toggle(fileId) {
    if (this.selected.has(fileId)) {
      this.deselect(fileId);
    } else {
      this.select(fileId);
    }
  },

  selectRange(fromId, toId) {
    const sortedFiles = Sort.apply(Gallery.files);
    const fromIdx = sortedFiles.findIndex((f) => f.id === fromId);
    const toIdx = sortedFiles.findIndex((f) => f.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);

    for (let i = start; i <= end; i++) {
      this.select(sortedFiles[i].id);
    }
  },

  getSelectedFiles() {
    return Gallery.files.filter((f) => this.selected.has(f.id));
  },
};

const Selection = {
  selected: new Set(),
  anchor: null,
  dragActive: false,
  dragJustEnded: false,
  dragStart: null,
  boxEl: null,

  init() {
    // Selection box lives on body, not inside the grid
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'selection-box';
    this.boxEl.hidden = true;
    document.body.appendChild(this.boxEl);

    // Click on cards (delegated)
    Gallery.el.addEventListener('click', (e) => {
      if (this.dragJustEnded) {
        this.dragJustEnded = false;
        return;
      }
      if (e.detail !== 1) return;
      const card = e.target.closest('.file-card');
      if (!card) {
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

    // Drag selection — all in screen (client) coordinates
    Gallery.el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.file-card')) return;
      if (e.target.closest('.date-divider')) return;

      this.dragActive = true;
      this.dragStart = { x: e.clientX, y: e.clientY };

      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        this.clear();
      }

      this.boxEl.hidden = false;
      this.boxEl.style.left = e.clientX + 'px';
      this.boxEl.style.top = e.clientY + 'px';
      this.boxEl.style.width = '0';
      this.boxEl.style.height = '0';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.dragActive) return;

      const x = Math.min(this.dragStart.x, e.clientX);
      const y = Math.min(this.dragStart.y, e.clientY);
      const w = Math.abs(e.clientX - this.dragStart.x);
      const h = Math.abs(e.clientY - this.dragStart.y);

      this.boxEl.style.left = x + 'px';
      this.boxEl.style.top = y + 'px';
      this.boxEl.style.width = w + 'px';
      this.boxEl.style.height = h + 'px';

      // Intersection check — both in screen coordinates
      Gallery.el.querySelectorAll('.file-card').forEach((card) => {
        const cr = card.getBoundingClientRect();

        const intersects = !(
          cr.right < x ||
          cr.left > x + w ||
          cr.bottom < y ||
          cr.top > y + h
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
      this.dragJustEnded = true;
      this.boxEl.hidden = true;
    });

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

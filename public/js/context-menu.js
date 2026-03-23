const ContextMenu = {
  el: null,
  itemsEl: null,

  init() {
    this.el = document.getElementById('context-menu');
    this.itemsEl = document.getElementById('context-menu-items');
    document.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
  },

  show(x, y, items) {
    this.itemsEl.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      if (item.separator) {
        li.className = 'separator';
      } else {
        li.textContent = item.label;
        if (item.danger) li.className = 'danger';
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hide();
          item.action();
        });
      }
      this.itemsEl.appendChild(li);
    }

    this.el.hidden = false;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;

    // Keep in viewport
    const rect = this.el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  },

  hide() {
    if (this.el) this.el.hidden = true;
  },
};

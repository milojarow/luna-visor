const Sort = {
  field: 'created_at',
  direction: 'desc',
  groupByDate: false,

  init() {
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setField(btn.dataset.sort);
      });
    });

    document.getElementById('btn-group-date').addEventListener('click', () => {
      this.groupByDate = !this.groupByDate;
      document.getElementById('btn-group-date').classList.toggle('active', this.groupByDate);
      Gallery.render(Gallery.files);
    });
  },

  setField(field) {
    if (this.field === field) {
      this.direction = this.direction === 'desc' ? 'asc' : 'desc';
    } else {
      this.field = field;
      this.direction = 'desc';
    }
    this.updateButtons();
    Gallery.render(Gallery.files);
  },

  updateButtons() {
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const isActive = btn.dataset.sort === this.field;
      btn.classList.toggle('active', isActive);
      const arrow = btn.querySelector('.sort-arrow');
      if (arrow) {
        arrow.textContent = isActive ? (this.direction === 'desc' ? '\u25BC' : '\u25B2') : '';
      }
    });
  },

  apply(files) {
    const sorted = [...files];
    const dir = this.direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let cmp = 0;
      switch (this.field) {
        case 'created_at':
          cmp = a.created_at.localeCompare(b.created_at);
          break;
        case 'original_name':
          cmp = a.original_name.localeCompare(b.original_name, undefined, { sensitivity: 'base' });
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type) || a.original_name.localeCompare(b.original_name, undefined, { sensitivity: 'base' });
          break;
      }
      return cmp * dir;
    });

    return sorted;
  },

  applyGrouped(files) {
    const sorted = this.apply(files);
    const groups = [];
    let currentDate = null;
    let currentGroup = null;

    for (const file of sorted) {
      const date = file.created_at.split(' ')[0]; // 'YYYY-MM-DD'
      if (date !== currentDate) {
        currentDate = date;
        currentGroup = { date, files: [] };
        groups.push(currentGroup);
      }
      currentGroup.files.push(file);
    }

    return groups;
  },
};

// Centered viewer for a single file: the card, opened.
//
// Double-clicking a card used to be window.open(cdn_url) — a top-level navigation
// to the CDN. The browser answers that with its own synthetic media-viewer document,
// which inherits the CDN response's CSP; that's what made every video unplayable
// (see the CSP note in CLAUDE.md). Here the media is a subresource of luna's own
// page instead, so it plays regardless of what the CDN sends.
const Lightbox = {
  el: null,
  stage: null,
  nameEl: null,
  extEl: null,
  metaEl: null,
  closeBtn: null,
  file: null,
  lastFocus: null,

  // Types we can render inline. Anything else keeps the old open-in-a-tab behavior.
  INLINE_TYPES: ['image', 'vector', 'video', 'audio'],

  init() {
    this.el = document.getElementById('lightbox');
    this.stage = document.getElementById('lightbox-stage');
    this.nameEl = document.getElementById('lightbox-name');
    this.extEl = document.getElementById('lightbox-ext');
    this.metaEl = document.getElementById('lightbox-meta');
    this.closeBtn = document.getElementById('lightbox-close');

    this.closeBtn.addEventListener('click', () => this.close());

    // Click the backdrop to dismiss; clicks inside the panel are the media's own.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    // Capture phase, so Escape here doesn't also reach the document-level handlers
    // that clear the selection and close the dropup.
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen() || e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
    }, true);

    // Same reason: Ctrl+V while viewing shouldn't open the upload flow behind the overlay.
    document.addEventListener('paste', (e) => {
      if (this.isOpen()) e.stopPropagation();
    }, true);
  },

  isOpen() {
    return this.el && !this.el.hidden;
  },

  canRender(file) {
    return this.INLINE_TYPES.includes(file.type);
  },

  open(file) {
    if (!this.canRender(file)) {
      window.open(file.cdn_url, '_blank');
      return;
    }

    this.file = file;
    this.lastFocus = document.activeElement;

    this.nameEl.textContent = file.original_name;
    this.nameEl.title = file.original_name;
    this.extEl.textContent = file.extension;
    this.metaEl.textContent = `${formatSize(file.size_bytes)} · ${formatDate(file.created_at)}`;

    this.stage.innerHTML = '';
    this.stage.appendChild(this.buildMedia(file));

    this.el.hidden = false;
    document.body.classList.add('lightbox-open');
    // Focus the dialog, not the close button: a mouse-opened viewer shouldn't paint a
    // focus ring on ×, and keyboard users still land on it as the first tab stop.
    this.el.focus();
  },

  buildMedia(file) {
    if (file.type === 'video') {
      const video = document.createElement('video');
      video.className = 'lightbox-media';
      video.src = file.cdn_url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.addEventListener('loadedmetadata', () => {
        this.addMeasured(`${video.videoWidth} × ${video.videoHeight}`, video.duration);
      });
      video.addEventListener('error', () => this.showLoadError());
      return video;
    }

    if (file.type === 'audio') {
      const audio = document.createElement('audio');
      audio.className = 'lightbox-media lightbox-media-audio';
      audio.src = file.cdn_url;
      audio.controls = true;
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => this.addMeasured(null, audio.duration));
      audio.addEventListener('error', () => this.showLoadError());
      return audio;
    }

    // image + vector: the original rendition, not the gallery's -thumb variant
    const img = document.createElement('img');
    img.className = 'lightbox-media';
    img.src = file.cdn_url;
    img.alt = file.original_name;
    img.addEventListener('load', () => {
      this.addMeasured(`${img.naturalWidth} × ${img.naturalHeight}`, null);
    });
    img.addEventListener('error', () => this.showLoadError());
    return img;
  },

  // Dimensions and duration come from the loaded media, not from the DB — this view
  // is the one place that can report what the file actually is.
  addMeasured(dimensions, duration) {
    const parts = [];
    if (dimensions) parts.push(dimensions);
    if (Number.isFinite(duration) && duration > 0) parts.push(`${duration.toFixed(1)} s`);
    if (parts.length === 0) return;
    this.metaEl.textContent += ` · ${parts.join(' · ')}`;
  },

  showLoadError() {
    this.stage.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'lightbox-error';
    box.innerHTML = `
      <p>This file didn't load.</p>
      <a href="${this.file.cdn_url}" target="_blank" rel="noopener">Open the CDN URL in a new tab</a>
    `;
    this.stage.appendChild(box);
  },

  close() {
    if (!this.isOpen()) return;

    // Detaching isn't enough to stop a video: clear the source so it stops buffering.
    const media = this.stage.querySelector('video, audio');
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    this.stage.innerHTML = '';

    this.el.hidden = true;
    document.body.classList.remove('lightbox-open');
    this.file = null;

    if (this.lastFocus && document.body.contains(this.lastFocus)) this.lastFocus.focus();
    this.lastFocus = null;
  },
};

(() => {
  const railsRoot = document.getElementById('scrinium-rails');
  if (!railsRoot) return;

  const hoverCapable = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DATA_URL = 'scrinium-data.json';
  const PREVIEW_DELAY_MS = 320;

  const track = (eventName, payload = {}) => {
    if (window.SCRINIUM_TRACK_DISABLED) return;
    // eslint-disable-next-line no-console
    console.info(`[scrinium] ${eventName}`, payload);
  };

  const progressStore = {
    key(contentId, episodeId) {
      if (episodeId) {
        return `imperium:scrinium:progress:${contentId}:${episodeId}`;
      }
      return `imperium:scrinium:progress:${contentId}`;
    },
    lastEpisodeKey(contentId) {
      return `imperium:scrinium:lastEpisode:${contentId}`;
    },
    load(contentId, episodeId) {
      const raw = localStorage.getItem(this.key(contentId, episodeId));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (err) {
        return null;
      }
    },
    save(contentId, episodeId, payload) {
      localStorage.setItem(this.key(contentId, episodeId), JSON.stringify(payload));
      if (episodeId) {
        localStorage.setItem(this.lastEpisodeKey(contentId), String(episodeId));
      }
    },
    loadLatest(contentId) {
      const lastEpisode = localStorage.getItem(this.lastEpisodeKey(contentId));
      if (lastEpisode) {
        return this.load(contentId, lastEpisode);
      }
      return this.load(contentId);
    }
  };

  const videoJsLoader = (() => {
    let promise = null;
    return () => {
      if (window.videojs) return Promise.resolve(window.videojs);
      if (promise) return promise;
      promise = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'assets/vendor/video-js.css';
        document.head.appendChild(css);

        const script = document.createElement('script');
        script.src = 'assets/vendor/video.min.js';
        script.async = true;
        script.onload = () => resolve(window.videojs);
        script.onerror = () => reject(new Error('Video.js failed to load'));
        document.head.appendChild(script);
      }).then((videojs) => {
        const plugin = document.createElement('script');
        plugin.src = 'assets/vendor/videojs-vtt-thumbnails.min.js';
        plugin.async = true;
        document.head.appendChild(plugin);
        return videojs;
      });
      return promise;
    };
  })();

  const resolveSources = (sourceObj) => {
    if (!sourceObj) return [];
    const sources = [];
    if (sourceObj.hls) {
      sources.push({ src: sourceObj.hls, type: 'application/x-mpegURL' });
    }
    if (sourceObj.dash) {
      sources.push({ src: sourceObj.dash, type: 'application/dash+xml' });
    }
    if (sourceObj.mp4Fallback) {
      sources.push({ src: sourceObj.mp4Fallback, type: 'video/mp4' });
    }
    return sources;
  };

  const resolvePreviewSource = (item) => {
    if (item.sources && item.sources.mp4Fallback) {
      return [{ src: item.sources.mp4Fallback, type: 'video/mp4' }];
    }
    if (item.sources) {
      return resolveSources(item.sources);
    }
    return [];
  };

  const createQualityMenu = (videojs, player) => {
    if (!player.qualityLevels) return;
    const qualityLevels = player.qualityLevels();
    if (!qualityLevels || qualityLevels.length === 0) return;

    const MenuButton = videojs.getComponent('MenuButton');
    const MenuItem = videojs.getComponent('MenuItem');

    class QualityMenuItem extends MenuItem {
      constructor(menuPlayer, options) {
        super(menuPlayer, options);
        this.level = options.level;
      }

      handleClick() {
        const level = this.level;
        for (let i = 0; i < qualityLevels.length; i += 1) {
          qualityLevels[i].enabled = qualityLevels[i] === level;
        }
        super.handleClick();
      }
    }

    class QualityMenuButton extends MenuButton {
      constructor(menuPlayer, options) {
        super(menuPlayer, options);
        this.controlText('Qualidade');
      }

      createItems() {
        const items = [];
        for (let i = 0; i < qualityLevels.length; i += 1) {
          const level = qualityLevels[i];
          if (!level.height) continue;
          items.push(new QualityMenuItem(player, {
            label: `${level.height}p`,
            selectable: true,
            level
          }));
        }
        return items;
      }
    }

    videojs.registerComponent('QualityMenuButton', QualityMenuButton);
    player.ready(() => {
      if (!player.getChild('controlBar').getChild('QualityMenuButton')) {
        player.getChild('controlBar').addChild('QualityMenuButton', {});
      }
    });
  };

  const createPreviewManager = () => {
    let activeCard = null;
    let player = null;
    let timer = null;

    const dispose = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (player) {
        player.dispose();
        player = null;
      }
      if (activeCard) {
        activeCard.classList.remove('is-previewing');
        const host = activeCard.querySelector('[data-preview]');
        if (host) host.innerHTML = '';
      }
      activeCard = null;
    };

    const mount = (cardEl, item) => {
      videoJsLoader().then((videojs) => {
        if (activeCard !== cardEl) return;
        const host = cardEl.querySelector('[data-preview]');
        if (!host) return;
        host.innerHTML = '';
        const videoEl = document.createElement('video');
        videoEl.className = 'video-js vjs-scrinium vjs-preview';
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('muted', '');
        videoEl.setAttribute('preload', 'auto');
        host.appendChild(videoEl);

        player = videojs(videoEl, {
          autoplay: !prefersReduced,
          muted: true,
          controls: false,
          loop: false,
          preload: 'auto',
          poster: item.cardImage || item.poster || ''
        });

        const preview = item.preview || { startSec: 0, endSec: 10 };
        const startSec = preview.startSec ?? 0;
        const endSec = preview.endSec ?? (startSec + 10);

        player.src(resolvePreviewSource(item));
        player.ready(() => {
          player.currentTime(startSec);
          player.play().catch(() => {});
        });

        player.on('timeupdate', () => {
          if (player.currentTime() >= endSec) {
            player.currentTime(startSec);
          }
        });

        player.on('error', () => {
          dispose();
        });

        track('preview_start', { id: item.id });
      });
    };

    return {
      queue(cardEl, item) {
        if (!hoverCapable || prefersReduced) return;
        if (activeCard === cardEl) return;
        dispose();
        activeCard = cardEl;
        activeCard.classList.add('is-previewing');
        timer = setTimeout(() => {
          mount(cardEl, item);
        }, PREVIEW_DELAY_MS);
      },
      stop(cardEl) {
        if (activeCard && activeCard !== cardEl) return;
        track('preview_stop', { id: cardEl?.dataset?.itemId });
        dispose();
      },
      stopAll() {
        dispose();
      }
    };
  };

  const previewManager = createPreviewManager();

  const hero = document.querySelector('.header');
  if (hero) {
    let raf = null;
    let lastX = 50;
    let lastY = 30;

    const applyHeroLight = () => {
      hero.style.setProperty('--hero-x', `${lastX}%`);
      hero.style.setProperty('--hero-y', `${lastY}%`);
      raf = null;
    };

    hero.addEventListener('mousemove', (event) => {
      const rect = hero.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      lastX = Math.max(0, Math.min(100, x));
      lastY = Math.max(0, Math.min(100, y));
      if (!raf) raf = requestAnimationFrame(applyHeroLight);
    });

    hero.addEventListener('mouseleave', () => {
      lastX = 50;
      lastY = 30;
      if (!raf) raf = requestAnimationFrame(applyHeroLight);
    });
  }

  const modal = document.getElementById('scrinium-modal');
  const modalTitle = document.getElementById('scrinium-modal-title');
  const modalSubtitle = document.getElementById('scrinium-modal-subtitle');
  const modalSynopsis = document.getElementById('scrinium-modal-synopsis');
  const modalMeta = document.getElementById('scrinium-modal-meta');
  const modalTags = document.getElementById('scrinium-modal-tags');
  const modalEpisodes = document.getElementById('scrinium-episodes');
  const modalPlay = document.getElementById('scrinium-modal-play');
  const modalShell = document.getElementById('scrinium-player-shell');
  const modalClose = document.getElementById('scrinium-modal-close');
  const modalBackdrop = document.getElementById('scrinium-modal-backdrop');

  let activeItem = null;
  let activeEpisode = null;
  let modalPlayer = null;
  let lastFocused = null;

  const closeModal = () => {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
    document.body.classList.remove('is-modal-open');
    if (modalPlayer) {
      modalPlayer.dispose();
      modalPlayer = null;
    }
    modalShell.innerHTML = '';
    activeItem = null;
    activeEpisode = null;
    if (lastFocused) lastFocused.focus();
  };

  const trapFocus = (event) => {
    if (!modal || modal.getAttribute('aria-hidden') === 'true') return;
    if (event.key !== 'Tab') return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const bindModalKeys = (player) => {
    modal.addEventListener('keydown', (event) => {
      if (!player) return;
      const key = event.key.toLowerCase();
      if (key === ' ') {
        event.preventDefault();
        if (player.paused()) player.play();
        else player.pause();
      }
      if (key === 'm') {
        player.muted(!player.muted());
      }
      if (key === 'f') {
        player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
      }
      if (key === 'arrowright') {
        player.currentTime(player.currentTime() + 10);
      }
      if (key === 'arrowleft') {
        player.currentTime(player.currentTime() - 10);
      }
      if (key === 'escape') {
        closeModal();
      }
    }, { once: true });
  };

  const renderTags = (tags = []) => {
    modalTags.innerHTML = '';
    tags.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'scrinium-tag';
      span.textContent = tag;
      modalTags.appendChild(span);
    });
  };

  const formatDuration = (durationSec) => {
    if (!durationSec) return '';
    const minutes = Math.round(durationSec / 60);
    return `${minutes} min`;
  };

  const updateMeta = (item, episode) => {
    const bits = [];
    if (item.year) bits.push(String(item.year));
    if (item.maturityRating) bits.push(`${item.maturityRating}+`);
    if (episode && episode.durationSec) bits.push(formatDuration(episode.durationSec));
    if (!episode && item.durationSec) bits.push(formatDuration(item.durationSec));
    modalMeta.textContent = bits.join(' • ');
  };

  const saveProgress = (item, episode, player) => {
    const duration = player.duration();
    if (!duration || Number.isNaN(duration)) return;
    const current = player.currentTime();
    const completed = current / duration >= 0.95;
    progressStore.save(item.id, episode?.episodeNumber, {
      lastTimeSec: current,
      durationSec: duration,
      completed,
      updatedAt: Date.now()
    });
    track('progress_save', { id: item.id, episode: episode?.episodeNumber, current });
  };

  const throttle = (fn, wait) => {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn(...args);
      }
    };
  };

  const loadPlayer = (item, episode) => {
    const source = episode?.sources || item.sources;
    const captions = episode?.captions || item.captions || [];
    const chaptersVtt = episode?.chaptersVtt || item.chaptersVtt;
    const thumbsVtt = episode?.thumbnailsVtt || item.thumbnailsVtt;

    modalShell.innerHTML = '';
    const videoEl = document.createElement('video');
    videoEl.className = 'video-js vjs-scrinium';
    videoEl.setAttribute('controls', '');
    videoEl.setAttribute('preload', 'metadata');
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('poster', item.poster || '');
    captions.forEach((track) => {
      const trackEl = document.createElement('track');
      trackEl.kind = 'captions';
      trackEl.label = track.label || 'Captions';
      trackEl.srclang = track.srclang || 'pt-BR';
      trackEl.src = track.src;
      if (track.default) trackEl.default = true;
      videoEl.appendChild(trackEl);
    });
    if (chaptersVtt) {
      const chapters = document.createElement('track');
      chapters.kind = 'chapters';
      chapters.label = 'Capitulos';
      chapters.srclang = 'pt-BR';
      chapters.src = chaptersVtt;
      videoEl.appendChild(chapters);
    }
    modalShell.appendChild(videoEl);

    return videoJsLoader().then((videojs) => {
      const player = videojs(videoEl, {
        controls: true,
        autoplay: false,
        preload: 'metadata',
        poster: item.poster || '',
        playbackRates: [0.75, 1, 1.25, 1.5]
      });
      player.src(resolveSources(source));
      createQualityMenu(videojs, player);

      if (typeof player.vttThumbnails === 'function' && thumbsVtt) {
        player.vttThumbnails({ src: thumbsVtt });
      }

      const progress = progressStore.load(item.id, episode?.episodeNumber);
      if (progress && progress.lastTimeSec) {
        player.currentTime(progress.lastTimeSec);
      }

      const throttledSave = throttle(() => saveProgress(item, episode, player), 1000);
      player.on('timeupdate', throttledSave);
      player.on('pause', () => saveProgress(item, episode, player));
      player.on('ended', () => saveProgress(item, episode, player));

      player.on('play', () => {
        track('playback_start', { id: item.id, episode: episode?.episodeNumber });
      });
      player.on('pause', () => {
        track('playback_pause', { id: item.id, episode: episode?.episodeNumber });
      });
      player.on('ended', () => {
        track('playback_end', { id: item.id, episode: episode?.episodeNumber });
      });

      player.on('error', () => {
        const fallback = source?.mp4Fallback;
        if (fallback) {
          player.src([{ src: fallback, type: 'video/mp4' }]);
          player.play().catch(() => {});
        }
      });

      return player;
    });
  };

  const renderEpisodes = (item) => {
    modalEpisodes.innerHTML = '';
    if (!item.seasons || !item.seasons.length) {
      modalEpisodes.classList.add('is-empty');
      return;
    }
    modalEpisodes.classList.remove('is-empty');
    item.seasons.forEach((season) => {
      const seasonBlock = document.createElement('div');
      seasonBlock.className = 'scrinium-episode-group';
      const seasonTitle = document.createElement('div');
      seasonTitle.className = 'scrinium-episode-group__title';
      seasonTitle.textContent = `Temporada ${season.seasonNumber}`;
      seasonBlock.appendChild(seasonTitle);

      season.episodes.forEach((episode) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'scrinium-episode-card';
        button.textContent = `Ep ${episode.episodeNumber} - ${episode.title}`;
        button.addEventListener('click', () => {
          track('episode_select', { id: item.id, episode: episode.episodeNumber });
          activeEpisode = episode;
          loadPlayer(item, episode).then((player) => {
            if (modalPlayer) modalPlayer.dispose();
            modalPlayer = player;
            bindModalKeys(player);
            updateMeta(item, episode);
          });
        });
        seasonBlock.appendChild(button);
      });

      modalEpisodes.appendChild(seasonBlock);
    });
  };

  const openModal = (item) => {
    if (!modal) return;
    previewManager.stopAll();
    activeItem = item;
    activeEpisode = null;
    lastFocused = document.activeElement;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    document.body.classList.add('is-modal-open');
    modalTitle.textContent = item.title;
    modalSubtitle.textContent = item.subtitle || '';
    modalSynopsis.textContent = item.synopsis || '';
    updateMeta(item, null);
    renderTags(item.tags || []);
    renderEpisodes(item);

    loadPlayer(item, null).then((player) => {
      if (modalPlayer) modalPlayer.dispose();
      modalPlayer = player;
      bindModalKeys(player);
      const progress = progressStore.loadLatest(item.id);
      if (progress && progress.lastTimeSec) {
        modalPlay.textContent = 'Retomar';
      } else {
        modalPlay.textContent = 'Play';
      }
    });
  };

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', trapFocus);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  if (modalPlay) {
    modalPlay.addEventListener('click', () => {
      if (!modalPlayer || !activeItem) return;
      const progress = progressStore.loadLatest(activeItem.id);
      if (progress && progress.lastTimeSec) {
        modalPlayer.currentTime(progress.lastTimeSec);
      }
      modalPlayer.play().catch(() => {});
    });
  }

  const createCard = (item, featured) => {
    const card = document.createElement('div');
    card.className = featured
      ? 'movieShowcase__container--movie__netflix'
      : 'movieShowcase__container--movie';
    card.dataset.itemId = item.id;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Abrir ${item.title}`);

    const image = document.createElement('div');
    image.className = 'movieShowcase__container--movie-image';
    const src = item.cardImage || item.poster || '';
    if (src) {
      image.style.backgroundImage = `url(${src})`;
    }

    card.appendChild(image);

    card.addEventListener('click', () => openModal(item));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModal(item);
      }
    });

    return card;
  };

  const renderRail = (rail, items) => {
    const section = document.createElement('section');
    section.className = 'movieShowcase__section';

    const title = document.createElement('h2');
    title.className = 'movieShowcase__heading';
    title.textContent = rail.title;

    const trackEl = document.createElement('div');
    trackEl.className = 'movieShowcase__container';
    items.forEach((item) => {
      trackEl.appendChild(createCard(item, rail.featured));
    });

    section.appendChild(title);
    section.appendChild(trackEl);
    return section;
  };

  const normalizeData = (payload) => {
    const itemsById = new Map();
    (payload.items || []).forEach((item) => itemsById.set(item.id, item));
    const rails = (payload.rails || []).map((rail) => ({
      id: rail.id,
      title: rail.title,
      featured: Boolean(rail.featured),
      items: (rail.itemIds || []).map((id) => itemsById.get(id)).filter(Boolean)
    }));
    return { itemsById, rails };
  };

  const render = (data) => {
    railsRoot.innerHTML = '';
    data.rails.forEach((rail) => {
      if (!rail.items.length) return;
      railsRoot.appendChild(renderRail(rail, rail.items));
    });
    const fallback = document.getElementById('scrinium-fallback');
    if (fallback) fallback.remove();
  };

  const loadData = () => {
    if (window.SCRINIUM_DATA) return Promise.resolve(window.SCRINIUM_DATA);
    return fetch(DATA_URL).then((resp) => {
      if (!resp.ok) throw new Error('Failed to load data');
      return resp.json();
    });
  };

  loadData()
    .then((payload) => {
      const normalized = normalizeData(payload);
      render(normalized);
    })
    .catch(() => {
      railsRoot.innerHTML = '<div class="scrinium-empty">Falha ao carregar conteudo do Scrinium.</div>';
    });
})();

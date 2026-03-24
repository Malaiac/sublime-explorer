const tree = document.getElementById('tree');
const content = document.getElementById('content');
const addressBar = document.getElementById('address-bar');
const statusText = document.getElementById('status-text');
const contextMenu = document.getElementById('context-menu');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnUp = document.getElementById('btn-up');
const btnGo = document.getElementById('btn-go');
const previewContent = document.getElementById('preview-content');
const clipboardIcon = document.getElementById('clipboard-icon');
const clipboardText = document.getElementById('clipboard-text');

let currentPath = '';
let selectedTreePath = '';
let selectedContentPaths = new Set();
let history = [];
let historyIndex = -1;
let cutPaths = new Set();
let contentItems = [];
let statsCache = {}; // path -> { size, modified, created }
let focusPanel = 'content'; // 'content' | 'tree'
let skipTreeScroll = false;
let letterBuffer = '';
let letterTimeout = null;

let settings = {};

// ── Init ──
async function init() {
  const home = await api.getHome();
  settings = await api.getSettings();

  // Apply settings
  let startPath = home;
  if (settings.startPath === 'drive') startPath = home + '/Drive';
  else if (settings.startPath === 'last' && settings.lastPath) startPath = settings.lastPath;

  currentPath = startPath;
  await buildTree(home);
  await navigateTo(startPath, true);
  applySettings();
  setupEvents();
  setupSettingsEvents();

  // Auto-refresh on filesystem changes (debounced)
  let refreshTimer = null;
  api.onDirChanged(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshContent(), 500);
  });
}

// ── Tree ──
async function buildTree(rootPath) {
  tree.innerHTML = '';
  const home = await api.getHome();

  // Favorites section
  const favHeader = document.createElement('div');
  favHeader.className = 'tree-section-header';
  favHeader.textContent = '★ Favoris';
  tree.appendChild(favHeader);

  const favContainer = document.createElement('div');
  favContainer.id = 'favorites-container';
  tree.appendChild(favContainer);

  // Drop zone for adding favorites
  favContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    favContainer.classList.add('drag-over-tree');
  });
  favContainer.addEventListener('dragleave', () => favContainer.classList.remove('drag-over-tree'));
  favContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    favContainer.classList.remove('drag-over-tree');
    const sources = JSON.parse(e.dataTransfer.getData('application/json') || '[]');
    for (const src of sources) {
      const stat = await api.stat(src);
      if (stat.ok && stat.isDirectory) {
        await addFavorite(src);
      }
    }
  });

  await renderFavorites();

  // Separator
  const sep = document.createElement('div');
  sep.className = 'tree-separator';
  tree.appendChild(sep);

  // Standard roots
  const roots = [
    { path: '/', name: '/' },
    { path: home, name: '~' },
    { path: home + '/Desktop', name: 'Bureau' },
    { path: home + '/Downloads', name: 'Téléchargements' },
    { path: home + '/Documents', name: 'Documents' },
    { path: home + '/Drive', name: 'Drive' },
  ];

  for (const root of roots) {
    const node = createTreeNode(root.path, root.name, 0, true);
    if (node) tree.appendChild(node);
  }
}

async function renderFavorites() {
  const favContainer = document.getElementById('favorites-container');
  if (!favContainer) return;
  favContainer.innerHTML = '';
  const favorites = await api.getFavorites();
  if (!favorites.length) {
    const hint = document.createElement('div');
    hint.className = 'tree-hint';
    hint.textContent = 'Glisser un dossier ici';
    favContainer.appendChild(hint);
    return;
  }
  for (const fav of favorites) {
    const item = document.createElement('div');
    item.className = 'tree-item fav-item';
    item.style.paddingLeft = '4px';
    item.dataset.path = fav;
    item.innerHTML = `<span class="tree-icon">⭐</span><span class="tree-label">${fav.split('/').pop()}</span>`;
    item.addEventListener('click', async () => {
      await navigateTo(fav, true);
    });
    // Drop target
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      item.classList.add('drag-over-tree');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over-tree'));
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over-tree');
      const sources = JSON.parse(e.dataTransfer.getData('application/json') || '[]');
      if (!sources.length) return;
      if (e.altKey) {
        await api.copyFiles(sources, fav);
      } else {
        await api.moveFiles(sources, fav);
      }
      await refreshContent();
    });
    favContainer.appendChild(item);
  }
}

async function addFavorite(dirPath) {
  const favorites = await api.getFavorites();
  if (!favorites.includes(dirPath)) {
    favorites.push(dirPath);
    await api.saveFavorites(favorites);
    await renderFavorites();
  }
}

function createTreeNode(dirPath, label, depth, isRoot = false) {
  const container = document.createElement('div');

  const item = document.createElement('div');
  item.className = 'tree-item';
  item.style.paddingLeft = (depth * 16 + 4) + 'px';
  item.dataset.path = dirPath;

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = '📁';

  const nameEl = document.createElement('span');
  nameEl.className = 'tree-label';
  if (!isRoot && label.startsWith('.')) nameEl.classList.add('hidden-item');
  nameEl.textContent = label;

  item.appendChild(toggle);
  item.appendChild(icon);
  item.appendChild(nameEl);

  const childrenEl = document.createElement('div');
  childrenEl.className = 'tree-children';

  let loaded = false;

  // Click on item = navigate to content
  item.addEventListener('click', async (e) => {
    e.stopPropagation();
    selectTreeItem(item, dirPath);
    skipTreeScroll = true;
    await navigateTo(dirPath, true);
    skipTreeScroll = false;

    // Expand if not expanded
    if (!loaded) {
      await loadTreeChildren(dirPath, childrenEl, depth);
      loaded = true;
    }
    childrenEl.classList.add('expanded');
    toggle.classList.add('expanded');
  });

  // Click on toggle = expand/collapse only
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!loaded) {
      await loadTreeChildren(dirPath, childrenEl, depth);
      loaded = true;
    }
    const isExpanded = childrenEl.classList.toggle('expanded');
    toggle.classList.toggle('expanded', isExpanded);
  });

  // Right-click on tree item
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectTreeItem(item, dirPath);
    // Show context menu with favorites option
    showContextMenu(e.clientX, e.clientY);
  });

  // Drag & drop target
  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
    item.classList.add('drag-over-tree');
  });
  item.addEventListener('dragleave', () => item.classList.remove('drag-over-tree'));
  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    item.classList.remove('drag-over-tree');
    let sources = [];
    if (e.dataTransfer.files?.length > 0) {
      sources = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
    }
    if (!sources.length) {
      sources = JSON.parse(e.dataTransfer.getData('application/json') || '[]');
    }
    if (!sources.length) return;
    if (e.altKey) {
      await api.copyFiles(sources, dirPath);
    } else {
      await api.moveFiles(sources, dirPath);
    }
    await refreshContent();
    childrenEl.innerHTML = '';
    loaded = false;
  });

  container.appendChild(item);
  container.appendChild(childrenEl);
  return container;
}

async function loadTreeChildren(dirPath, childrenEl, parentDepth) {
  childrenEl.innerHTML = '';
  const result = await api.readDir(dirPath);
  if (!result.ok) return;
  const dirs = result.items.filter(i => i.isDirectory);
  for (const dir of dirs) {
    const node = createTreeNode(dir.path, dir.name, parentDepth + 1);
    if (node) childrenEl.appendChild(node);
  }
}

function selectTreeItem(itemEl, dirPath) {
  document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');
  selectedTreePath = dirPath;
}

// ── Content ──
async function navigateTo(dirPath, addToHistory = true) {
  // Resolve real path (fix case)
  const resolved = await api.realpath(dirPath);
  if (resolved.ok) dirPath = resolved.path;

  const result = await api.readDir(dirPath);
  if (!result.ok) {
    statusText.textContent = 'Erreur: ' + result.error;
    return;
  }

  currentPath = dirPath;
  addressBar.value = dirPath;
  selectedContentPaths.clear();
  contentItems = settings.showHidden !== false ? result.items : result.items.filter(i => !i.isHidden);
  statsCache = {};
  updateSystemWarning(dirPath);

  // Preload stats for sorting
  await Promise.all(contentItems.map(item =>
    api.stat(item.path).then(s => {
      if (s.ok) statsCache[item.path] = { size: s.size, modified: s.modified, created: s.created };
    })
  ));

  // Update window title + persist last path
  api.setTitle(`${dirPath} — Sublime Explorer`);
  settings.lastPath = dirPath;
  api.saveSettings(settings);
  updateBreadcrumbs(dirPath);

  // Watch for changes
  api.watchDir(dirPath);

  // Sync tree to current path
  highlightTreePath(dirPath);

  if (addToHistory) {
    historyIndex++;
    history = history.slice(0, historyIndex);
    history.push(dirPath);
  }

  // Reapply current sort
  if (currentSort.key !== 'name' || !currentSort.asc) {
    applyCurrentSort();
  }
  renderContent();
  updateSortIndicators();
}

function renderContent() {
  content.innerHTML = '';
  const stats = { dirs: 0, files: 0 };

  // Parent directory entry
  if (currentPath !== '/') {
    const parentPath = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    const parentRow = document.createElement('div');
    parentRow.className = 'content-item';
    parentRow.innerHTML = '<span class="content-icon">📁</span><span class="content-name parent-entry">..</span><span class="content-size"></span><span class="content-date"></span>';
    parentRow.addEventListener('dblclick', () => navigateTo(parentPath, true));
    content.appendChild(parentRow);
  }

  for (const item of contentItems) {
    if (item.isDirectory) stats.dirs++; else stats.files++;
    const row = createContentRow(item);
    content.appendChild(row);
  }

  statusText.textContent = `${stats.dirs} dossiers, ${stats.files} fichiers`;
}

function createContentRow(item) {
  const row = document.createElement('div');
  row.className = 'content-item';
  if (cutPaths.has(item.path)) row.classList.add('cut');
  row.dataset.path = item.path;
  row.dataset.isDir = item.isDirectory;

  const icon = document.createElement('span');
  icon.className = 'content-icon';
  icon.textContent = item.isDirectory ? '📁' : '📄';

  const name = document.createElement('span');
  name.className = 'content-name';
  if (item.isHidden) name.classList.add('hidden-item');
  name.textContent = item.name;

  const size = document.createElement('span');
  size.className = 'content-size';

  const date = document.createElement('span');
  date.className = 'content-date';

  // Load stats async + cache
  const cached = statsCache[item.path];
  if (cached) {
    if (!item.isDirectory) size.textContent = formatSize(cached.size);
    date.textContent = formatDate(cached.modified);
  } else {
    api.stat(item.path).then(s => {
      if (s.ok) {
        statsCache[item.path] = { size: s.size, modified: s.modified, created: s.created };
        if (!item.isDirectory) size.textContent = formatSize(s.size);
        date.textContent = formatDate(s.modified);
      }
    });
  }

  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(size);
  row.appendChild(date);

  // Click = select
  row.addEventListener('click', (e) => {
    if (e.metaKey) {
      // Toggle selection
      if (selectedContentPaths.has(item.path)) {
        selectedContentPaths.delete(item.path);
        row.classList.remove('selected');
      } else {
        selectedContentPaths.add(item.path);
        row.classList.add('selected');
      }
    } else if (e.shiftKey && selectedContentPaths.size > 0) {
      // Range select
      const rows = [...content.querySelectorAll('.content-item')];
      const lastSelected = rows.findIndex(r => selectedContentPaths.has(r.dataset.path));
      const current = rows.indexOf(row);
      const [start, end] = [Math.min(lastSelected, current), Math.max(lastSelected, current)];
      for (let i = start; i <= end; i++) {
        selectedContentPaths.add(rows[i].dataset.path);
        rows[i].classList.add('selected');
      }
    } else {
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
      selectedContentPaths.add(item.path);
      row.classList.add('selected');
    }
    updatePreview();
  });

  // Double-click = open
  row.addEventListener('dblclick', async () => {
    if (item.isDirectory) {
      await navigateTo(item.path, true);
      highlightTreePath(item.path);
    } else {
      await api.openFile(item.path);
    }
  });

  // Drag source (internal + native for external apps)
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    if (!selectedContentPaths.has(item.path)) {
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
      selectedContentPaths.add(item.path);
      row.classList.add('selected');
    }
    const paths = [...selectedContentPaths];
    e.dataTransfer.setData('application/json', JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'copyMove';
    row.classList.add('dragging');
    // Native drag for external apps (Gmail, Finder, Slack...)
    api.nativeDrag(paths);
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));

  // Drag target (for directories in content)
  if (item.isDirectory) {
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      row.classList.add('drag-over-tree');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over-tree'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over-tree');
      let sources = [];
      // External files
      if (e.dataTransfer.files?.length > 0) {
        sources = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
      }
      // Internal drag
      if (!sources.length) {
        sources = JSON.parse(e.dataTransfer.getData('application/json') || '[]');
      }
      if (!sources.length) return;
      if (e.altKey) {
        await api.copyFiles(sources, item.path);
      } else {
        await api.moveFiles(sources, item.path);
      }
      await refreshContent();
    });
  }

  return row;
}

async function highlightTreePath(dirPath) {
  const favContainer = document.getElementById('favorites-container');

  function findInMainTree(path) {
    const all = document.querySelectorAll(`.tree-item[data-path="${CSS.escape(path)}"]`);
    for (const el of all) {
      if (!favContainer || !favContainer.contains(el)) return el;
    }
    return null;
  }

  async function expandNode(node, nodePath) {
    const container = node.parentElement;
    const childrenEl = container.querySelector('.tree-children');
    const toggle = node.querySelector('.tree-toggle');
    if (!childrenEl) return;
    // Only load if not already expanded
    if (!childrenEl.classList.contains('expanded') || childrenEl.children.length === 0) {
      const depth = (node.style.paddingLeft ? parseInt(node.style.paddingLeft) / 16 : 0);
      await loadTreeChildren(nodePath, childrenEl, Math.round(depth));
    }
    childrenEl.classList.add('expanded');
    toggle.classList.add('expanded');
  }

  // Build path segments and expand each ancestor
  const segments = dirPath.split('/').filter(Boolean);
  let expandPath = '';

  for (let i = 0; i < segments.length; i++) {
    expandPath += '/' + segments[i];
    let node = findInMainTree(expandPath);
    if (node) {
      await expandNode(node, expandPath);
    }
  }

  // Select the target node
  let treeItem = findInMainTree(dirPath);
  if (treeItem) {
    selectTreeItem(treeItem, dirPath);
    if (!skipTreeScroll) scrollIfOutOfCenter(treeItem);
  }
}

function scrollIfOutOfCenter(el) {
  const panel = document.getElementById('tree-panel');
  const panelRect = panel.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const thirdH = panelRect.height / 3;
  const centerTop = panelRect.top + thirdH;
  const centerBottom = panelRect.top + thirdH * 2;
  // Only scroll if element is outside the middle third
  if (elRect.top < centerTop || elRect.bottom > centerBottom) {
    el.scrollIntoView({ block: 'center' });
  }
}

async function refreshContent() {
  await navigateTo(currentPath, false);
}

// ── Events ──
function setupEvents() {
  // Breadcrumbs → address bar toggle
  document.getElementById('breadcrumbs').addEventListener('dblclick', showAddressBar);

  // Address bar
  const suggestions = document.getElementById('address-suggestions');
  let suggestTimer = null;
  let suggestIndex = -1;

  addressBar.addEventListener('keydown', async (e) => {
    const items = suggestions.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown' && !suggestions.classList.contains('hidden')) {
      e.preventDefault();
      suggestIndex = Math.min(suggestIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === suggestIndex));
      if (items[suggestIndex]) addressBar.value = items[suggestIndex].dataset.path;
      return;
    }
    if (e.key === 'ArrowUp' && !suggestions.classList.contains('hidden')) {
      e.preventDefault();
      suggestIndex = Math.max(suggestIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === suggestIndex));
      if (items[suggestIndex]) addressBar.value = items[suggestIndex].dataset.path;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      suggestions.classList.add('hidden');
      const p = addressBar.value.trim();
      if (p) await navigateTo(p, true);
      showBreadcrumbs();
      return;
    }
    if (e.key === 'Escape') {
      suggestions.classList.add('hidden');
      showBreadcrumbs();
      return;
    }
    if (e.key === 'Tab' && !suggestions.classList.contains('hidden') && items.length > 0) {
      e.preventDefault();
      const target = suggestIndex >= 0 ? items[suggestIndex] : items[0];
      if (target) {
        addressBar.value = target.dataset.path + (target.dataset.isDir === 'true' ? '/' : '');
        suggestions.classList.add('hidden');
        updateAddressSuggestions();
      }
      return;
    }
  });

  addressBar.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(updateAddressSuggestions, 150);
  });

  addressBar.addEventListener('blur', () => {
    setTimeout(() => {
      suggestions.classList.add('hidden');
      showBreadcrumbs();
    }, 200);
  });

  async function updateAddressSuggestions() {
    const val = addressBar.value.trim();
    if (!val || !val.startsWith('/')) { suggestions.classList.add('hidden'); return; }

    const lastSlash = val.lastIndexOf('/');
    const parentDir = val.substring(0, lastSlash) || '/';
    const prefix = val.substring(lastSlash + 1).toLowerCase();

    const result = await api.readDir(parentDir);
    if (!result.ok) { suggestions.classList.add('hidden'); return; }

    const matches = result.items
      .filter(i => i.name.toLowerCase().startsWith(prefix))
      .slice(0, 10);

    if (!matches.length || (matches.length === 1 && matches[0].name.toLowerCase() === prefix)) {
      suggestions.classList.add('hidden');
      return;
    }

    suggestIndex = -1;
    suggestions.innerHTML = matches.map(item =>
      `<div class="suggestion-item ${item.isDirectory ? 'suggestion-dir' : 'suggestion-file'}" data-path="${item.path}" data-is-dir="${item.isDirectory}">${item.isDirectory ? '📁' : '📄'} ${item.name}</div>`
    ).join('');
    suggestions.classList.remove('hidden');

    suggestions.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        addressBar.value = el.dataset.path;
        suggestions.classList.add('hidden');
        await navigateTo(el.dataset.path, true);
      });
    });
  }

  btnGo.addEventListener('click', async () => {
    const p = addressBar.value.trim();
    suggestions.classList.add('hidden');
    if (p) await navigateTo(p, true);
  });

  // Navigation
  btnBack.addEventListener('click', async () => {
    if (historyIndex > 0) {
      historyIndex--;
      await navigateTo(history[historyIndex], false);
    }
  });
  btnForward.addEventListener('click', async () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      await navigateTo(history[historyIndex], false);
    }
  });
  btnUp.addEventListener('click', async () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    await navigateTo(parent, true);
  });

  // Keyboard
  document.addEventListener('keydown', async (e) => {
    // Skip all custom shortcuts when in an input field (rename, search, etc.)
    const inInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT';
    if (inInput && document.activeElement !== addressBar && !e.metaKey) return;

    // Cmd+C = copy (but let text selection copy work in preview)
    const inPreview = document.getElementById('preview-content').contains(document.activeElement) || window.getSelection()?.anchorNode?.closest?.('#preview-content');
    if (e.metaKey && e.key === 'c' && window.getSelection()?.toString() && document.getElementById('preview-content').contains(window.getSelection()?.anchorNode?.parentElement)) {
      // Let native copy handle text selection in preview
      return;
    }
    if (e.metaKey && e.key === 'c' && selectedContentPaths.size > 0) {
      e.preventDefault();
      cutPaths.clear();
      const paths = [...selectedContentPaths];
      await api.clipboardCopy(paths);
      updateClipboardBar('copy', paths);
      statusText.textContent = `${paths.length} élément(s) copié(s)`;
    }
    // Cmd+X = cut
    if (e.metaKey && e.key === 'x' && selectedContentPaths.size > 0) {
      e.preventDefault();
      cutPaths = new Set(selectedContentPaths);
      const paths = [...selectedContentPaths];
      await api.clipboardCut(paths);
      updateClipboardBar('cut', paths);
      renderContent();
      statusText.textContent = `${paths.length} élément(s) coupé(s)`;
    }
    // Cmd+V = paste
    if (e.metaKey && e.key === 'v') {
      e.preventDefault();
      await api.clipboardPaste(currentPath);
      cutPaths.clear();
      clearClipboardBar();
      await refreshContent();
    }
    // Delete = delete selected
    if (e.key === 'Delete' && selectedContentPaths.size > 0 && !e.metaKey) {
      e.preventDefault();
      await api.deleteFiles([...selectedContentPaths]);
      selectedContentPaths.clear();
      await refreshContent();
    }
    // Backspace = go up (always, not back)
    if (e.key === 'Backspace' && document.activeElement !== addressBar) {
      e.preventDefault();
      const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
      await navigateTo(parent, true);
    }
    // F2 = rename
    if (e.key === 'F2' && selectedContentPaths.size === 1) {
      e.preventDefault();
      startRename([...selectedContentPaths][0]);
    }
    // Enter = open
    if (e.key === 'Enter' && selectedContentPaths.size > 0 && document.activeElement !== addressBar) {
      e.preventDefault();
      const path = [...selectedContentPaths][0];
      const item = contentItems.find(i => i.path === path);
      if (item?.isDirectory) {
        await navigateTo(path, true);
      } else if (item) {
        await api.openFile(path);
      }
    }
    // Cmd+Shift+N = new folder
    if (e.metaKey && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      createNewFolder();
    }
    // F5 or Cmd+R = refresh
    if (e.key === 'F5' || (e.metaKey && e.key === 'r')) {
      e.preventDefault();
      await refreshContent();
    }
    // Cmd+L = focus address bar
    if (e.metaKey && e.key === 'l') {
      e.preventDefault();
      showAddressBar();
    }
    // Cmd+F = search in preview
    if (e.metaKey && e.key === 'f') {
      const searchInput = document.getElementById('preview-search');
      const previewEl = document.getElementById('preview-content');
      if (previewEl.querySelector('.preview-markdown, .preview-text')) {
        e.preventDefault();
        searchInput.classList.remove('hidden');
        searchInput.focus();
        searchInput.select();
      }
    }
    // Alt+Left/Right = history back/forward
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        await navigateTo(history[historyIndex], false);
      }
    }
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        await navigateTo(history[historyIndex], false);
      }
    }
    // Cmd+Left/Right = snap window
    if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowLeft' && document.activeElement === addressBar) {
      // Let normal cursor behavior in address bar
    } else if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      document.getElementById('preview-panel').style.display = 'none';
      document.getElementById('resize-handle-right').style.display = 'none';
      api.snapWindow('left');
    }
    if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowRight' && document.activeElement === addressBar) {
      // Let normal cursor behavior in address bar
    } else if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      document.getElementById('preview-panel').style.display = 'none';
      document.getElementById('resize-handle-right').style.display = 'none';
      api.snapWindow('right');
    }
    // Cmd+Up = maximize, restore preview
    if (e.metaKey && !e.altKey && !e.shiftKey && e.key === 'ArrowUp' && document.activeElement !== addressBar) {
      e.preventDefault();
      document.getElementById('preview-panel').style.display = '';
      document.getElementById('resize-handle-right').style.display = '';
      api.snapWindow('maximize');
    }
    // Cmd+W = close window
    if (e.metaKey && e.key === 'w') {
      e.preventDefault();
      window.close();
    }
    // Shift+Delete = permanent delete (not trash)
    if (e.shiftKey && e.key === 'Delete' && selectedContentPaths.size > 0) {
      e.preventDefault();
      await api.permanentDelete([...selectedContentPaths]);
      selectedContentPaths.clear();
      await refreshContent();
    }
    // Escape = deselect
    if (e.key === 'Escape') {
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
      contextMenu.classList.add('hidden');
      updatePreview();
    }
    // Tab = switch focus between tree and content
    if (e.key === 'Tab' && document.activeElement !== addressBar) {
      e.preventDefault();
      focusPanel = focusPanel === 'content' ? 'tree' : 'content';
      document.getElementById('tree-panel').classList.toggle('focused', focusPanel === 'tree');
      document.getElementById('content-panel').classList.toggle('focused', focusPanel === 'content');
    }
    // Cmd+A = select all in content
    if (e.metaKey && e.key === 'a' && document.activeElement !== addressBar) {
      e.preventDefault();
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item').forEach(el => {
        if (el.dataset.path) {
          selectedContentPaths.add(el.dataset.path);
          el.classList.add('selected');
        }
      });
      updatePreview();
    }
    // Arrow up/down = navigate content/tree
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.altKey && document.activeElement !== addressBar) {
      if (focusPanel === 'content') {
        e.preventDefault();
        navigateContent(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      } else {
        e.preventDefault();
        navigateTree(e.key === 'ArrowDown' ? 1 : -1);
      }
    }
    // Arrow left/right = switch panels or collapse/expand tree
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.altKey && document.activeElement !== addressBar) {
      if (e.key === 'ArrowRight' && focusPanel === 'tree') {
        // If current tree item is collapsed, expand it. Otherwise switch to content.
        const selected = document.querySelector('.tree-item.selected');
        if (selected) {
          const children = selected.parentElement.querySelector('.tree-children');
          const toggle = selected.querySelector('.tree-toggle');
          if (children && !children.classList.contains('expanded')) {
            e.preventDefault();
            toggle.click();
            return;
          }
        }
        e.preventDefault();
        focusPanel = 'content';
        document.getElementById('tree-panel').classList.remove('focused');
        document.getElementById('content-panel').classList.add('focused');
      } else if (e.key === 'ArrowLeft' && focusPanel === 'content') {
        e.preventDefault();
        focusPanel = 'tree';
        document.getElementById('tree-panel').classList.add('focused');
        document.getElementById('content-panel').classList.remove('focused');
      } else if (e.key === 'ArrowLeft' && focusPanel === 'tree') {
        // Collapse current tree item if expanded
        const selected = document.querySelector('.tree-item.selected');
        if (selected) {
          const children = selected.parentElement.querySelector('.tree-children');
          const toggle = selected.querySelector('.tree-toggle');
          if (children && children.classList.contains('expanded')) {
            e.preventDefault();
            children.classList.remove('expanded');
            toggle.classList.remove('expanded');
          }
        }
      } else if (e.key === 'ArrowRight' && focusPanel === 'content') {
        // In content, right arrow on a directory = enter it
        if (selectedContentPaths.size === 1) {
          const path = [...selectedContentPaths][0];
          const item = contentItems.find(i => i.path === path);
          if (item?.isDirectory) {
            e.preventDefault();
            navigateTo(path, true);
          }
        }
      }
    }
    // Home/End = first/last item
    if ((e.key === 'Home' || e.key === 'End') && document.activeElement !== addressBar) {
      e.preventDefault();
      const rows = [...content.querySelectorAll('.content-item[data-path]')];
      if (rows.length) {
        const target = e.key === 'Home' ? rows[0] : rows[rows.length - 1];
        selectedContentPaths.clear();
        content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
        selectedContentPaths.add(target.dataset.path);
        target.classList.add('selected');
        target.scrollIntoView({ block: 'nearest' });
        updatePreview();
      }
    }
    // Space = toggle selection
    if (e.key === ' ' && document.activeElement !== addressBar && selectedContentPaths.size > 0) {
      e.preventDefault();
      // Keep current, move cursor down
      navigateContent(1, true);
    }
    // Letter keys = jump to item starting with letter
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement !== addressBar && !document.activeElement.classList.contains('rename-input') && document.activeElement.tagName !== 'INPUT') {
      const letter = e.key.toLowerCase();
      // Only for letters/numbers
      if (/[a-z0-9._-]/.test(letter)) {
        e.preventDefault();
        clearTimeout(letterTimeout);
        letterBuffer += letter;
        letterTimeout = setTimeout(() => { letterBuffer = ''; }, 800);

        if (focusPanel === 'content') {
          jumpToContentItem(letterBuffer);
        } else {
          jumpToTreeItem(letterBuffer);
        }
      }
    }
  });

  // Context menu
  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.content-item');
    if (row && !selectedContentPaths.has(row.dataset.path)) {
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
      selectedContentPaths.add(row.dataset.path);
      row.classList.add('selected');
    }
    if (!row) {
      selectedContentPaths.clear();
      content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
    }
    showContextMenu(e.clientX, e.clientY);
  });

  document.addEventListener('click', () => contextMenu.classList.add('hidden'));

  contextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    contextMenu.classList.add('hidden');

    const paths = [...selectedContentPaths];
    switch (action) {
      case 'open':
        if (paths.length === 1) {
          const item = contentItems.find(i => i.path === paths[0]);
          if (item?.isDirectory) await navigateTo(paths[0], true);
          else await api.openFile(paths[0]);
        }
        break;
      case 'open-with':
        if (paths.length === 1) await api.openWith(paths[0]);
        break;
      case 'copy':
        cutPaths.clear();
        await api.clipboardCopy(paths);
        updateClipboardBar('copy', paths);
        statusText.textContent = `${paths.length} copié(s)`;
        break;
      case 'cut':
        cutPaths = new Set(paths);
        await api.clipboardCut(paths);
        updateClipboardBar('cut', paths);
        renderContent();
        statusText.textContent = `${paths.length} coupé(s)`;
        break;
      case 'paste':
        await api.clipboardPaste(currentPath);
        cutPaths.clear();
        clearClipboardBar();
        await refreshContent();
        break;
      case 'rename':
        if (paths.length === 1) startRename(paths[0]);
        break;
      case 'delete':
        await api.deleteFiles(paths);
        selectedContentPaths.clear();
        await refreshContent();
        break;
      case 'new-folder':
        createNewFolder();
        break;
      case 'add-favorite':
        let favAddPath;
        if (paths.length === 1 && contentItems.find(i => i.path === paths[0])?.isDirectory) {
          favAddPath = paths[0];
        } else if (selectedTreePath) {
          favAddPath = selectedTreePath;
        } else {
          favAddPath = currentPath;
        }
        await addFavorite(favAddPath);
        break;
      case 'remove-favorite':
        if (paths.length === 1) {
          const favs = await api.getFavorites();
          const updated = favs.filter(f => f !== paths[0]);
          await api.saveFavorites(updated);
          await renderFavorites();
        }
        break;
      case 'terminal':
        const termDir = paths.length === 1 && contentItems.find(i => i.path === paths[0])?.isDirectory
          ? paths[0] : currentPath;
        api.openInTerminal(termDir);
        break;
      case 'reveal':
        if (paths.length === 1) api.revealInFinder(paths[0]);
        break;
    }
  });

  // Resize handles
  let resizing = null;
  document.getElementById('resize-handle').addEventListener('mousedown', () => { resizing = 'left'; document.body.style.cursor = 'col-resize'; });
  document.getElementById('resize-handle-right').addEventListener('mousedown', () => { resizing = 'right'; document.body.style.cursor = 'col-resize'; });
  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    if (resizing === 'left') {
      const treePanel = document.getElementById('tree-panel');
      treePanel.style.width = Math.max(150, Math.min(600, e.clientX)) + 'px';
    } else {
      const previewPanel = document.getElementById('preview-panel');
      const windowWidth = window.innerWidth;
      previewPanel.style.width = Math.max(150, Math.min(windowWidth - 250, windowWidth - e.clientX)) + 'px';
    }
  });
  document.addEventListener('mouseup', () => {
    if (resizing) {
      settings.treeWidth = parseInt(document.getElementById('tree-panel').style.width) || 280;
      settings.previewWidth = parseInt(document.getElementById('preview-panel').style.width) || 250;
      api.saveSettings(settings);
    }
    resizing = null;
    document.body.style.cursor = '';
  });

  // Column sort
  document.getElementById('content-header').addEventListener('click', (e) => {
    const sortKey = e.target.dataset.sort;
    if (!sortKey) return;
    sortContent(sortKey);
  });

  // Drop from external apps or other Sublime Explorer windows onto content panel
  const contentPanel = document.getElementById('content');
  contentPanel.addEventListener('dragover', (e) => {
    // Only handle if not over a content-item (those have their own handlers)
    if (!e.target.closest('.content-item')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      contentPanel.classList.add('drop-target');
    }
  });
  contentPanel.addEventListener('dragleave', (e) => {
    if (!contentPanel.contains(e.relatedTarget)) {
      contentPanel.classList.remove('drop-target');
    }
  });
  contentPanel.addEventListener('drop', async (e) => {
    if (e.target.closest('.content-item[data-is-dir="true"]')) return; // handled by folder drop
    e.preventDefault();
    contentPanel.classList.remove('drop-target');

    // External files (from Finder, browser, etc.)
    if (e.dataTransfer.files?.length > 0) {
      const sources = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
      if (sources.length) {
        if (e.altKey) {
          await api.copyFiles(sources, currentPath);
        } else {
          await api.moveFiles(sources, currentPath);
        }
        await refreshContent();
        return;
      }
    }

    // Internal drag (from same or other Sublime Explorer window)
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      const sources = JSON.parse(jsonData);
      if (sources.length) {
        if (e.altKey) {
          await api.copyFiles(sources, currentPath);
        } else {
          await api.moveFiles(sources, currentPath);
        }
        await refreshContent();
      }
    }
  });

  // Preview search
  setupPreviewSearch();

  // Font size controls
  let previewFontSize = 14;
  document.getElementById('btn-font-up').addEventListener('click', () => {
    previewFontSize = Math.min(24, previewFontSize + 1);
    applyPreviewFontSize();
  });
  document.getElementById('btn-font-down').addEventListener('click', () => {
    previewFontSize = Math.max(9, previewFontSize - 1);
    applyPreviewFontSize();
  });
  function applyPreviewFontSize() {
    const md = document.querySelector('.preview-markdown');
    const txt = document.querySelector('.preview-text');
    if (md) md.style.fontSize = previewFontSize + 'px';
    if (txt) txt.style.fontSize = previewFontSize + 'px';
  }
}

function showContextMenu(x, y) {
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.remove('hidden');
}

function startRename(filePath) {
  const row = content.querySelector(`.content-item[data-path="${CSS.escape(filePath)}"]`);
  if (!row) return;
  const nameEl = row.querySelector('.content-name');
  const oldName = nameEl.textContent;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = oldName;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  // Select name without extension
  const dotIndex = oldName.lastIndexOf('.');
  input.setSelectionRange(0, dotIndex > 0 ? dotIndex : oldName.length);

  const finish = async () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      await api.rename(filePath, newName);
      await refreshContent();
    } else {
      nameEl.textContent = oldName;
    }
  };

  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { await finish(); }
    if (e.key === 'Escape') { nameEl.textContent = oldName; }
  });
  input.addEventListener('blur', finish);
}

async function createNewFolder() {
  const name = 'Nouveau dossier';
  let finalName = name;
  let i = 1;
  while (contentItems.some(item => item.name === finalName)) {
    finalName = `${name} (${i++})`;
  }
  const newPath = currentPath + '/' + finalName;
  await api.mkdir(newPath);
  await refreshContent();
  startRename(newPath);
}

let currentSort = { key: 'name', asc: true };

function applyCurrentSort() {
  const key = currentSort.key;
  contentItems.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp = 0;
    if (key === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    } else if (key === 'size') {
      const sa = statsCache[a.path]?.size || 0;
      const sb = statsCache[b.path]?.size || 0;
      cmp = sa - sb;
    } else if (key === 'modified') {
      const ma = statsCache[a.path]?.modified || '';
      const mb = statsCache[b.path]?.modified || '';
      cmp = ma.localeCompare(mb);
    }
    return currentSort.asc ? cmp : -cmp;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('#content-header span').forEach(el => {
    el.textContent = el.textContent.replace(/ [▲▼]$/, '');
    if (el.dataset.sort === currentSort.key) {
      el.textContent += currentSort.asc ? ' ▲' : ' ▼';
    }
  });
}

function sortContent(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort = { key, asc: true };
  }
  applyCurrentSort();
  updateSortIndicators();
  renderContent();
}

// ── Preview ──
async function updatePreview() {
  document.getElementById('preview-search').classList.add('hidden');
  document.getElementById('preview-search').value = '';
  if (selectedContentPaths.size === 0) {
    previewContent.innerHTML = '<div id="preview-none">Aucune sélection</div>';
    return;
  }
  if (selectedContentPaths.size > 1) {
    const paths = [...selectedContentPaths];
    let totalSize = 0;
    let dirs = 0, files = 0;
    for (const p of paths) {
      const item = contentItems.find(i => i.path === p);
      if (item?.isDirectory) dirs++; else files++;
      const cached = statsCache[p];
      if (cached) totalSize += cached.size || 0;
    }
    let details = [];
    if (dirs) details.push(`${dirs} dossier${dirs > 1 ? 's' : ''}`);
    if (files) details.push(`${files} fichier${files > 1 ? 's' : ''}`);
    previewContent.innerHTML = `
      <div class="preview-icon">📋</div>
      <div class="preview-filename">${selectedContentPaths.size} éléments sélectionnés</div>
      <div class="preview-field">
        <span class="preview-label">Contenu</span>
        <span class="preview-value">${details.join(', ')}</span>
      </div>
      <div class="preview-field">
        <span class="preview-label">Taille totale</span>
        <span class="preview-value">${formatSize(totalSize)} (${totalSize.toLocaleString()} octets)</span>
      </div>
    `;
    return;
  }

  const filePath = [...selectedContentPaths][0];
  const item = contentItems.find(i => i.path === filePath);
  if (!item) return;

  const stat = await api.stat(filePath);
  const ext = item.name.includes('.') ? item.name.split('.').pop().toLowerCase() : '';

  let html = `
    <div class="preview-icon">${item.isDirectory ? '📁' : getFileIcon(ext)}</div>
    <div class="preview-filename">${item.name}</div>
    <div class="preview-field">
      <span class="preview-label">Chemin complet</span>
      <span class="preview-value preview-path" title="Clic pour copier">${filePath}</span>
    </div>
    <div class="preview-field">
      <span class="preview-label">Type</span>
      <span class="preview-value">${item.isDirectory ? 'Dossier' : (ext ? ext.toUpperCase() : 'Fichier')}</span>
    </div>
  `;

  if (stat.ok) {
    if (!item.isDirectory) {
      html += `
        <div class="preview-field">
          <span class="preview-label">Taille</span>
          <span class="preview-value">${formatSize(stat.size)} (${stat.size.toLocaleString()} octets)</span>
        </div>
      `;
    }
    html += `
      <div class="preview-field">
        <span class="preview-label">Modifié</span>
        <span class="preview-value">${formatDate(stat.modified)}</span>
      </div>
      <div class="preview-field">
        <span class="preview-label">Créé</span>
        <span class="preview-value">${formatDate(stat.created)}</span>
      </div>
    `;
  }

  // Image preview
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  if (!item.isDirectory && imageExts.includes(ext)) {
    html += `
      <div class="preview-field">
        <span class="preview-label">Aperçu</span>
        <img class="preview-image" src="file://${filePath}" alt="${item.name}">
      </div>
    `;
  }

  // PDF preview
  if (!item.isDirectory && ext === 'pdf') {
    html += `
      <div class="preview-field">
        <span class="preview-label">Aperçu</span>
        <embed class="preview-pdf" src="file://${filePath}" type="application/pdf">
      </div>
    `;
  }

  // Markdown preview
  if (!item.isDirectory && ext === 'md' && stat.ok && stat.size < 200000) {
    try {
      const mdResult = await api.renderMarkdown(filePath);
      if (mdResult.ok) {
        html += `
          <div class="preview-field">
            <span class="preview-label">Aperçu</span>
            <div class="preview-markdown">${mdResult.html}</div>
          </div>
        `;
      }
    } catch (e) {}
  }
  // Text preview for small files (not markdown)
  else {
    const textExts = ['txt', 'json', 'js', 'ts', 'py', 'php', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'log', 'csv'];
    if (!item.isDirectory && textExts.includes(ext) && stat.ok) {
      try {
        const textContent = await api.readFileText(filePath);
        if (textContent.ok) {
          const maxChars = 500000;
        let escaped = textContent.text.substring(0, maxChars).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          if (ext === 'yaml' || ext === 'yml') escaped = highlightYaml(escaped);
          html += `
            <div class="preview-field">
              <span class="preview-label">Contenu${textContent.text.length > maxChars ? ' (tronqué à 500 Ko)' : ''}</span>
              <pre class="preview-text">${escaped}${textContent.text.length > maxChars ? '\n…' : ''}</pre>
            </div>
          `;
        }
      } catch (e) {}
    }
  }

  previewContent.innerHTML = html;

  const pathEl = previewContent.querySelector('.preview-path');
  if (pathEl) {
    pathEl.style.cursor = 'pointer';
    pathEl.addEventListener('click', () => {
      navigator.clipboard.writeText(filePath);
      pathEl.style.color = '#007acc';
      setTimeout(() => pathEl.style.color = '', 500);
      clipboardIcon.textContent = '📎';
      clipboardText.textContent = 'Chemin copié : ' + filePath;
    });
  }
}

function getFileIcon(ext) {
  const icons = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', csv: '📗',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp3: '🎵', wav: '🎵', flac: '🎵', ogg: '🎵', m4a: '🎵',
    mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
    zip: '📦', gz: '📦', tar: '📦', rar: '📦', '7z': '📦',
    js: '⚡', ts: '⚡', py: '🐍', php: '🐘', rb: '💎',
    html: '🌐', css: '🎨', json: '📋', xml: '📋', yaml: '📋', yml: '📋',
    md: '📝', txt: '📝', log: '📝',
    sh: '⚙️', bash: '⚙️', zsh: '⚙️',
  };
  return icons[ext] || '📄';
}

// ── Clipboard bar ──
function updateClipboardBar(action, paths) {
  if (!paths.length) {
    clipboardIcon.textContent = '';
    clipboardText.textContent = '';
    return;
  }
  clipboardIcon.textContent = action === 'cut' ? '✂️' : '📋';
  const names = paths.map(p => p.split('/').pop());
  if (names.length === 1) {
    clipboardText.textContent = `${action === 'cut' ? 'Déplacer' : 'Copier'} : ${names[0]}`;
  } else {
    clipboardText.textContent = `${action === 'cut' ? 'Déplacer' : 'Copier'} : ${names.length} éléments (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`;
  }
}

function clearClipboardBar() {
  clipboardIcon.textContent = '';
  clipboardText.textContent = '';
}

// ── Keyboard navigation ──
function navigateContent(direction, addToSelection) {
  const rows = [...content.querySelectorAll('.content-item[data-path]')];
  if (!rows.length) return;

  // Find current position
  let currentIndex = rows.findIndex(r => selectedContentPaths.has(r.dataset.path));
  if (currentIndex === -1) currentIndex = direction > 0 ? -1 : rows.length;

  const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
  const nextRow = rows[nextIndex];

  if (!addToSelection) {
    selectedContentPaths.clear();
    content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
  }
  selectedContentPaths.add(nextRow.dataset.path);
  nextRow.classList.add('selected');
  nextRow.scrollIntoView({ block: 'nearest' });
  updatePreview();
}

function navigateTree(direction) {
  const items = [...document.querySelectorAll('.tree-item')].filter(el => {
    // Only visible items
    let parent = el.parentElement;
    while (parent && parent !== tree) {
      if (parent.classList.contains('tree-children') && !parent.classList.contains('expanded')) return false;
      parent = parent.parentElement;
    }
    return true;
  });
  if (!items.length) return;

  const currentIndex = items.findIndex(el => el.classList.contains('selected'));
  const nextIndex = Math.max(0, Math.min(items.length - 1, (currentIndex === -1 ? 0 : currentIndex) + direction));
  const nextItem = items[nextIndex];

  nextItem.click();
  nextItem.scrollIntoView({ block: 'nearest' });
}

let lastJumpPrefix = '';
let lastJumpIndex = -1;

function jumpToContentItem(prefix) {
  const rows = [...content.querySelectorAll('.content-item[data-path]')];

  // If same prefix as last jump, cycle to next match
  let startIndex = 0;
  if (prefix === lastJumpPrefix && lastJumpIndex >= 0) {
    startIndex = lastJumpIndex + 1;
  }

  // Find match from startIndex, then wrap around
  let match = null;
  let matchIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const idx = (startIndex + i) % rows.length;
    const name = rows[idx].querySelector('.content-name')?.textContent?.toLowerCase() || '';
    if (name.startsWith(prefix)) {
      match = rows[idx];
      matchIndex = idx;
      break;
    }
  }

  if (match) {
    selectedContentPaths.clear();
    content.querySelectorAll('.content-item.selected').forEach(el => el.classList.remove('selected'));
    selectedContentPaths.add(match.dataset.path);
    match.classList.add('selected');
    match.scrollIntoView({ block: 'nearest' });
    updatePreview();
    lastJumpPrefix = prefix;
    lastJumpIndex = matchIndex;
  }
}

function jumpToTreeItem(prefix) {
  const items = [...document.querySelectorAll('.tree-item')].filter(el => {
    let parent = el.parentElement;
    while (parent && parent !== tree) {
      if (parent.classList.contains('tree-children') && !parent.classList.contains('expanded')) return false;
      parent = parent.parentElement;
    }
    return true;
  });
  const match = items.find(el => {
    const label = el.querySelector('.tree-label')?.textContent?.toLowerCase() || '';
    return label.startsWith(prefix);
  });
  if (match) match.click();
}

// ── Settings ──
function applySettings() {
  // Preview panel visibility
  document.getElementById('preview-panel').style.display = settings.showPreview !== false ? '' : 'none';
  document.getElementById('resize-handle-right').style.display = settings.showPreview !== false ? '' : 'none';
  // Panel widths — ensure content panel keeps at least 30% of window width
  const winWidth = window.innerWidth;
  const maxSidePanels = Math.floor(winWidth * 0.5);
  let treeW = settings.treeWidth || 280;
  let previewW = settings.previewWidth || 250;
  if (treeW + previewW > maxSidePanels) {
    const ratio = maxSidePanels / (treeW + previewW);
    treeW = Math.floor(treeW * ratio);
    previewW = Math.floor(previewW * ratio);
  }
  document.getElementById('tree-panel').style.width = treeW + 'px';
  document.getElementById('preview-panel').style.width = previewW + 'px';
}

function openSettingsPanel() {
  const overlay = document.getElementById('settings-overlay');
  document.getElementById('setting-start-path').value = settings.startPath || 'last';
  document.getElementById('setting-show-hidden').checked = settings.showHidden !== false;
  document.getElementById('setting-show-preview').checked = settings.showPreview !== false;
  const fontSlider = document.getElementById('setting-font-size');
  fontSlider.value = settings.previewFontSize || 14;
  document.getElementById('setting-font-size-value').textContent = fontSlider.value + 'px';
  overlay.classList.remove('hidden');
}

function setupSettingsEvents() {
  const overlay = document.getElementById('settings-overlay');

  document.getElementById('settings-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  document.getElementById('setting-start-path').addEventListener('change', (e) => {
    settings.startPath = e.target.value;
    api.saveSettings(settings);
  });

  document.getElementById('setting-show-hidden').addEventListener('change', (e) => {
    settings.showHidden = e.target.checked;
    api.saveSettings(settings);
    refreshContent();
  });

  document.getElementById('setting-show-preview').addEventListener('change', (e) => {
    settings.showPreview = e.target.checked;
    api.saveSettings(settings);
    applySettings();
  });

  const fontSlider = document.getElementById('setting-font-size');
  fontSlider.addEventListener('input', (e) => {
    settings.previewFontSize = parseInt(e.target.value);
    document.getElementById('setting-font-size-value').textContent = e.target.value + 'px';
    const md = document.querySelector('.preview-markdown');
    const txt = document.querySelector('.preview-text');
    if (md) md.style.fontSize = e.target.value + 'px';
    if (txt) txt.style.fontSize = e.target.value + 'px';
    api.saveSettings(settings);
  });

  // Cmd+, from menu
  api.onOpenSettings(() => openSettingsPanel());
}

// ── Preview search ──
function setupPreviewSearch() {
  const searchInput = document.getElementById('preview-search');
  let matches = [];
  let currentMatch = -1;

  searchInput.addEventListener('input', () => {
    doSearch(searchInput.value);
  });

  searchInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigateMatch(-1);
      } else {
        navigateMatch(1);
      }
    }
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.classList.add('hidden');
      clearHighlights();
    }
  });

  function doSearch(query) {
    clearHighlights();
    matches = [];
    currentMatch = -1;
    if (!query) return;

    const container = document.querySelector('#preview-content .preview-markdown') ||
                      document.querySelector('#preview-content .preview-text');
    if (!container) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const lowerQuery = query.toLowerCase();
    for (const node of textNodes) {
      const text = node.textContent;
      const lower = text.toLowerCase();
      let idx = 0;
      while ((idx = lower.indexOf(lowerQuery, idx)) !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + query.length);
        const span = document.createElement('mark');
        span.className = 'search-highlight';
        range.surroundContents(span);
        matches.push(span);
        idx += query.length;
        // Walker is now invalid, restart from this point
        break;
      }
    }
    // Re-scan if there are more matches (simplified: just do first pass)
    if (matches.length > 0) {
      currentMatch = 0;
      matches[0].classList.add('current');
      matches[0].scrollIntoView({ block: 'center' });
    }
  }

  function navigateMatch(dir) {
    if (!matches.length) return;
    matches[currentMatch]?.classList.remove('current');
    currentMatch = (currentMatch + dir + matches.length) % matches.length;
    matches[currentMatch].classList.add('current');
    matches[currentMatch].scrollIntoView({ block: 'center' });
  }

  function clearHighlights() {
    document.querySelectorAll('.search-highlight').forEach(el => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
    matches = [];
    currentMatch = -1;
  }
}

// ── Breadcrumbs ──
function updateBreadcrumbs(dirPath) {
  const bc = document.getElementById('breadcrumbs');
  bc.innerHTML = '';
  const segments = dirPath.split('/').filter(Boolean);

  // Root
  const rootEl = document.createElement('span');
  rootEl.className = 'breadcrumb';
  rootEl.textContent = '/';
  rootEl.addEventListener('click', (e) => { e.stopPropagation(); navigateTo('/', true); });
  bc.appendChild(rootEl);

  let path = '';
  for (let i = 0; i < segments.length; i++) {
    path += '/' + segments[i];
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    bc.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = 'breadcrumb';
    crumb.textContent = segments[i];
    const crumbPath = path;
    crumb.addEventListener('click', (e) => { e.stopPropagation(); navigateTo(crumbPath, true); });
    bc.appendChild(crumb);
  }
}

function showAddressBar() {
  const bc = document.getElementById('breadcrumbs');
  bc.classList.add('hidden');
  addressBar.classList.remove('hidden');
  addressBar.value = currentPath;
  addressBar.focus();
  addressBar.select();
}

function showBreadcrumbs() {
  const bc = document.getElementById('breadcrumbs');
  bc.classList.remove('hidden');
  addressBar.classList.add('hidden');
  document.getElementById('address-suggestions').classList.add('hidden');
}

// ── System zone warning ──
function updateSystemWarning(dirPath) {
  const home = currentPath.startsWith('/Users/') ? dirPath.split('/').slice(0, 3).join('/') : '';
  const systemPaths = [
    '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt',
    home + '/Library',
  ].filter(Boolean);
  const isSystem = systemPaths.some(sp => dirPath === sp || dirPath.startsWith(sp + '/'));
  document.body.classList.toggle('system-zone', isSystem);
  document.getElementById('system-warning').classList.toggle('visible', isSystem);
}

// ── Syntax highlighting ──
function highlightYaml(text) {
  return text.split('\n').map(line => {
    // Comments
    if (/^\s*#/.test(line)) {
      return `<span class="sy-comment">${line}</span>`;
    }
    // Key: value
    return line.replace(
      /^(\s*)([\w.\-/]+)(:)(\s*)(.*)/,
      (m, indent, key, colon, space, val) => {
        let valHtml = val;
        if (/^(&quot;.*&quot;|&#39;.*&#39;|&quot;.*|&#39;.*)/.test(val) || /^["']/.test(val)) {
          valHtml = `<span class="sy-string">${val}</span>`;
        } else if (/^(true|false|yes|no|on|off)$/i.test(val)) {
          valHtml = `<span class="sy-bool">${val}</span>`;
        } else if (/^(null|~)$/i.test(val)) {
          valHtml = `<span class="sy-null">${val}</span>`;
        } else if (/^-?\d+(\.\d+)?$/.test(val)) {
          valHtml = `<span class="sy-number">${val}</span>`;
        } else if (val.startsWith('#')) {
          valHtml = `<span class="sy-comment">${val}</span>`;
        } else if (val) {
          valHtml = `<span class="sy-string">${val}</span>`;
        }
        return `${indent}<span class="sy-key">${key}</span><span class="sy-colon">${colon}</span>${space}${valHtml}`;
      }
    )
    // List items
    .replace(/^(\s*)(- )/, '$1<span class="sy-list">$2</span>');
  }).join('\n');
}

// ── Helpers ──
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' Go';
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Start ──
init();

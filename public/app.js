document.addEventListener('DOMContentLoaded', () => {
  let currentFolder = '';
  let currentTag = '';
  let currentSearch = '';

  const themeToggle = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // Modal elements
  const modal = document.getElementById('add-modal');
  const openModalBtn = document.getElementById('open-add-modal');
  const closeModalBtns = document.querySelectorAll('.close-btn, .close-modal');

  openModalBtn.addEventListener('click', () => modal.classList.add('active'));
  closeModalBtns.forEach(btn => btn.addEventListener('click', () => modal.classList.remove('active')));

  // Fetch Meta Button
  const fetchMetaBtn = document.getElementById('fetch-meta-btn');
  const urlInput = document.getElementById('url-input');
  const titleInput = document.getElementById('title-input');
  const faviconInput = document.getElementById('favicon-input');

  fetchMetaBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    fetchMetaBtn.textContent = 'Fetching...';
    try {
      const res = await fetch('/api/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.title) titleInput.value = data.title;
      if (data.favicon) faviconInput.value = data.favicon;
    } catch (e) {
      console.error(e);
    }
    fetchMetaBtn.textContent = 'Fetch Meta';
  });

  // Load Folders & Tags
  async function loadSidebar() {
    const resFolders = await fetch('/api/folders');
    const folders = await resFolders.json();
    const folderList = document.getElementById('folder-list');
    const folderSelect = document.getElementById('folder-select');

    folderList.innerHTML = `<li class="${currentFolder === '' ? 'active' : ''}" data-folder="">All Bookmarks</li>`;
    folderSelect.innerHTML = `<option value="">-- Select Folder --</option>`;

    folders.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f.name;
      li.dataset.folder = f.id;
      if (currentFolder == f.id) li.classList.add('active');
      li.addEventListener('click', () => {
        currentFolder = f.id;
        currentTag = '';
        document.getElementById('current-view-title').textContent = f.name;
        loadSidebar();
        loadBookmarks();
      });
      folderList.appendChild(li);

      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      folderSelect.appendChild(opt);
    });

    const resTags = await fetch('/api/tags');
    const tags = await resTags.json();
    const tagCloud = document.getElementById('tag-cloud');
    tagCloud.innerHTML = '';
    tags.forEach(t => {
      const span = document.createElement('span');
      span.className = `tag-badge ${currentTag === t.name ? 'active' : ''}`;
      span.textContent = `#${t.name}`;
      span.addEventListener('click', () => {
        currentTag = currentTag === t.name ? '' : t.name;
        loadSidebar();
        loadBookmarks();
      });
      tagCloud.appendChild(span);
    });
  }

  // Add Folder
  document.getElementById('add-folder-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-folder-input');
    const name = input.value.trim();
    if (!name) return;
    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    input.value = '';
    loadSidebar();
  });

  // Load Bookmarks
  async function loadBookmarks() {
    let url = '/api/bookmarks?';
    const params = new URLSearchParams();
    if (currentFolder) params.append('folder_id', currentFolder);
    if (currentTag) params.append('tag', currentTag);
    if (currentSearch) params.append('search', currentSearch);

    const res = await fetch(url + params.toString());
    const bookmarks = await res.json();

    const grid = document.getElementById('bookmark-grid');
    const countBadge = document.getElementById('bookmark-count');
    grid.innerHTML = '';
    countBadge.textContent = `${bookmarks.length} bookmark${bookmarks.length === 1 ? '' : 's'}`;

    if (bookmarks.length === 0) {
      grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center; padding: 40px;">No bookmarks found.</p>`;
      return;
    }

    bookmarks.forEach(b => {
      const card = document.createElement('div');
      card.className = 'bookmark-card';

      const tagsHtml = b.tags.map(t => `<span class="card-tag">#${t}</span>`).join('');
      const favicon = b.favicon || 'https://www.google.com/s2/favicons?domain_url=' + encodeURIComponent(b.url);

      card.innerHTML = `
        <div class="card-header">
          <img src="${favicon}" alt="" onerror="this.src='https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(b.url)}'">
          <a href="${b.url}" target="_blank" title="${b.title}">${escapeHtml(b.title)}</a>
        </div>
        ${b.notes ? `<div class="card-notes">${escapeHtml(b.notes)}</div>` : ''}
        <div class="card-footer">
          <div class="card-tags">${tagsHtml}</div>
          <button class="delete-bm" data-id="${b.id}">Delete</button>
        </div>
      `;

      card.querySelector('.delete-bm').addEventListener('click', async () => {
        if (confirm('Delete this bookmark?')) {
          await fetch(`/api/bookmarks/${b.id}`, { method: 'DELETE' });
          loadBookmarks();
          loadSidebar();
        }
      });

      grid.appendChild(card);
    });
  }

  // Search Input
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = e.target.value.trim();
      loadBookmarks();
    }, 300);
  });

  // Add Bookmark Submit
  document.getElementById('add-bookmark-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    const title = titleInput.value.trim();
    const folder_id = document.getElementById('folder-select').value;
    const notes = document.getElementById('notes-input').value.trim();
    const favicon = faviconInput.value;
    const tags = document.getElementById('tags-input').value.split(',').map(t => t.trim()).filter(Boolean);

    await fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, folder_id: folder_id || null, notes, favicon, tags })
    });

    modal.classList.remove('active');
    document.getElementById('add-bookmark-form').reset();
    faviconInput.value = '';
    loadBookmarks();
    loadSidebar();
  });

  // Export JSON
  document.getElementById('export-btn').addEventListener('click', async () => {
    const res = await fetch('/api/bookmarks');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  loadSidebar();
  loadBookmarks();
});

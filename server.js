const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 8080;

// Database setup
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'bookmarks.db');
const fs = require('fs');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    folder_id INTEGER,
    notes TEXT,
    favicon TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmark_tags (
    bookmark_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY(bookmark_id, tag_id),
    FOREIGN KEY(bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
`);

// Seed default folder if empty
const folderCount = db.prepare('SELECT COUNT(*) as count FROM folders').get().count;
if (folderCount === 0) {
  db.prepare('INSERT INTO folders (name) VALUES (?)').run('General');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSRF Protection check
function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API: Get Folders
app.get('/api/folders', (req, res) => {
  const folders = db.prepare('SELECT * FROM folders ORDER BY name ASC').all();
  res.json(folders);
});

// API: Create Folder
app.post('/api/folders', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });
  try {
    const stmt = db.prepare('INSERT INTO folders (name) VALUES (?)');
    const info = stmt.run(name.trim());
    res.json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: 'Folder already exists or invalid' });
  }
});

// API: Get Tags
app.get('/api/tags', (req, res) => {
  const tags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
  res.json(tags);
});

// API: Metadata scraper
app.post('/api/metadata', async (req, res) => {
  const { url } = req.body;
  if (!url || !isSafeUrl(url)) {
    return res.status(400).json({ error: 'Invalid or restricted URL' });
  }

  const client = url.startsWith('https') ? https : http;
  
  const fetchPromise = new Promise((resolve) => {
    const request = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Compatible; BookmarkManager/1.0)' } }, (response) => {
      if (response.statusCode !== 200) {
        resolve({ title: url, favicon: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}` });
        return;
      }
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const $ = cheerio.load(data);
          const title = $('title').first().text() || url;
          const parsedUrl = new URL(url);
          let favicon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href');
          if (favicon) {
            if (favicon.startsWith('//')) favicon = parsedUrl.protocol + favicon;
            else if (favicon.startsWith('/')) favicon = `${parsedUrl.origin}${favicon}`;
            else if (!favicon.startsWith('http')) favicon = `${parsedUrl.origin}/${favicon}`;
          } else {
            favicon = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;
          }
          resolve({ title: title.trim(), favicon });
        } catch (e) {
          resolve({ title: url, favicon: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64` });
        }
      });
    });
    request.on('error', () => {
      resolve({ title: url, favicon: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64` });
    });
    setTimeout(() => {
      request.destroy();
      resolve({ title: url, favicon: `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64` });
    }, 4000);
  });

  const result = await fetchPromise;
  res.json(result);
});

// API: Get Bookmarks
app.get('/api/bookmarks', (req, res) => {
  const { search, folder_id, tag } = req.query;
  let query = `
    SELECT b.*, f.name as folder_name, 
    (SELECT GROUP_CONCAT(t.name) FROM bookmark_tags bt JOIN tags t ON bt.tag_id = t.id WHERE bt.bookmark_id = b.id) as tags_str
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    WHERE 1=1
  `;
  const params = [];

  if (folder_id) {
    query += ' AND b.folder_id = ?';
    params.push(folder_id);
  }
  if (search) {
    query += ' AND (b.title LIKE ? OR b.url LIKE ? OR b.notes LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += ' ORDER BY b.created_at DESC';
  let bookmarks = db.prepare(query).all(...params);

  // Process tags into array
  bookmarks = bookmarks.map(b => ({
    ...b,
    tags: b.tags_str ? b.tags_str.split(',') : []
  }));

  if (tag) {
    bookmarks = bookmarks.filter(b => b.tags.includes(tag));
  }

  res.json(bookmarks);
});

// API: Create Bookmark
app.post('/api/bookmarks', (req, res) => {
  const { url, title, folder_id, notes, favicon, tags } = req.body;
  if (!url || !isSafeUrl(url)) return res.status(400).json({ error: 'Valid URL is required' });

  const finalTitle = title || url;
  const finalFavicon = favicon || `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url)}&sz=64`;

  const insertBm = db.transaction((u, t, f, n, fav, tgList) => {
    const info = db.prepare('INSERT INTO bookmarks (url, title, folder_id, notes, favicon) VALUES (?, ?, ?, ?, ?)').run(u, t, f, n, fav);
    const bmId = info.lastInsertRowid;

    if (tgList && Array.isArray(tgList)) {
      for (let tagName of tgList) {
        tagName = tagName.trim().toLowerCase();
        if (!tagName) continue;
        let tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        let tagId;
        if (!tagRow) {
          const tInfo = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
          tagId = tInfo.lastInsertRowid;
        } else {
          tagId = tagRow.id;
        }
        db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)').run(bmId, tagId);
      }
    }
    return bmId;
  });

  try {
    const bmId = insertBm(url, finalTitle, folder_id || null, notes || '', finalFavicon, tags);
    res.json({ id: bmId, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Delete Bookmark
app.delete('/api/bookmarks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bookmark Manager running on port ${PORT}`);
});

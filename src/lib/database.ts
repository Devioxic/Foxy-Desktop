import initSqlJs, { Database } from "sql.js";
import localforage from "localforage";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Vite adds the `?url` importer at build-time
// eslint-disable-next-line import/no-unresolved
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

// Database schema
const SCHEMA = `
  -- Artists table
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    overview TEXT,
    production_year INTEGER,
    genres TEXT, -- JSON array
    image_tags TEXT, -- JSON object
    image_blur_hashes TEXT, -- JSON object
    backdrop_image_tags TEXT, -- JSON array
    user_data TEXT, -- JSON object with favorite status, play count, etc.
    album_count INTEGER DEFAULT 0,
    song_count INTEGER DEFAULT 0,
    sync_timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Albums table
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    overview TEXT,
    production_year INTEGER,
    genres TEXT, -- JSON array
    album_artists TEXT, -- JSON array of artist objects
    artist_items TEXT, -- JSON array of artist items
    image_tags TEXT, -- JSON object
    image_blur_hashes TEXT, -- JSON object
    backdrop_image_tags TEXT, -- JSON array
    user_data TEXT, -- JSON object
    child_count INTEGER DEFAULT 0,
    cumulative_run_time_ticks INTEGER DEFAULT 0,
    date_created TEXT,
    sync_timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Tracks table
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    album_id TEXT,
    album TEXT,
    artists TEXT, -- JSON array of artist names
    artist_items TEXT, -- JSON array of artist objects
    album_artist TEXT,
    genres TEXT, -- JSON array
    index_number INTEGER,
    parent_index_number INTEGER,
    track_number INTEGER,
    run_time_ticks INTEGER,
    production_year INTEGER,
    image_tags TEXT, -- JSON object
    image_blur_hashes TEXT, -- JSON object
    user_data TEXT, -- JSON object
    media_sources TEXT, -- JSON array
    chapter_images_date_modified TEXT,
    lyrics TEXT,
    sync_timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (album_id) REFERENCES albums(id)
  );

  -- Playlists table
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    overview TEXT,
    image_tags TEXT, -- JSON object
    image_blur_hashes TEXT, -- JSON object
    user_data TEXT, -- JSON object
    child_count INTEGER DEFAULT 0,
    cumulative_run_time_ticks INTEGER DEFAULT 0,
    date_created TEXT,
    date_modified TEXT,
    sync_timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Playlist items table (for playlist tracks)
  CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    sort_index INTEGER DEFAULT 0,
    sync_timestamp INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id),
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );

  -- Sync metadata table
  CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Create indexes for better performance
  CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
  CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name);
  CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(album_artists);
  CREATE INDEX IF NOT EXISTS idx_tracks_name ON tracks(name);
  CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artists);
  CREATE INDEX IF NOT EXISTS idx_playlists_name ON playlists(name);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_id ON playlist_items(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_track_id ON playlist_items(track_id);
  CREATE INDEX IF NOT EXISTS idx_sync_timestamp ON artists(sync_timestamp);
  CREATE INDEX IF NOT EXISTS idx_album_sync_timestamp ON albums(sync_timestamp);
  CREATE INDEX IF NOT EXISTS idx_track_sync_timestamp ON tracks(sync_timestamp);

  -- Downloads table: track media downloaded locally
  CREATE TABLE IF NOT EXISTS downloads (
    track_id TEXT PRIMARY KEY,
    file_rel_path TEXT NOT NULL, -- relative to userData/media
    container TEXT,
    bitrate INTEGER, -- bps
    size_bytes INTEGER,
    downloaded_at INTEGER DEFAULT (strftime('%s', 'now')),
    source_server TEXT,
    checksum TEXT
  );

  -- Downloaded collections (albums/playlists/artists)
  CREATE TABLE IF NOT EXISTS downloaded_collections (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('album','playlist','artist')),
    name TEXT,
    downloaded_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`;

interface SyncStatus {
  lastFullSync: number;
  lastIncrementalSync: number;
  artistsCount: number;
  albumsCount: number;
  tracksCount: number;
  playlistsCount: number;
}

class LocalDatabase {
  private db: Database | null = null;
  private sqlJs: any = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const isElectron = !!(
        typeof window !== "undefined" &&
        (window as any).process?.versions?.electron
      );

      // Initialize SQL.js with retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          this.sqlJs = await initSqlJs({
            locateFile: (file) => {
              // sql.js only asks for `sql-wasm.wasm`; return the Vite-managed asset URL.
              if (file.endsWith(".wasm")) {
                return wasmUrl as unknown as string;
              }
              // Fallback: return as-is (should not be needed)
              return file;
            },
          });

          break; // Success
        } catch (sqlJsError) {
          retries--;
          if (retries === 0) {
            throw sqlJsError;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Try to load existing database from storage (Electron file > localforage)
      const savedDb = await this.loadPersistedDatabase();

      if (savedDb) {
        this.db = new this.sqlJs.Database(savedDb);
      } else {
        // Create new database
        this.db = new this.sqlJs.Database();
      }

      // Run schema creation
      this.db.exec(SCHEMA);

      // Lightweight migrations: add cached flags if missing
      try {
        this.db.exec(
          "ALTER TABLE albums ADD COLUMN is_cached INTEGER DEFAULT 0"
        );
      } catch (e) {}
      try {
        this.db.exec("ALTER TABLE albums ADD COLUMN cached_at INTEGER");
      } catch (e) {}
      try {
        this.db.exec(
          "ALTER TABLE tracks ADD COLUMN is_cached INTEGER DEFAULT 0"
        );
      } catch (e) {}
      try {
        this.db.exec("ALTER TABLE tracks ADD COLUMN cached_at INTEGER");
      } catch (e) {}

      // Save the database
      await this.saveDatabase();

      this.isInitialized = true;
    } catch (error) {
      throw error;
    }
  }

  private async saveDatabase(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      const data = this.db.export();
      const isElectron = !!(
        typeof window !== "undefined" &&
        (window as any).process?.versions?.electron
      );
      if (isElectron && (window as any).electronAPI?.dbSave) {
        await (window as any).electronAPI.dbSave(data);
      } else {
        await localforage.setItem("jellyfinDatabase", data);
      }
    } catch (error) {}
  }

  private async loadPersistedDatabase(): Promise<Uint8Array | null> {
    try {
      const isElectron = !!(
        typeof window !== "undefined" &&
        (window as any).process?.versions?.electron
      );
      if (isElectron && (window as any).electronAPI?.dbLoad) {
        const buf: ArrayBuffer | null = await (
          window as any
        ).electronAPI.dbLoad();
        if (buf && buf.byteLength > 0) {
          return new Uint8Array(buf);
        }
      }
    } catch (e) {}
    try {
      const saved = await localforage.getItem<Uint8Array>("jellyfinDatabase");
      return saved || null;
    } catch (e) {
      return null;
    }
  }

  // Downloads API
  async upsertDownload(entry: {
    track_id: string;
    file_rel_path: string;
    container?: string | null;
    bitrate?: number | null;
    size_bytes?: number | null;
    source_server?: string | null;
    checksum?: string | null;
  }): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(`
      INSERT INTO downloads (track_id, file_rel_path, container, bitrate, size_bytes, source_server, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        file_rel_path=excluded.file_rel_path,
        container=excluded.container,
        bitrate=excluded.bitrate,
        size_bytes=excluded.size_bytes,
        source_server=excluded.source_server,
        checksum=excluded.checksum
    `);
    stmt.run([
      entry.track_id,
      entry.file_rel_path,
      entry.container ?? null,
      entry.bitrate ?? null,
      entry.size_bytes ?? null,
      entry.source_server ?? null,
      entry.checksum ?? null,
    ]);
    stmt.free();
    await this.saveDatabase();
  }

  async removeDownload(trackId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(`DELETE FROM downloads WHERE track_id = ?`);
    stmt.run([trackId]);
    stmt.free();
    await this.saveDatabase();
  }

  async getDownload(trackId: string): Promise<{
    track_id: string;
    file_rel_path: string;
    container?: string;
    bitrate?: number;
    size_bytes?: number;
  } | null> {
    const results = this.exec(`SELECT * FROM downloads WHERE track_id = ?`, [
      trackId,
    ]);
    return results[0] || null;
  }

  async getAllDownloads(): Promise<
    Array<{
      track_id: string;
      file_rel_path: string;
      container?: string;
      bitrate?: number;
      size_bytes?: number;
    }>
  > {
    return this.exec(
      `SELECT * FROM downloads ORDER BY downloaded_at DESC`
    ) as any[];
  }

  async clearDownloads(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    this.exec(`DELETE FROM downloads`);
    await this.saveDatabase();
  }

  async markCollectionDownloaded(
    id: string,
    type: "album" | "playlist" | "artist",
    name?: string
  ) {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO downloaded_collections (id, type, name, downloaded_at) VALUES (?, ?, ?, strftime('%s','now'))`
    );
    stmt.run([id, type, name || null]);
    stmt.free();
    await this.saveDatabase();
  }

  async unmarkCollectionDownloaded(id: string) {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(
      `DELETE FROM downloaded_collections WHERE id = ?`
    );
    stmt.run([id]);
    stmt.free();
    await this.saveDatabase();
  }

  async getDownloadedCollections(): Promise<
    Array<{ id: string; type: string; name?: string }>
  > {
    return this.exec(
      `SELECT * FROM downloaded_collections ORDER BY downloaded_at DESC`
    ) as any[];
  }

  async clearDownloadedCollections(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    this.exec(`DELETE FROM downloaded_collections`);
    await this.saveDatabase();
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.saveDatabase();
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  // Helper method to safely execute queries
  private exec(sql: string, params: any[] = []): any[] {
    if (!this.db) throw new Error("Database not initialized");

    try {
      const stmt = this.db.prepare(sql);
      if (params && params.length) {
        try {
          stmt.bind(params);
        } catch (e) {
          // In case of mismatch, log and continue to attempt execution
          // eslint-disable-next-line no-console
          console.warn("SQL bind failed for:", sql, params, e);
        }
      }
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      throw error;
    }
  }

  // Artist operations
  async saveArtists(artists: BaseItemDto[]): Promise<void> {
    if (!artists.length) return;

    const timestamp = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO artists (
        id, name, overview, production_year, genres, image_tags, 
        image_blur_hashes, backdrop_image_tags, user_data, 
        album_count, song_count, sync_timestamp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const artist of artists) {
      stmt.run([
        artist.Id,
        artist.Name,
        artist.Overview || null,
        artist.ProductionYear || null,
        JSON.stringify(artist.Genres || []),
        JSON.stringify(artist.ImageTags || {}),
        JSON.stringify(artist.ImageBlurHashes || {}),
        JSON.stringify(artist.BackdropImageTags || []),
        JSON.stringify(artist.UserData || {}),
        artist.AlbumCount || 0,
        artist.SongCount || 0,
        timestamp,
        timestamp,
      ]);
    }

    stmt.free();
    await this.saveDatabase();
  }

  async getArtists(limit?: number, offset?: number): Promise<BaseItemDto[]> {
    let sql = `
      SELECT * FROM artists 
      ORDER BY name COLLATE NOCASE
    `;

    if (limit) {
      sql += ` LIMIT ${limit}`;
      if (offset) {
        sql += ` OFFSET ${offset}`;
      }
    }

    const results = this.exec(sql);
    return results.map((row) => this.rowToArtist(row));
  }

  async getArtistsWithAlbums(
    limit?: number,
    offset?: number
  ): Promise<BaseItemDto[]> {
    let sql = `SELECT * FROM artists WHERE album_count > 0 ORDER BY name COLLATE NOCASE`;
    if (limit) {
      sql += ` LIMIT ${limit}`;
      if (offset) sql += ` OFFSET ${offset}`;
    }
    const results = this.exec(sql);
    return results.map((row) => this.rowToArtist(row));
  }

  async getArtistsWithAlbumsCount(): Promise<number> {
    const results = this.exec(
      `SELECT COUNT(*) as count FROM artists WHERE album_count > 0`
    );
    return results[0]?.count || 0;
  }

  async getArtistById(id: string): Promise<BaseItemDto | null> {
    const results = this.exec("SELECT * FROM artists WHERE id = ?", [id]);
    return results.length > 0 ? this.rowToArtist(results[0]) : null;
  }

  async searchArtists(query: string): Promise<BaseItemDto[]> {
    const results = this.exec(
      "SELECT * FROM artists WHERE name LIKE ? ORDER BY name COLLATE NOCASE",
      [`%${query}%`]
    );
    return results.map((row) => this.rowToArtist(row));
  }

  // Album operations
  async saveAlbums(albums: BaseItemDto[]): Promise<void> {
    if (!albums.length) return;

    const timestamp = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO albums (
        id, name, overview, production_year, genres, album_artists,
        artist_items, image_tags, image_blur_hashes, backdrop_image_tags,
        user_data, child_count, cumulative_run_time_ticks, date_created,
        sync_timestamp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const album of albums) {
      stmt.run([
        album.Id,
        album.Name,
        album.Overview || null,
        album.ProductionYear || null,
        JSON.stringify(album.Genres || []),
        JSON.stringify(album.AlbumArtists || []),
        JSON.stringify(album.ArtistItems || []),
        JSON.stringify(album.ImageTags || {}),
        JSON.stringify(album.ImageBlurHashes || {}),
        JSON.stringify(album.BackdropImageTags || []),
        JSON.stringify(album.UserData || {}),
        album.ChildCount || 0,
        album.CumulativeRunTimeTicks || 0,
        album.DateCreated || null,
        timestamp,
        timestamp,
      ]);
    }

    stmt.free();
    await this.saveDatabase();
  }

  async getAlbums(limit?: number, offset?: number): Promise<BaseItemDto[]> {
    let sql = `
      SELECT * FROM albums 
      ORDER BY name COLLATE NOCASE
    `;

    if (limit) {
      sql += ` LIMIT ${limit}`;
      if (offset) {
        sql += ` OFFSET ${offset}`;
      }
    }

    const results = this.exec(sql);
    return results.map((row) => this.rowToAlbum(row));
  }

  async getAlbumById(id: string): Promise<BaseItemDto | null> {
    const results = this.exec("SELECT * FROM albums WHERE id = ?", [id]);
    return results.length > 0 ? this.rowToAlbum(results[0]) : null;
  }

  async getAlbumsByArtistId(artistId: string): Promise<BaseItemDto[]> {
    const results = this.exec(
      `SELECT * FROM albums 
       WHERE album_artists LIKE ? OR artist_items LIKE ?
       ORDER BY production_year DESC, name COLLATE NOCASE`,
      [`%"${artistId}"%`, `%"${artistId}"%`]
    );
    return results.map((row) => this.rowToAlbum(row));
  }

  // Track operations
  async saveTracks(tracks: BaseItemDto[]): Promise<void> {
    if (!tracks.length) return;

    const timestamp = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO tracks (
        id, name, album_id, album, artists, artist_items, album_artist,
        genres, index_number, parent_index_number, track_number,
        run_time_ticks, production_year, image_tags, image_blur_hashes,
        user_data, media_sources, chapter_images_date_modified,
        sync_timestamp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const track of tracks) {
      // Merge with existing to avoid overwriting fields with null/empty values
      let existing: BaseItemDto | null = null;
      try {
        existing = (await this.getTrackById(track.Id!)) as any;
      } catch {}

      const pick = <T>(
        n: T | undefined,
        e: T | undefined,
        preferEmpty = false
      ): T | undefined => {
        if (n === undefined || n === null) return e;
        if (!preferEmpty) {
          if (Array.isArray(n) && n.length === 0) return e;
          if (typeof n === "object" && n && Object.keys(n as any).length === 0)
            return e;
        }
        return n;
      };

      const merged = {
        Id: track.Id,
        Name: pick(track.Name, existing?.Name),
        AlbumId: pick(track.AlbumId as any, existing?.AlbumId as any),
        Album: pick(track.Album, existing?.Album),
        Artists: pick(track.Artists as any, existing?.Artists as any),
        ArtistItems: pick(
          track.ArtistItems as any,
          existing?.ArtistItems as any
        ),
        AlbumArtist: pick(
          track.AlbumArtist as any,
          existing?.AlbumArtist as any
        ),
        Genres: pick(track.Genres as any, existing?.Genres as any),
        IndexNumber: pick(
          track.IndexNumber as any,
          existing?.IndexNumber as any
        ),
        ParentIndexNumber: pick(
          track.ParentIndexNumber as any,
          existing?.ParentIndexNumber as any
        ),
        RunTimeTicks: pick(
          track.RunTimeTicks as any,
          existing?.RunTimeTicks as any
        ),
        ProductionYear: pick(
          track.ProductionYear as any,
          existing?.ProductionYear as any
        ),
        ImageTags: pick(track.ImageTags as any, existing?.ImageTags as any),
        ImageBlurHashes: pick(
          track.ImageBlurHashes as any,
          existing?.ImageBlurHashes as any
        ),
        UserData: pick(track.UserData as any, existing?.UserData as any),
        MediaSources: pick(
          track.MediaSources as any,
          existing?.MediaSources as any
        ),
        ChapterImagesDateModified: pick(
          (track as any).ChapterImagesDateModified,
          (existing as any)?.ChapterImagesDateModified
        ),
      } as BaseItemDto;

      stmt.run([
        merged.Id,
        merged.Name,
        (merged as any).AlbumId || null,
        merged.Album || null,
        JSON.stringify(merged.Artists || []),
        JSON.stringify(merged.ArtistItems || []),
        merged.AlbumArtist || null,
        JSON.stringify(merged.Genres || []),
        merged.IndexNumber || null,
        merged.ParentIndexNumber || null,
        merged.IndexNumber || null, // track_number
        merged.RunTimeTicks || 0,
        merged.ProductionYear || null,
        JSON.stringify(merged.ImageTags || {}),
        JSON.stringify(merged.ImageBlurHashes || {}),
        JSON.stringify(merged.UserData || {}),
        JSON.stringify(merged.MediaSources || []),
        (merged as any).ChapterImagesDateModified || null,
        timestamp,
        timestamp,
      ]);
    }

    stmt.free();
    await this.saveDatabase();
  }

  async getTracks(limit?: number, offset?: number): Promise<BaseItemDto[]> {
    let sql = `
      SELECT * FROM tracks 
      ORDER BY name COLLATE NOCASE
    `;

    if (limit) {
      sql += ` LIMIT ${limit}`;
      if (offset) {
        sql += ` OFFSET ${offset}`;
      }
    }

    const results = this.exec(sql);
    return results.map((row) => this.rowToTrack(row));
  }

  async getTracksByAlbumId(albumId: string): Promise<BaseItemDto[]> {
    const results = this.exec(
      `SELECT * FROM tracks 
       WHERE album_id = ?
       ORDER BY index_number ASC, name COLLATE NOCASE`,
      [albumId]
    );
    return results.map((row) => this.rowToTrack(row));
  }

  async getTracksByArtistId(artistId: string): Promise<BaseItemDto[]> {
    const results = this.exec(
      `SELECT * FROM tracks 
       WHERE artist_items LIKE ?
       ORDER BY name COLLATE NOCASE`,
      [`%"${artistId}"%`]
    );
    return results.map((row) => this.rowToTrack(row));
  }

  async getTrackById(id: string): Promise<BaseItemDto | null> {
    const results = this.exec(`SELECT * FROM tracks WHERE id = ?`, [id]);
    return results.length ? this.rowToTrack(results[0]) : null;
  }

  async getTracksByIds(ids: string[]): Promise<BaseItemDto[]> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(",");
    const results = this.exec(
      `SELECT * FROM tracks WHERE id IN (${placeholders})`,
      ids
    );
    return results.map((row) => this.rowToTrack(row));
  }

  async getCachedTracks(): Promise<BaseItemDto[]> {
    const results = this.exec(
      `SELECT * FROM tracks WHERE is_cached = 1 ORDER BY coalesce(cached_at, updated_at) DESC, name COLLATE NOCASE`
    );
    return results.map((row) => this.rowToTrack(row));
  }

  async getCachedTrackIds(): Promise<string[]> {
    const results = this.exec(`SELECT id FROM tracks WHERE is_cached = 1`);
    return results.map((r) => String(r.id));
  }

  async getCachedAlbums(): Promise<BaseItemDto[]> {
    const results = this.exec(
      `SELECT * FROM albums WHERE is_cached = 1 ORDER BY coalesce(cached_at, updated_at) DESC, name COLLATE NOCASE`
    );
    return results.map((row) => this.rowToAlbum(row));
  }

  async getCachedAlbumIds(): Promise<string[]> {
    const results = this.exec(`SELECT id FROM albums WHERE is_cached = 1`);
    return results.map((r) => String(r.id));
  }

  async getAlbumIdsWithCachedTracks(): Promise<string[]> {
    const results = this.exec(
      `SELECT DISTINCT album_id as id FROM tracks WHERE is_cached = 1 AND album_id IS NOT NULL`
    );
    return results.map((r) => String(r.id));
  }

  // Mark tracks/albums as locally cached (downloaded)
  async markTracksCached(ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.db) throw new Error("Database not initialized");
    const placeholders = ids.map(() => "?").join(",");
    this.exec(
      `UPDATE tracks SET is_cached = 1, cached_at = strftime('%s','now') WHERE id IN (${placeholders})`,
      ids
    );
    await this.saveDatabase();
  }

  async markAlbumsCached(ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.db) throw new Error("Database not initialized");
    const placeholders = ids.map(() => "?").join(",");
    this.exec(
      `UPDATE albums SET is_cached = 1, cached_at = strftime('%s','now') WHERE id IN (${placeholders})`,
      ids
    );
    await this.saveDatabase();
  }

  async unmarkTracksCached(ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.db) throw new Error("Database not initialized");
    const placeholders = ids.map(() => "?").join(",");
    this.exec(
      `UPDATE tracks SET is_cached = 0 WHERE id IN (${placeholders})`,
      ids
    );
    await this.saveDatabase();
  }

  async unmarkAlbumsCached(ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (!this.db) throw new Error("Database not initialized");
    const placeholders = ids.map(() => "?").join(",");
    this.exec(
      `UPDATE albums SET is_cached = 0 WHERE id IN (${placeholders})`,
      ids
    );
    await this.saveDatabase();
  }

  // New: search tracks by (partial) name
  async searchTracks(query: string): Promise<BaseItemDto[]> {
    if (!query) return [];
    const results = this.exec(
      `SELECT * FROM tracks WHERE name LIKE ? ORDER BY name COLLATE NOCASE`,
      [`%${query.replace(/%/g, "")}%`]
    );
    return results.map((row) => this.rowToTrack(row));
  }

  // Playlist operations
  async savePlaylists(playlists: BaseItemDto[]): Promise<void> {
    if (!playlists.length) return;

    const timestamp = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO playlists (
        id, name, overview, image_tags, image_blur_hashes, user_data,
        child_count, cumulative_run_time_ticks, date_created, date_modified,
        sync_timestamp, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const playlist of playlists) {
      stmt.run([
        playlist.Id,
        playlist.Name,
        playlist.Overview || null,
        JSON.stringify(playlist.ImageTags || {}),
        JSON.stringify(playlist.ImageBlurHashes || {}),
        JSON.stringify(playlist.UserData || {}),
        playlist.ChildCount || 0,
        playlist.CumulativeRunTimeTicks || 0,
        playlist.DateCreated || null,
        null, // DateModified not available in BaseItemDto
        timestamp,
        timestamp,
      ]);
    }

    stmt.free();
    await this.saveDatabase();
  }

  async getPlaylists(): Promise<BaseItemDto[]> {
    const results = this.exec(
      "SELECT * FROM playlists ORDER BY name COLLATE NOCASE"
    );
    return results.map((row) => this.rowToPlaylist(row));
  }

  async getPlaylistById(id: string): Promise<BaseItemDto | null> {
    const results = this.exec("SELECT * FROM playlists WHERE id = ?", [id]);
    return results.length > 0 ? this.rowToPlaylist(results[0]) : null;
  }

  async replacePlaylistItems(
    playlistId: string,
    items: Array<{
      playlistItemId?: string | null;
      trackId: string;
      sortIndex?: number | null;
    }>
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    const timestamp = Date.now();
    this.db.exec("BEGIN TRANSACTION");
    try {
      const deleteStmt = this.db.prepare(
        "DELETE FROM playlist_items WHERE playlist_id = ?"
      );
      deleteStmt.run([playlistId]);
      deleteStmt.free();

      if (items.length) {
        const insertStmt = this.db.prepare(`
          INSERT OR REPLACE INTO playlist_items (id, playlist_id, track_id, sort_index, sync_timestamp)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const item of items) {
          if (!item.trackId) continue;
          const playlistItemId =
            item.playlistItemId || `${playlistId}:${item.trackId}`;
          insertStmt.run([
            playlistItemId,
            playlistId,
            item.trackId,
            item.sortIndex ?? 0,
            timestamp,
          ]);
        }
        insertStmt.free();
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    await this.saveDatabase();
  }

  async getTrackPlaylistMembership(
    trackId: string
  ): Promise<
    Record<string, { playlistItemId: string | null; sortIndex: number | null }>
  > {
    if (!trackId) return {};
    const rows = this.exec(
      `SELECT playlist_id, id AS playlist_item_id, sort_index FROM playlist_items WHERE track_id = ?`,
      [trackId]
    );
    const map: Record<
      string,
      { playlistItemId: string | null; sortIndex: number | null }
    > = {};
    for (const row of rows) {
      const pid = row.playlist_id as string;
      map[pid] = {
        playlistItemId: (row.playlist_item_id as string) || null,
        sortIndex:
          typeof row.sort_index === "number"
            ? (row.sort_index as number)
            : null,
      };
    }
    return map;
  }

  async hasPlaylistItemsCached(): Promise<boolean> {
    const results = this.exec(
      "SELECT 1 as present FROM playlist_items LIMIT 1"
    );
    return results.length > 0;
  }

  // New: remove a playlist and its items from local database cache
  async deletePlaylist(playlistId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    try {
      this.exec("DELETE FROM playlist_items WHERE playlist_id = ?", [
        playlistId,
      ]);
      this.exec("DELETE FROM playlists WHERE id = ?", [playlistId]);
      await this.saveDatabase();
    } catch (e) {
      throw e;
    }
  }

  // Sync metadata operations
  async setSyncMetadata(key: string, value: string): Promise<void> {
    try {
      // Ensure database is initialized
      if (!this.isInitialized || !this.db) {
        throw new Error("Database not initialized. Call initialize() first.");
      }

      this.exec(
        `
        INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
        VALUES (?, ?, ?)
      `,
        [key, value, Date.now()]
      );
      await this.saveDatabase();
    } catch (error) {
      throw error;
    }
  }

  async getSyncMetadata(key: string): Promise<string | null> {
    try {
      // Ensure database is initialized
      if (!this.isInitialized || !this.db) {
        return null;
      }

      const results = this.exec(
        "SELECT value FROM sync_metadata WHERE key = ?",
        [key]
      );
      const value = results.length > 0 ? results[0].value : null;
      return value;
    } catch (error) {
      return null;
    }
  }

  async getSyncStatus(): Promise<SyncStatus> {
    // Ensure database is initialized
    if (!this.isInitialized || !this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    let lastFullSync = parseInt(
      (await this.getSyncMetadata("lastFullSync")) || "0"
    );
    const lastIncrementalSync = parseInt(
      (await this.getSyncMetadata("lastIncrementalSync")) || "0"
    );

    const artistsCount = this.exec("SELECT COUNT(*) as count FROM artists")[0]
      .count;
    const albumsCount = this.exec("SELECT COUNT(*) as count FROM albums")[0]
      .count;
    const tracksCount = this.exec("SELECT COUNT(*) as count FROM tracks")[0]
      .count;
    const playlistsCount = this.exec(
      "SELECT COUNT(*) as count FROM playlists"
    )[0].count;

    // If we have data but no sync timestamp, set it now (migration fix)
    if (
      lastFullSync === 0 &&
      (artistsCount > 0 || albumsCount > 0 || tracksCount > 0)
    ) {
      const now = Date.now();
      await this.setSyncMetadata("lastFullSync", now.toString());
      await this.setSyncMetadata("lastIncrementalSync", now.toString());
      lastFullSync = now;
    }

    const status = {
      lastFullSync,
      lastIncrementalSync,
      artistsCount,
      albumsCount,
      tracksCount,
      playlistsCount,
    };

    return status;
  }

  async recomputeArtistCounts(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Get minimal album + track artist linkage data
      const albumRows = this.exec(
        "SELECT id, album_artists, artist_items FROM albums"
      );
      const trackRows = this.exec("SELECT id, artist_items FROM tracks");

      const albumMap: Record<string, Set<string>> = {}; // artistId -> set of albumIds
      const songCount: Record<string, number> = {}; // artistId -> song count

      for (const row of albumRows) {
        const albumId = row.id as string;
        let artistObjs: any[] = [];
        try {
          const aa = JSON.parse(row.album_artists || "[]");
          const ai = JSON.parse(row.artist_items || "[]");
          artistObjs = [...aa, ...ai];
        } catch {}
        const seen = new Set<string>();
        for (const a of artistObjs) {
          const id = a?.Id;
          if (id && !seen.has(id)) {
            seen.add(id);
            if (!albumMap[id]) albumMap[id] = new Set();
            albumMap[id].add(albumId);
          }
        }
      }

      for (const row of trackRows) {
        let artistObjs: any[] = [];
        try {
          artistObjs = JSON.parse(row.artist_items || "[]");
        } catch {}
        const seen = new Set<string>();
        for (const a of artistObjs) {
          const id = a?.Id;
          if (id && !seen.has(id)) {
            seen.add(id);
            songCount[id] = (songCount[id] || 0) + 1;
          }
        }
      }

      const allArtistIds = new Set<string>([
        ...Object.keys(albumMap),
        ...Object.keys(songCount),
      ]);
      if (allArtistIds.size === 0) {
        return;
      }

      const stmt = this.db.prepare(
        "UPDATE artists SET album_count = ?, song_count = ?, updated_at = strftime('%s','now') WHERE id = ?"
      );
      let updated = 0;
      for (const artistId of allArtistIds) {
        const albumsForArtist = albumMap[artistId];
        const albumCount = albumsForArtist ? albumsForArtist.size : 0;
        const songsForArtist = songCount[artistId] || 0;
        try {
          stmt.run([albumCount, songsForArtist, artistId]);
          updated++;
        } catch (e) {
          // Ignore artists not present in table
        }
      }
      stmt.free();
      await this.saveDatabase();
    } catch (error) {}
  }

  // Helper methods to convert database rows back to BaseItemDto objects
  private rowToArtist(row: any): BaseItemDto {
    return {
      Id: row.id,
      Name: row.name,
      Overview: row.overview,
      ProductionYear: row.production_year,
      Genres: JSON.parse(row.genres || "[]"),
      ImageTags: JSON.parse(row.image_tags || "{}"),
      ImageBlurHashes: JSON.parse(row.image_blur_hashes || "{}"),
      BackdropImageTags: JSON.parse(row.backdrop_image_tags || "[]"),
      UserData: JSON.parse(row.user_data || "{}"),
      AlbumCount: row.album_count,
      SongCount: row.song_count,
      Type: "MusicArtist",
    } as BaseItemDto;
  }

  private rowToAlbum(row: any): BaseItemDto {
    const albumArtists = JSON.parse(row.album_artists || "[]");
    const artistItems = JSON.parse(row.artist_items || "[]");
    const derivedAlbumArtist =
      (Array.isArray(albumArtists) && albumArtists[0]?.Name) ||
      (Array.isArray(artistItems) && artistItems[0]?.Name) ||
      undefined;

    return {
      Id: row.id,
      Name: row.name,
      Overview: row.overview,
      ProductionYear: row.production_year,
      Genres: JSON.parse(row.genres || "[]"),
      AlbumArtists: albumArtists,
      ArtistItems: artistItems,
      AlbumArtist: derivedAlbumArtist,
      ImageTags: JSON.parse(row.image_tags || "{}"),
      ImageBlurHashes: JSON.parse(row.image_blur_hashes || "{}"),
      BackdropImageTags: JSON.parse(row.backdrop_image_tags || "[]"),
      UserData: JSON.parse(row.user_data || "{}"),
      ChildCount: row.child_count,
      CumulativeRunTimeTicks: row.cumulative_run_time_ticks,
      DateCreated: row.date_created,
      Type: "MusicAlbum",
    } as BaseItemDto;
  }

  private rowToTrack(row: any): BaseItemDto {
    return {
      Id: row.id,
      Name: row.name,
      AlbumId: row.album_id,
      Album: row.album,
      Artists: JSON.parse(row.artists || "[]"),
      ArtistItems: JSON.parse(row.artist_items || "[]"),
      AlbumArtist: row.album_artist,
      Genres: JSON.parse(row.genres || "[]"),
      IndexNumber: row.index_number,
      ParentIndexNumber: row.parent_index_number,
      RunTimeTicks: row.run_time_ticks,
      ProductionYear: row.production_year,
      ImageTags: JSON.parse(row.image_tags || "{}"),
      ImageBlurHashes: JSON.parse(row.image_blur_hashes || "{}"),
      UserData: JSON.parse(row.user_data || "{}"),
      MediaSources: JSON.parse(row.media_sources || "[]"),
      ChapterImagesDateModified: row.chapter_images_date_modified,
      Type: "Audio",
    } as BaseItemDto;
  }

  private rowToPlaylist(row: any): BaseItemDto {
    return {
      Id: row.id,
      Name: row.name,
      Overview: row.overview,
      ImageTags: JSON.parse(row.image_tags || "{}"),
      ImageBlurHashes: JSON.parse(row.image_blur_hashes || "{}"),
      UserData: JSON.parse(row.user_data || "{}"),
      ChildCount: row.child_count,
      CumulativeRunTimeTicks: row.cumulative_run_time_ticks,
      DateCreated: row.date_created,
      DateModified: row.date_modified,
      Type: "Playlist",
    } as BaseItemDto;
  }
}

// Create and export singleton instance
export const localDb = new LocalDatabase();

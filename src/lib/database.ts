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
      console.log("Database: Already initialized");
      return;
    }

    try {
      console.log("Database: Starting initialization...");

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
                console.log("Database: using bundled wasm asset:", wasmUrl);
                return wasmUrl as unknown as string;
              }
              // Fallback: return as-is (should not be needed)
              return file;
            },
          });
          console.log("Database: SQL.js initialized");
          break; // Success
        } catch (sqlJsError) {
          retries--;
          console.warn(
            `Database: SQL.js initialization failed, ${retries} retries left:`,
            sqlJsError
          );
          if (retries === 0) {
            console.error(
              "Database: All retries exhausted. Ensure sql-wasm.wasm is present in dist/ next to index.html."
            );
            throw sqlJsError;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Try to load existing database from storage (Electron file > localforage)
      const savedDb = await this.loadPersistedDatabase();

      if (savedDb) {
        this.db = new this.sqlJs.Database(savedDb);
        console.log("Database: Loaded existing database from storage");
      } else {
        // Create new database
        this.db = new this.sqlJs.Database();
        console.log("Database: Created new database");
      }

      // Run schema creation
      this.db.exec(SCHEMA);
      console.log("Database: Schema created");

      // Save the database
      await this.saveDatabase();
      console.log("Database: Database saved");

      this.isInitialized = true;
      console.log("Database: Initialization completed successfully");
    } catch (error) {
      console.error("Database: Failed to initialize:", error);
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
    } catch (error) {
      console.error("Failed to save database:", error);
    }
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
    } catch (e) {
      console.warn(
        "Database: Electron dbLoad failed, falling back to localforage",
        e
      );
    }
    try {
      const saved = await localforage.getItem<Uint8Array>("jellyfinDatabase");
      return saved || null;
    } catch (e) {
      console.warn("Database: localforage load failed", e);
      return null;
    }
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
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error("Database query error:", error, { sql, params });
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
      stmt.run([
        track.Id,
        track.Name,
        track.AlbumId || null,
        track.Album || null,
        JSON.stringify(track.Artists || []),
        JSON.stringify(track.ArtistItems || []),
        track.AlbumArtist || null,
        JSON.stringify(track.Genres || []),
        track.IndexNumber || null,
        track.ParentIndexNumber || null,
        track.IndexNumber || null, // track_number
        track.RunTimeTicks || 0,
        track.ProductionYear || null,
        JSON.stringify(track.ImageTags || {}),
        JSON.stringify(track.ImageBlurHashes || {}),
        JSON.stringify(track.UserData || {}),
        JSON.stringify(track.MediaSources || []),
        null, // ChapterImagesDateModified not available in BaseItemDto
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

  // New: remove a playlist and its items from local database cache
  async deletePlaylist(playlistId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    try {
      this.exec("DELETE FROM playlist_items WHERE playlist_id = ?", [
        playlistId,
      ]);
      this.exec("DELETE FROM playlists WHERE id = ?", [playlistId]);
      await this.saveDatabase();
      console.log(`Database: Deleted playlist ${playlistId} from cache`);
    } catch (e) {
      console.error("Database: Failed to delete playlist", e);
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
      console.log(`Database: Set sync metadata ${key} = ${value}`);
    } catch (error) {
      console.error(`Database: Failed to set sync metadata ${key}:`, error);
      throw error;
    }
  }

  async getSyncMetadata(key: string): Promise<string | null> {
    try {
      // Ensure database is initialized
      if (!this.isInitialized || !this.db) {
        console.warn(
          `Database: Cannot get sync metadata ${key} - database not initialized`
        );
        return null;
      }

      const results = this.exec(
        "SELECT value FROM sync_metadata WHERE key = ?",
        [key]
      );
      const value = results.length > 0 ? results[0].value : null;
      console.log(`Database: Get sync metadata ${key} = ${value}`);
      return value;
    } catch (error) {
      console.error(`Database: Failed to get sync metadata ${key}:`, error);
      return null;
    }
  }

  async getSyncStatus(): Promise<SyncStatus> {
    console.log("Database: Getting sync status...");

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
      console.log(
        "Database: Found synced data without timestamp, setting current time"
      );
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

    console.log("Database: Sync status:", status);
    return status;
  }

  async recomputeArtistCounts(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    console.time("Database: recomputeArtistCounts");
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
        console.log(
          "Database: recomputeArtistCounts found no artist references"
        );
        console.timeEnd("Database: recomputeArtistCounts");
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
      console.log(
        `Database: recomputeArtistCounts updated counts for ${updated} artists (albums source rows=${albumRows.length}, tracks source rows=${trackRows.length})`
      );
      console.timeEnd("Database: recomputeArtistCounts");
    } catch (error) {
      console.error("Database: recomputeArtistCounts failed", error);
      console.timeEnd("Database: recomputeArtistCounts");
    }
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
    return {
      Id: row.id,
      Name: row.name,
      Overview: row.overview,
      ProductionYear: row.production_year,
      Genres: JSON.parse(row.genres || "[]"),
      AlbumArtists: JSON.parse(row.album_artists || "[]"),
      ArtistItems: JSON.parse(row.artist_items || "[]"),
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

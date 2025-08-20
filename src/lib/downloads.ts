import { localDb } from "./database";
import { logger } from "./logger";

// Contract:
// - downloadTrack: fetches audio for a trackId using provided URL, saves to userData/media, records in DB.
// - getLocalUrlForTrack: returns media:/// URL if downloaded, else null.
// - removeDownload: deletes file and DB row.

const toSafeFilename = (s: string) =>
  s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);

export async function getLocalUrlForTrack(
  trackId: string
): Promise<string | null> {
  try {
    await localDb.initialize();
    const entry = await localDb.getDownload(trackId);
    if (!entry) return null;
    if ((window as any).electronAPI?.mediaGetFileUrl) {
      const url = await (window as any).electronAPI.mediaGetFileUrl(
        entry.file_rel_path
      );
      return url || null;
    }
    return null; // Non-electron fallback not yet implemented
  } catch (e) {
    logger.error("getLocalUrlForTrack failed", e);
    return null;
  }
}

export async function downloadTrack(params: {
  trackId: string;
  name?: string;
  url: string; // resolved stream URL honoring current quality decision
  container?: string;
  bitrate?: number;
}): Promise<string | null> {
  const { trackId, name, url, container, bitrate } = params;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download (${res.status})`);
    const buf = await res.arrayBuffer();

    const ext = container ? container.toLowerCase().split(" ")[0] : "mp3";
    const base = `${toSafeFilename(name || trackId)}-${trackId}.${ext}`;
    const rel = `tracks/${base}`;

    if ((window as any).electronAPI?.mediaSave) {
      const savedPath: string = await (window as any).electronAPI.mediaSave(
        rel,
        buf
      );
      await localDb.initialize();
      await localDb.upsertDownload({
        track_id: trackId,
        file_rel_path: rel,
        container: container || null,
        bitrate: bitrate || null,
        size_bytes: buf.byteLength,
        source_server:
          JSON.parse(localStorage.getItem("authData") || "{}")?.serverAddress ||
          null,
        checksum: null,
      });
      // Persist track metadata locally so UI shows proper titles/artists
      try {
        const { getAudioStreamInfo, getAlbumInfo } = await import(
          "@/lib/jellyfin"
        );
        const auth = JSON.parse(localStorage.getItem("authData") || "{}");
        if (auth.serverAddress && auth.accessToken) {
          const info = await getAudioStreamInfo(
            auth.serverAddress,
            auth.accessToken,
            trackId
          );
          if (info?.item) {
            await localDb.saveTracks([info.item as any]);
            // Also save album metadata if we can derive AlbumId
            const aid = (info.item as any).AlbumId;
            if (aid) {
              try {
                const album = await getAlbumInfo(
                  auth.serverAddress,
                  auth.accessToken,
                  aid
                );
                if (album) await localDb.saveAlbums([album as any]);
              } catch (e) {
                logger.warn(
                  "Saving album metadata after track download failed",
                  e
                );
              }
            }
          }
        }
      } catch (e) {
        logger.warn("Saving track metadata after download failed", e);
      }
      try {
        await localDb.markTracksCached([trackId]);
      } catch {}
      // Notify UI
      try {
        window.dispatchEvent(new Event("downloadsUpdate"));
      } catch {}
      // Return the custom protocol URL used by the app to load local files
      return `media:///${encodeURI(rel)}`;
    }
    return null;
  } catch (e) {
    logger.error("downloadTrack failed", e);
    return null;
  }
}

export async function removeDownload(trackId: string): Promise<boolean> {
  try {
    await localDb.initialize();
    const entry = await localDb.getDownload(trackId);
    if (!entry) return true;
    if ((window as any).electronAPI?.mediaDelete) {
      await (window as any).electronAPI.mediaDelete(entry.file_rel_path);
    }
    await localDb.removeDownload(trackId);
    try {
      await localDb.unmarkTracksCached([trackId]);
    } catch {}
    try {
      window.dispatchEvent(new Event("downloadsUpdate"));
    } catch {}
    return true;
  } catch (e) {
    logger.error("removeDownload failed", e);
    return false;
  }
}

export async function isCollectionDownloaded(id: string): Promise<boolean> {
  await localDb.initialize();
  const cols = await localDb.getDownloadedCollections();
  return cols.some((c) => c.id === id);
}

export async function downloadAlbumById(
  albumId: string,
  name?: string
): Promise<{ downloaded: number; failed: number }> {
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  if (!auth.serverAddress || !auth.accessToken)
    throw new Error("Not authenticated");
  const { getAlbumItems } = await import("@/lib/jellyfin");
  const data = await getAlbumItems(
    auth.serverAddress,
    auth.accessToken,
    albumId
  );
  const items = (data?.Items || []).filter((i: any) => i?.Id);
  let downloaded = 0;
  let failed = 0;
  const trackIds: string[] = [];
  // Save track metadata for this album locally
  try {
    await localDb.initialize();
    if (items.length) await localDb.saveTracks(items as any);
  } catch (e) {
    logger.warn("Saving album tracks metadata failed", e);
  }
  for (const t of items) {
    try {
      const url = `${auth.serverAddress}/Audio/${t.Id}/stream?static=true&api_key=${auth.accessToken}`;
      const ms = (t as any).MediaSources?.[0];
      await downloadTrack({
        trackId: t.Id,
        name: t.Name,
        url,
        container: ms?.Container,
        bitrate: ms?.Bitrate,
      });
      trackIds.push(t.Id);
      downloaded++;
    } catch {
      failed++;
    }
  }
  // Save album info locally so it appears in Downloads
  try {
    const { getAlbumInfo } = await import("@/lib/jellyfin");
    const album = await getAlbumInfo(
      auth.serverAddress,
      auth.accessToken,
      albumId
    );
    if (album) await localDb.saveAlbums([album as any]);
  } catch (e) {
    logger.warn("Saving album info after download failed", e);
  }
  await localDb.markCollectionDownloaded(albumId, "album", name);
  try {
    await localDb.markTracksCached(trackIds);
    await localDb.markAlbumsCached([albumId]);
  } catch {}
  try {
    window.dispatchEvent(new Event("downloadsUpdate"));
  } catch {}
  return { downloaded, failed };
}

export async function downloadPlaylistById(
  playlistId: string,
  name?: string
): Promise<{ downloaded: number; failed: number }> {
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  if (!auth.serverAddress || !auth.accessToken)
    throw new Error("Not authenticated");
  const { getPlaylistItems } = await import("@/lib/jellyfin");
  const items = await getPlaylistItems(playlistId);
  let downloaded = 0;
  let failed = 0;
  const trackIds: string[] = [];
  // Save track metadata locally for playlist items
  try {
    await localDb.initialize();
    if ((items as any[])?.length) await localDb.saveTracks(items as any);
  } catch (e) {
    logger.warn("Saving playlist tracks metadata failed", e);
  }
  for (const t of items as any[]) {
    try {
      const url = `${auth.serverAddress}/Audio/${t.Id}/stream?static=true&api_key=${auth.accessToken}`;
      const ms = (t as any).MediaSources?.[0];
      await downloadTrack({
        trackId: t.Id,
        name: t.Name,
        url,
        container: ms?.Container,
        bitrate: ms?.Bitrate,
      });
      trackIds.push(t.Id);
      downloaded++;
    } catch {
      failed++;
    }
  }
  await localDb.markCollectionDownloaded(playlistId, "playlist", name);
  try {
    await localDb.markTracksCached(trackIds);
  } catch {}
  try {
    window.dispatchEvent(new Event("downloadsUpdate"));
  } catch {}
  return { downloaded, failed };
}

export async function removeAlbumDownloads(albumId: string) {
  await localDb.initialize();
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  const { getAlbumItems } = await import("@/lib/jellyfin");
  const data = await getAlbumItems(
    auth.serverAddress,
    auth.accessToken,
    albumId
  );
  const items = (data?.Items || []).filter((i: any) => i?.Id);
  for (const t of items) {
    try {
      await removeDownload(t.Id);
    } catch {}
  }
  await localDb.unmarkCollectionDownloaded(albumId);
  try {
    await localDb.unmarkAlbumsCached([albumId]);
  } catch {}
}

export async function removePlaylistDownloads(playlistId: string) {
  await localDb.initialize();
  const items = await (
    await import("@/lib/jellyfin")
  ).getPlaylistItems(playlistId);
  for (const t of items as any[]) {
    try {
      if (t?.Id) await removeDownload(t.Id);
    } catch {}
  }
  await localDb.unmarkCollectionDownloaded(playlistId);
}

export async function clearAllDownloads(): Promise<{ removed: number } | null> {
  try {
    await localDb.initialize();
    const all = await localDb.getAllDownloads();
    // Delete media files
    let removed = 0;
    for (const d of all) {
      try {
        if ((window as any).electronAPI?.mediaDelete) {
          await (window as any).electronAPI.mediaDelete(d.file_rel_path);
        }
        removed++;
      } catch (e) {
        logger.warn("Failed to delete media file", d.file_rel_path, e);
      }
    }

    // Clear downloads table and downloaded collections
    await localDb.clearDownloads();
    await localDb.clearDownloadedCollections();

    // Unmark cached flags
    try {
      const cachedTrackIds = await localDb.getCachedTrackIds();
      if (cachedTrackIds.length)
        await localDb.unmarkTracksCached(cachedTrackIds);
    } catch {}
    try {
      const cachedAlbumIds = await localDb.getCachedAlbumIds();
      if (cachedAlbumIds.length)
        await localDb.unmarkAlbumsCached(cachedAlbumIds);
    } catch {}

    // Notify UI
    try {
      window.dispatchEvent(new Event("downloadsUpdate"));
    } catch {}

    return { removed };
  } catch (e) {
    logger.error("clearAllDownloads failed", e);
    return null;
  }
}

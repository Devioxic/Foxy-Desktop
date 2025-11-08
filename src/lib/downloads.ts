import { localDb } from "./database";
import { logger } from "./logger";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

// Contract:
// - downloadTrack: fetches audio for a trackId using provided URL, saves to userData/media, records in DB.
// - getLocalUrlForTrack: returns media:/// URL if downloaded, else null.
// - removeDownload: deletes file and DB row.

const toSafeFilename = (s: string) =>
  s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);

type ImageEntity = "album" | "playlist" | "track" | "artist";

const determineImageExtension = (contentType: string | null): string => {
  if (!contentType) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
};

async function ensurePrimaryImageCached(params: {
  itemId: string;
  type: ImageEntity;
  serverAddress?: string;
  accessToken?: string;
  imageTag?: string | null;
  displayName?: string;
}): Promise<string | null> {
  const { itemId, type, serverAddress, accessToken, imageTag, displayName } =
    params;
  if (!itemId) return null;

  await localDb.initialize();
  const existing = await localDb.getLocalPrimaryImageInfo(type, itemId);
  if (existing?.path && (!imageTag || existing.tag === imageTag)) {
    return existing.path;
  }

  if (!serverAddress || !accessToken) {
    return existing?.path || null;
  }

  if (!(window as any).electronAPI?.mediaSave) {
    return existing?.path || null;
  }

  try {
    const tagQuery = imageTag ? `&tag=${encodeURIComponent(imageTag)}` : "";
    const url = `${serverAddress}/Items/${itemId}/Images/Primary?maxWidth=600&quality=90${tagQuery}&api_key=${accessToken}`;
    const response = await fetch(url);
    if (!response.ok) {
      return existing?.path || null;
    }
    const contentType = response.headers.get("content-type");
    const extension = determineImageExtension(contentType);
    const baseName = toSafeFilename(displayName || itemId);
    const tagSuffix = imageTag ? `-${toSafeFilename(imageTag)}` : "";
    const rel = `images/${type}s/${baseName}-${itemId}${tagSuffix}.${extension}`;
    const buffer = await response.arrayBuffer();
    if ((window as any).electronAPI?.mediaSave) {
      await (window as any).electronAPI.mediaSave(rel, buffer);
    }
    if (
      existing?.path &&
      existing.path !== rel &&
      (window as any).electronAPI?.mediaDelete
    ) {
      try {
        await (window as any).electronAPI.mediaDelete(existing.path);
      } catch (cleanupError) {
        logger.warn("Failed to clean up old cached image", cleanupError);
      }
    }
    await localDb.setLocalPrimaryImage(type, itemId, rel, imageTag || null);
    return rel;
  } catch (error) {
    logger.warn("Failed to cache image", error);
    return existing?.path || null;
  }
}

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
  track?: BaseItemDto | null;
  skipMetadata?: boolean;
  suppressEvent?: boolean;
}): Promise<string | null> {
  const {
    trackId,
    name,
    url,
    container,
    bitrate,
    track,
    skipMetadata = false,
    suppressEvent = false,
  } = params;
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  let trackMetadata: BaseItemDto | null | undefined = track;
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
        source_server: auth?.serverAddress || null,
        checksum: null,
      });
      if (!skipMetadata) {
        try {
          let trackToPersist: BaseItemDto | null | undefined = trackMetadata;
          let albumIdForFetch: string | undefined;

          if (!trackToPersist && auth.serverAddress && auth.accessToken) {
            const { getAudioStreamInfo } = await import("@/lib/jellyfin");
            const info = await getAudioStreamInfo(
              auth.serverAddress,
              auth.accessToken,
              trackId
            );
            trackToPersist = info?.item || null;
            albumIdForFetch = (trackToPersist as any)?.AlbumId;
            if (albumIdForFetch) {
              try {
                const { getAlbumInfo } = await import("@/lib/jellyfin");
                const album = await getAlbumInfo(
                  auth.serverAddress,
                  auth.accessToken,
                  albumIdForFetch
                );
                if (album) {
                  await localDb.saveAlbums([album as any]);
                  await ensurePrimaryImageCached({
                    itemId: String(album.Id || albumIdForFetch),
                    type: "album",
                    serverAddress: auth?.serverAddress,
                    accessToken: auth?.accessToken,
                    imageTag:
                      (album as any)?.ImageTags?.Primary ??
                      (album as any)?.PrimaryImageTag ??
                      null,
                    displayName: (album as any)?.Name ?? undefined,
                  });
                }
              } catch (e) {
                logger.warn(
                  "Saving album metadata after track download failed",
                  e
                );
              }
            }
          }

          if (trackToPersist) {
            trackMetadata = trackToPersist;
            await localDb.saveTracks([trackToPersist as any]);
          }
        } catch (e) {
          logger.warn("Saving track metadata after download failed", e);
        }
      }
      try {
        if (trackMetadata) {
          await ensurePrimaryImageCached({
            itemId: trackId,
            type: "track",
            serverAddress: auth?.serverAddress,
            accessToken: auth?.accessToken,
            imageTag:
              (trackMetadata as any)?.ImageTags?.Primary ??
              (trackMetadata as any)?.PrimaryImageTag ??
              null,
            displayName: trackMetadata.Name ?? name,
          });
          const albumId = (trackMetadata as any)?.AlbumId;
          if (albumId) {
            await ensurePrimaryImageCached({
              itemId: String(albumId),
              type: "album",
              serverAddress: auth?.serverAddress,
              accessToken: auth?.accessToken,
              imageTag:
                (trackMetadata as any)?.AlbumPrimaryImageTag ??
                (trackMetadata as any)?.Album?.PrimaryImageTag ??
                null,
              displayName:
                (trackMetadata as any)?.Album ??
                (trackMetadata as any)?.AlbumTitle ??
                undefined,
            });
          }
        }
      } catch (e) {
        logger.warn("Caching track-related imagery failed", e);
      }
      try {
        await localDb.markTracksCached([trackId]);
      } catch {}
      if (!suppressEvent) {
        let albumIdForRefresh: string | undefined;
        let albumNameForRefresh: string | undefined;
        try {
          if (track && (track as any)?.AlbumId) {
            albumIdForRefresh = (track as any).AlbumId;
            albumNameForRefresh = (track as any).Album;
          } else {
            const storedTrack = (await localDb.getTrackById(trackId)) as any;
            if (storedTrack) {
              albumIdForRefresh = storedTrack.AlbumId;
              albumNameForRefresh = storedTrack.Album;
            }
          }
          if (albumIdForRefresh) {
            await localDb.refreshAlbumDownloadFlag(
              albumIdForRefresh,
              albumNameForRefresh
            );
          }
        } catch (e) {
          logger.warn("Refreshing album download state failed", e);
        }
      }
      try {
        window.dispatchEvent(
          new CustomEvent("trackDownloadStatusChanged", {
            detail: { trackId, downloaded: true },
          })
        );
      } catch {}
      if (!suppressEvent) {
        // Notify UI (optional for bulk operations)
        try {
          window.dispatchEvent(new Event("downloadsUpdate"));
        } catch {}
      }
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
    let albumIdForRefresh: string | undefined;
    let albumNameForRefresh: string | undefined;
    try {
      const storedTrack = (await localDb.getTrackById(trackId)) as any;
      if (storedTrack) {
        albumIdForRefresh = storedTrack.AlbumId;
        albumNameForRefresh = storedTrack.Album;
      }
    } catch {}
    const entry = await localDb.getDownload(trackId);
    if (!entry) return true;
    if ((window as any).electronAPI?.mediaDelete) {
      await (window as any).electronAPI.mediaDelete(entry.file_rel_path);
    }
    await localDb.removeDownload(trackId);
    try {
      await localDb.unmarkTracksCached([trackId]);
    } catch {}
    if (albumIdForRefresh) {
      try {
        await localDb.refreshAlbumDownloadFlag(
          albumIdForRefresh,
          albumNameForRefresh
        );
      } catch (e) {
        logger.warn("Refreshing album download state failed", e);
      }
    }
    try {
      window.dispatchEvent(
        new CustomEvent("trackDownloadStatusChanged", {
          detail: { trackId, downloaded: false },
        })
      );
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
        track: t as any,
        skipMetadata: true,
        suppressEvent: true,
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
    if (album) {
      await localDb.saveAlbums([album as any]);
      await ensurePrimaryImageCached({
        itemId: String(album.Id || albumId),
        type: "album",
        serverAddress: auth.serverAddress,
        accessToken: auth.accessToken,
        imageTag:
          (album as any)?.ImageTags?.Primary ??
          (album as any)?.PrimaryImageTag ??
          null,
        displayName: (album as any)?.Name ?? name,
      });
    }
  } catch (e) {
    logger.warn("Saving album info after download failed", e);
  }
  await localDb.refreshAlbumDownloadFlag(albumId, name);
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
  const touchedAlbumIds = new Set<string>();
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
        track: t as any,
        skipMetadata: true,
        suppressEvent: true,
      });
      trackIds.push(t.Id);
      if (t.AlbumId) {
        touchedAlbumIds.add(t.AlbumId);
      }
      downloaded++;
    } catch {
      failed++;
    }
  }
  await localDb.markCollectionDownloaded(playlistId, "playlist", name);
  try {
    const { getPlaylistInfo } = await import("@/lib/jellyfin");
    const playlist = await getPlaylistInfo(playlistId);
    if (playlist) {
      await localDb.savePlaylists([playlist as any]);
      await ensurePrimaryImageCached({
        itemId: String(playlist.Id || playlistId),
        type: "playlist",
        serverAddress: auth.serverAddress,
        accessToken: auth.accessToken,
        imageTag:
          (playlist as any)?.ImageTags?.Primary ??
          (playlist as any)?.PrimaryImageTag ??
          null,
        displayName: (playlist as any)?.Name ?? name,
      });
    }
  } catch (e) {
    logger.warn("Saving playlist info after download failed", e);
  }
  try {
    await localDb.markTracksCached(trackIds);
    for (const albumId of touchedAlbumIds) {
      try {
        await localDb.refreshAlbumDownloadFlag(albumId);
      } catch (e) {
        logger.warn("Refreshing album download state failed", e);
      }
    }
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

// Favourites (special, no Jellyfin playlist ID). We mark collection id as 'favourites'.
export async function downloadFavourites(
  name: string = "Favourites"
): Promise<{ downloaded: number; failed: number }> {
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  if (!auth.serverAddress || !auth.accessToken)
    throw new Error("Not authenticated");
  const { getFavorites } = await import("@/lib/jellyfin");
  const favorites = await getFavorites(auth.serverAddress, auth.accessToken);
  const items = (favorites?.Items || []).filter((i: any) => i?.Id);
  let downloaded = 0;
  let failed = 0;
  const trackIds: string[] = [];
  // Save track metadata locally
  try {
    await localDb.initialize();
    if (items.length) await localDb.saveTracks(items as any);
  } catch (e) {
    logger.warn("Saving favourites tracks metadata failed", e);
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
        track: t as any,
        skipMetadata: true,
        suppressEvent: true,
      });
      trackIds.push(t.Id);
      downloaded++;
    } catch {
      failed++;
    }
  }
  await localDb.markCollectionDownloaded("favourites", "playlist", name);
  try {
    await localDb.markTracksCached(trackIds);
  } catch {}
  try {
    window.dispatchEvent(new Event("downloadsUpdate"));
  } catch {}
  return { downloaded, failed };
}

export async function removeFavouritesDownloads() {
  await localDb.initialize();
  const auth = JSON.parse(localStorage.getItem("authData") || "{}");
  const { getFavorites } = await import("@/lib/jellyfin");
  const favorites = await getFavorites(auth.serverAddress, auth.accessToken);
  const items = (favorites?.Items || []).filter((i: any) => i?.Id);
  for (const t of items as any[]) {
    try {
      await removeDownload(t.Id);
    } catch {}
  }
  await localDb.unmarkCollectionDownloaded("favourites");
  try {
    window.dispatchEvent(new Event("downloadsUpdate"));
  } catch {}
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

import { Jellyfin } from "@jellyfin/sdk";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { logger } from "./logger";
import { localDb } from "./database";
import { getSystemApi } from "@jellyfin/sdk/lib/utils/api/system-api";
import { getQuickConnectApi } from "@jellyfin/sdk/lib/utils/api/quick-connect-api";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getArtistsApi } from "@jellyfin/sdk/lib/utils/api/artists-api";
import { getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api/user-library-api";
import { getPlaylistsApi } from "@jellyfin/sdk/lib/utils/api/playlists-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import {
  BaseItemKind,
  ItemSortBy,
  SortOrder,
  ItemFields,
  ImageType,
} from "@jellyfin/sdk/lib/generated-client";

// Generate & persist a stable unique device ID per installation
const DEVICE_ID_KEY = "foxyDeviceId";
function getDeviceId() {
  try {
    const storage = typeof localStorage !== "undefined" ? localStorage : null;
    let id = storage?.getItem(DEVICE_ID_KEY) || "";
    if (!id) {
      id = (
        globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
      )
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);
      storage?.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Fallback (non-persistent)
    return "tmp-" + Math.random().toString(36).slice(2);
  }
}

// Create and export jellyfin instance
export const jellyfin = new Jellyfin({
  clientInfo: {
    name: "Foxy",
    version: "1.0.0",
  },
  deviceInfo: {
    name: "Foxy Desktop",
    id: getDeviceId(),
  },
});

// Helper for server validation
export const validateServer = async (address: string) => {
  try {
    const api = jellyfin.createApi(address);
    const response = await getSystemApi(api).getPublicSystemInfo();
    return {
      valid: true,
      name: response.data.ServerName,
      version: response.data.Version,
    };
  } catch (error) {
    return { valid: false };
  }
};

// Authentication helpers
export const authenticate = {
  // Fetch list of public users (reveals which require passwords)
  async getPublicUsers(serverAddress: string) {
    const res = await fetch(`${serverAddress}/Users/Public`);
    if (!res.ok) throw new Error("Failed to fetch users");
    return (await res.json()) as Array<{
      Name?: string;
      Id?: string;
      HasPassword?: boolean;
    }>;
  },

  // Determine if a specific user requires a password
  async userRequiresPassword(serverAddress: string, username: string) {
    try {
      const users = await this.getPublicUsers(serverAddress);
      const user = users.find(
        (u: { Name?: string }) =>
          (u.Name || "").toLowerCase() === username.toLowerCase()
      );
      return !!user?.HasPassword; // false means passwordless login allowed
    } catch {
      // If cannot determine, assume password required to be safe
      return true;
    }
  },

  async quickConnect(serverAddress: string) {
    const api = jellyfin.createApi(serverAddress);
    const quickConnectApi = getQuickConnectApi(api);

    const response = await quickConnectApi.initiateQuickConnect({
      headers: {
        Authorization: api.authorizationHeader,
      },
    });
    if (!response.data.Secret || !response.data.Code) {
      throw new Error("Failed to initiate Quick Connect");
    }

    return {
      code: response.data.Code,
      secret: response.data.Secret,
    };
  },

  async checkQuickConnectStatus(serverAddress: string, secret: string) {
    const api = jellyfin.createApi(serverAddress);
    const quickConnectApi = getQuickConnectApi(api);

    const response = await quickConnectApi.getQuickConnectState(
      { secret },
      {
        headers: {
          Authorization: api.authorizationHeader,
        },
      }
    );
    return response.data;
  },

  async authenticateWithQuickConnect(serverAddress: string, secret: string) {
    const api = jellyfin.createApi(serverAddress);
    const userApi = getUserApi(api);

    const response = await userApi.authenticateWithQuickConnect(
      { quickConnectDto: { Secret: secret } },
      {
        headers: {
          Authorization: api.authorizationHeader,
        },
      }
    );

    if (!response.data.AccessToken) {
      throw new Error("Failed to authenticate with Quick Connect");
    }

    if (!response.data.AccessToken || !response.data.User?.Id) {
      throw new Error("Invalid Quick Connect response");
    }

    return {
      accessToken: response.data.AccessToken,
      userId: response.data.User.Id,
      serverAddress,
    };
  },

  async logout(serverAddress: string, accessToken: string) {
    const api = jellyfin.createApi(serverAddress, accessToken);
    await api.logout();
  },

  // Password is optional: supply empty string when user has no password
  async withCredentials(
    serverAddress: string,
    username: string,
    password?: string
  ) {
    const api = jellyfin.createApi(serverAddress);
    const userApi = getUserApi(api);

    const response = await userApi.authenticateUserByName(
      {
        authenticateUserByName: {
          Username: username,
          Pw: password ?? "", // Jellyfin accepts empty string for passwordless accounts
        },
      },
      {
        headers: {
          Authorization: api.authorizationHeader,
        },
      }
    );

    if (!response.data.AccessToken) {
      throw new Error("Invalid username or password");
    }

    return {
      accessToken: response.data.AccessToken,
      userId: response.data.User?.Id || "",
      serverAddress,
    };
  },

  // Complete Quick Connect flow
  async startQuickConnect(
    serverAddress: string,
    callbacks: {
      onCode: (code: string) => void;
      onSuccess: (authData: any) => void;
      onError: (error: string) => void;
    }
  ) {
    try {
      const { code, secret } = await this.quickConnect(serverAddress);
      callbacks.onCode(code);

      const interval = setInterval(async () => {
        try {
          const status = await this.checkQuickConnectStatus(
            serverAddress,
            secret
          );

          if (status.Authenticated) {
            clearInterval(interval);
            const authData = await this.authenticateWithQuickConnect(
              serverAddress,
              secret
            );
            callbacks.onSuccess(authData);
          }
        } catch (error: any) {
          clearInterval(interval);
          callbacks.onError(`Quick Connect failed: ${error.message}`);
        }
      }, 3000);

      return () => clearInterval(interval);
    } catch (error: any) {
      callbacks.onError(`Failed to start Quick Connect: ${error.message}`);
    }
  },
};

export const getMusicLibraryItems = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const artistsApi = getArtistsApi(api);

  const [itemResponse, artistResponse] = await Promise.all([
    itemsApi.getItems({
      recursive: true,
      includeItemTypes: [
        BaseItemKind.Audio,
        BaseItemKind.MusicAlbum,
        BaseItemKind.Playlist,
      ],
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
      imageTypeLimit: 1,
      enableImageTypes: [ImageType.Primary],
    }),
    artistsApi
      .getArtists({
        recursive: true,
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        fields: [
          ItemFields.PrimaryImageAspectRatio,
          ItemFields.MediaSourceCount,
        ],
        imageTypeLimit: 1,
        enableImageTypes: [ImageType.Primary],
      } as any)
      .catch(() => ({ data: { Items: [] as any[], TotalRecordCount: 0 } })),
  ]);

  const mergedItems = [
    ...(itemResponse.data.Items || []),
    ...(artistResponse.data?.Items || []),
  ];

  const mergedResponse = {
    ...itemResponse.data,
    Items: mergedItems,
  } as any;

  if (
    typeof itemResponse.data.TotalRecordCount === "number" &&
    typeof artistResponse.data?.TotalRecordCount === "number"
  ) {
    mergedResponse.TotalRecordCount =
      itemResponse.data.TotalRecordCount + artistResponse.data.TotalRecordCount;
  }

  return mergedResponse;
};

export const getRecentlyPlayed = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  // Try to get the music library ID for more precise filtering
  let parentId;
  try {
    parentId = await getMusicLibraryId(serverAddress, accessToken);
  } catch (error) {
    logger.warn("Could not get music library ID, using general filter");
  }

  const response = await itemsApi.getItems({
    userId: authData.userId,
    sortBy: [ItemSortBy.DatePlayed],
    sortOrder: [SortOrder.Descending],
    includeItemTypes: [BaseItemKind.Audio],
    limit: 20,
    recursive: true,
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.ParentId],
    filters: ["IsPlayed"],
    ...(parentId && { parentId }), // Only include parentId if we have it
    imageTypeLimit: 1,
    enableImageTypes: [
      ImageType.Primary,
      ImageType.Backdrop,
      ImageType.Banner,
      ImageType.Thumb,
    ],
    enableTotalRecordCount: false,
  });
  return response.data;
};

// New: Recently played albums (derive unique albums from recently played tracks)
export const getRecentlyPlayedAlbums = async (
  serverAddress: string,
  accessToken: string,
  limit: number = 12
) => {
  try {
    const played = await getRecentlyPlayed(serverAddress, accessToken);
    const items = played.Items || [];
    const albumMap = new Map<string, any>();

    for (const track of items) {
      const albumId = track.AlbumId || track.ParentId;
      if (!albumId) continue;
      if (!albumMap.has(albumId)) {
        albumMap.set(albumId, {
          Id: albumId,
          Name: track.Album || track.AlbumPrimaryImageTag || "Unknown Album",
          AlbumArtist:
            (track as any).AlbumArtist ||
            (Array.isArray((track as any).Artists)
              ? (track as any).Artists[0]
              : undefined),
          ImageTags: (track as any).AlbumPrimaryImageTag
            ? { Primary: (track as any).AlbumPrimaryImageTag }
            : (track as any).ImageTags,
          ProductionYear: (track as any).ProductionYear,
        });
      }
      if (albumMap.size >= limit) break;
    }

    return Array.from(albumMap.values());
  } catch (e) {
    logger.error("Failed to get recently played albums", e);
    return [];
  }
};

export const getRecentlyAdded = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  // Try to get the music library ID for more precise filtering
  let parentId;
  try {
    parentId = await getMusicLibraryId(serverAddress, accessToken);
  } catch (error) {
    logger.warn("Could not get music library ID, using general filter");
  }

  const response = await itemsApi.getItems({
    userId: authData.userId,
    sortBy: [ItemSortBy.DateCreated],
    sortOrder: [SortOrder.Descending],
    includeItemTypes: [BaseItemKind.Audio],
    limit: 20,
    recursive: true,
    fields: [ItemFields.PrimaryImageAspectRatio],
    ...(parentId && { parentId }), // Only include parentId if we have it
    imageTypeLimit: 1,
    enableImageTypes: [
      ImageType.Primary,
      ImageType.Backdrop,
      ImageType.Banner,
      ImageType.Thumb,
    ],
    enableTotalRecordCount: false,
  });
  return response.data;
};

export const getFavorites = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await itemsApi.getItems({
    userId: authData.userId,
    filters: ["IsFavorite"],
    recursive: true,
    includeItemTypes: [BaseItemKind.Audio],
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

export const getFavoriteArtists = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const artistsApi = getArtistsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await artistsApi.getArtists({
    userId: authData.userId,
    filters: ["IsFavorite"],
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

export const getFavoritePlaylists = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await itemsApi.getItems({
    userId: authData.userId,
    filters: ["IsFavorite"],
    recursive: true,
    includeItemTypes: [BaseItemKind.Playlist],
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

// Music-specific library functions for the Library page
export const getMusicResumeItems = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await itemsApi.getResumeItems({
    userId: authData.userId,
    limit: 20,
    mediaTypes: ["Audio"],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

export const getMusicRecentlyAdded = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await itemsApi.getItems({
    userId: authData.userId,
    limit: 20,
    includeItemTypes: [BaseItemKind.Audio],
    sortBy: [ItemSortBy.DateCreated],
    sortOrder: [SortOrder.Descending],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

export const getMusicFavorites = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const response = await itemsApi.getItems({
    userId: authData.userId,
    filters: ["IsFavorite"],
    recursive: true,
    includeItemTypes: [BaseItemKind.Audio],
    sortBy: [ItemSortBy.SortName],
    sortOrder: [SortOrder.Ascending],
    fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.MediaSourceCount],
    imageTypeLimit: 1,
    enableImageTypes: [ImageType.Primary],
  });
  return response.data;
};

// Media library helper
export const getMediaLibrary = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const libraryApi = getLibraryApi(api);
  const response = await libraryApi.getMediaFolders();
  return response.data;
};

// Get the music library ID for filtering to music content only
export const getMusicLibraryId = async (
  serverAddress: string,
  accessToken: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const itemsApi = getItemsApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  const response = await itemsApi.getItems({
    userId: authData.userId,
    includeItemTypes: [BaseItemKind.CollectionFolder],
  });

  // Find the music library (usually has CollectionType "music")
  const musicLibrary = response.data.Items?.find(
    (item) => item.CollectionType === "music"
  );

  return musicLibrary?.Id || null;
};

// Function to get audio stream information
export const getAudioStreamInfo = async (
  serverAddress: string,
  accessToken: string,
  itemId: string
) => {
  try {
    const api = jellyfin.createApi(serverAddress, accessToken);
    const itemsApi = getItemsApi(api);

    // Get item details with media sources
    const response = await itemsApi.getItems({
      ids: [itemId],
      fields: [
        ItemFields.MediaSources,
        ItemFields.Path,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
    });

    const item = response.data.Items?.[0];
    if (!item) {
      throw new Error("Item not found");
    }

    // Construct stream URL
    const streamUrl = `${serverAddress}/Audio/${itemId}/stream?static=true&api_key=${accessToken}`;

    return {
      item,
      streamUrl,
      directStreamUrl: item.MediaSources?.[0]?.Path
        ? `${serverAddress}/Videos/${itemId}/stream?static=true&api_key=${accessToken}`
        : null,
    };
  } catch (error) {
    logger.error("Error getting audio stream info:", error);
    throw error;
  }
};

// Get album information
export const getAlbumInfo = async (
  serverAddress: string,
  accessToken: string,
  albumId: string
) => {
  try {
    const api = jellyfin.createApi(serverAddress, accessToken);
    const itemsApi = getItemsApi(api);

    const response = await itemsApi.getItems({
      ids: [albumId],
      fields: [
        ItemFields.Overview,
        ItemFields.Genres,
        ItemFields.DateCreated,
        ItemFields.ChildCount,
      ],
    });

    return response.data.Items?.[0] || null;
  } catch (error) {
    logger.error("Error getting album info:", error);
    throw error;
  }
};

// Loudness normalization metadata (ReplayGain / R128) discovery
export interface NormalizationInfo {
  trackGainDb?: number;
  albumGainDb?: number;
  trackPeak?: number;
  albumPeak?: number;
  r128Track?: number; // LU or dB as provided by server metadata
  r128Album?: number;
}

// Try to extract ReplayGain / R128 info for an item
export const getTrackNormalizationInfo = async (
  serverAddress: string,
  accessToken: string,
  trackId: string
): Promise<NormalizationInfo | null> => {
  try {
    const api = jellyfin.createApi(serverAddress, accessToken);
    const mediaInfoApi = getMediaInfoApi(api);
    const userId = JSON.parse(localStorage.getItem("authData") || "{}").userId;

    const info = await mediaInfoApi.getPlaybackInfo({
      itemId: trackId,
      userId,
    });

    const ms: any = info.data?.MediaSources?.[0] || {};
    const audioStream: any = (ms.MediaStreams || []).find(
      (s: any) => s?.Type === "Audio"
    );

    const out: NormalizationInfo = {};

    const parseNum = (v: any): number | undefined => {
      if (v == null) return undefined;
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string") {
        const m = v.match(/-?\d+(?:\.\d+)?/);
        if (m) return parseFloat(m[0]);
      }
      return undefined;
    };

    const scanObject = (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj)) {
        const key = k.toLowerCase();
        // ReplayGain (commonly stored as strings with ' dB')
        if (key.includes("replay") && key.includes("gain")) {
          const val = parseNum(v);
          if (val == null) continue;
          if (key.includes("track")) out.trackGainDb ??= val;
          else if (key.includes("album")) out.albumGainDb ??= val;
        }
        if (key.includes("replay") && key.includes("peak")) {
          const val = parseNum(v);
          if (val == null) continue;
          if (key.includes("track")) out.trackPeak ??= val;
          else if (key.includes("album")) out.albumPeak ??= val;
        }
        // R128 (EBU) fields
        if (
          key.includes("r128") &&
          key.includes("track") &&
          (key.includes("gain") || key.includes("loud") || key.includes("lu"))
        ) {
          const val = parseNum(v);
          if (val != null) out.r128Track ??= val;
        }
        if (
          key.includes("r128") &&
          key.includes("album") &&
          (key.includes("gain") || key.includes("loud") || key.includes("lu"))
        ) {
          const val = parseNum(v);
          if (val != null) out.r128Album ??= val;
        }
      }
    };

    scanObject(ms);
    scanObject(audioStream);

    // Also scan nested 'Tags' or 'TagItems' if present
    const tags = (ms as any).Tags || (ms as any).TagItems || [];
    if (Array.isArray(tags)) {
      for (const t of tags) scanObject(t);
    }

    // If we didn't find anything, return null so callers can fallback
    const hasAny =
      out.trackGainDb != null ||
      out.albumGainDb != null ||
      out.trackPeak != null ||
      out.albumPeak != null ||
      out.r128Track != null ||
      out.r128Album != null;
    return hasAny ? out : null;
  } catch (e) {
    logger.info("No normalization metadata available for track", e);
    return null;
  }
};

// Get album tracks/items
export const getAlbumItems = async (
  serverAddress: string,
  accessToken: string,
  albumId: string
) => {
  try {
    const api = jellyfin.createApi(serverAddress, accessToken);
    const itemsApi = getItemsApi(api);
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");

    const response = await itemsApi.getItems({
      userId: authData.userId,
      parentId: albumId,
      includeItemTypes: [BaseItemKind.Audio],
      recursive: true,
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      fields: [
        ItemFields.MediaSources,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
      enableUserData: true,
    });

    return response.data;
  } catch (error) {
    logger.error("Error getting album items:", error);
    throw error;
  }
};

export const searchItems = async (
  searchTerm: string,
  includeItemTypes: BaseItemKind[] = []
) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);
    const artistsApi = getArtistsApi(api);

    const wantsArtists =
      includeItemTypes.length === 0 ||
      includeItemTypes.includes(BaseItemKind.MusicArtist);
    const nonArtistTypes = includeItemTypes.filter(
      (type) => type !== BaseItemKind.MusicArtist
    );

    const itemQuery: any = {
      userId: authData.userId,
      searchTerm,
      recursive: true,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
        ItemFields.Overview,
      ],
      limit: 200,
    };

    if (nonArtistTypes.length) {
      itemQuery.includeItemTypes = nonArtistTypes;
    }

    const itemsPromise =
      includeItemTypes.length === 0 || nonArtistTypes.length
        ? itemsApi
            .getItems(itemQuery)
            .then((res) => res.data.Items || [])
            .catch(() => [] as any[])
        : Promise.resolve([] as any[]);

    const artistPromise = wantsArtists
      ? artistsApi
          .getArtists({
            userId: authData.userId,
            searchTerm,
            fields: [
              ItemFields.PrimaryImageAspectRatio,
              ItemFields.MediaSourceCount,
              ItemFields.Path,
              ItemFields.Genres,
              ItemFields.DateCreated,
              ItemFields.Overview,
            ],
            limit: 200,
            enableTotalRecordCount: false,
          } as any)
          .then((res) => res.data.Items || [])
          .catch(() => [] as any[])
      : Promise.resolve([] as any[]);

    const [itemResults, artistResults] = await Promise.all([
      itemsPromise,
      artistPromise,
    ]);

    const merged = [...itemResults, ...artistResults];
    const seen = new Set<string>();
    const deduped: any[] = [];

    for (const entry of merged) {
      const id = entry?.Id;
      if (id && seen.has(id)) {
        continue;
      }
      if (id) {
        seen.add(id);
      }
      deduped.push(entry);
    }

    return deduped;
  } catch (error) {
    logger.error("Error searching items:", error);
    throw error;
  }
};

// Fetch multiple items by IDs with optional fields
export const getItemsByIds = async (
  ids: string[],
  fields: ItemFields[] = [
    ItemFields.MediaSources,
    ItemFields.Genres,
    ItemFields.DateCreated,
    ItemFields.Path,
    ItemFields.PrimaryImageAspectRatio,
  ]
) => {
  if (!ids.length) return [] as any[];
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("No authentication data found");
    }
    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);
    const response = await itemsApi.getItems({ ids, fields });
    return response.data.Items || [];
  } catch (error) {
    logger.error("Error getting items by ids:", error);
    return [] as any[];
  }
};

export const getItemsUserDataMap = async (
  ids: string[]
): Promise<Record<string, boolean>> => {
  const result: Record<string, boolean> = {};
  if (!ids.length) return result;

  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("No authentication data found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      try {
        const response = await (itemsApi.getItems as any)({
          userId: authData.userId,
          ids: chunk,
          enableUserData: true,
          enableTotalRecordCount: false,
        });

        const items = (response?.data?.Items || []) as any[];
        for (const item of items) {
          if (item?.Id) {
            result[item.Id] = Boolean(item?.UserData?.IsFavorite);
          }
        }
      } catch (error) {
        logger.warn("Failed to fetch user data chunk", error);
      }
    }
  } catch (error) {
    logger.warn("Failed to fetch user data map", error);
  }

  return result;
};

// Enhanced search function that searches multiple categories
export const searchAllItems = async (
  searchTerm: string,
  options: { forceRemote?: boolean } = {}
) => {
  const { forceRemote = false } = options;

  const dedupe = (items: BaseItemDto[]): BaseItemDto[] => {
    const seen = new Map<string, BaseItemDto>();
    for (const item of items) {
      const id = item?.Id;
      if (!id) continue;
      if (!seen.has(id)) {
        seen.set(id, item);
      }
    }
    return Array.from(seen.values());
  };

  if (!forceRemote) {
    try {
      await localDb.initialize();
      const [artists, albums, tracks, playlists] = await Promise.all([
        localDb.searchArtists(searchTerm),
        localDb.searchAlbums(searchTerm),
        localDb.searchTracks(searchTerm),
        localDb.searchPlaylists(searchTerm),
      ]);

      const localCombined = dedupe([
        ...artists,
        ...albums,
        ...tracks,
        ...playlists,
      ]);

      if (localCombined.length) {
        return localCombined;
      }
    } catch (error) {
      logger.warn("Local search failed, falling back to server", error);
    }
  }

  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);
    const artistsApi = getArtistsApi(api);

    const [artistSearch, generalSearch] = await Promise.all([
      artistsApi
        .getArtists({
          userId: authData.userId,
          searchTerm,
          fields: [
            ItemFields.PrimaryImageAspectRatio,
            ItemFields.Overview,
            ItemFields.Genres,
          ],
          limit: 300,
          enableTotalRecordCount: false,
        } as any)
        .catch(() => ({ data: { Items: [] as any[] } })),
      itemsApi
        .getItems({
          userId: authData.userId,
          searchTerm,
          includeItemTypes: [
            BaseItemKind.MusicAlbum,
            BaseItemKind.Audio,
            BaseItemKind.Playlist,
          ],
          recursive: true,
          fields: [
            ItemFields.PrimaryImageAspectRatio,
            ItemFields.Overview,
            ItemFields.Genres,
            ItemFields.MediaSourceCount,
          ],
          limit: 300,
          enableTotalRecordCount: false,
        })
        .catch(() => ({ data: { Items: [] as any[] } })),
    ]);

    let allResults = [
      ...(artistSearch.data.Items || []),
      ...(generalSearch.data.Items || []),
    ] as BaseItemDto[];

    if (allResults.length < 10) {
      const [artistResults, albumResults, songResults, playlistResults] =
        await Promise.all([
          artistsApi
            .getArtists({
              userId: authData.userId,
              searchTerm,
              fields: [
                ItemFields.PrimaryImageAspectRatio,
                ItemFields.Overview,
                ItemFields.Genres,
              ],
              limit: 50,
              enableTotalRecordCount: false,
            } as any)
            .catch(() => ({ data: { Items: [] as any[] } })),
          itemsApi
            .getItems({
              userId: authData.userId,
              searchTerm,
              includeItemTypes: [BaseItemKind.MusicAlbum],
              recursive: true,
              fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.Genres],
              limit: 100,
              enableTotalRecordCount: false,
            })
            .catch(() => ({ data: { Items: [] as any[] } })),
          itemsApi
            .getItems({
              userId: authData.userId,
              searchTerm,
              includeItemTypes: [BaseItemKind.Audio],
              recursive: true,
              fields: [
                ItemFields.PrimaryImageAspectRatio,
                ItemFields.MediaSourceCount,
              ],
              limit: 100,
              enableTotalRecordCount: false,
            })
            .catch(() => ({ data: { Items: [] as any[] } })),
          itemsApi
            .getItems({
              userId: authData.userId,
              searchTerm,
              includeItemTypes: [BaseItemKind.Playlist],
              recursive: true,
              fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.Overview],
              limit: 50,
              enableTotalRecordCount: false,
            })
            .catch(() => ({ data: { Items: [] as any[] } })),
        ]);

      allResults = [
        ...(artistResults.data.Items || []),
        ...(albumResults.data.Items || []),
        ...(songResults.data.Items || []),
        ...(playlistResults.data.Items || []),
      ] as BaseItemDto[];
    }

    const deduped = dedupe(allResults);

    if (deduped.length) {
      try {
        await localDb.initialize();
        const artists = deduped.filter((item) => item.Type === "MusicArtist");
        const albums = deduped.filter((item) => item.Type === "MusicAlbum");
        const tracks = deduped.filter((item) => item.Type === "Audio");
        const playlists = deduped.filter((item) => item.Type === "Playlist");

        if (artists.length) {
          await localDb.saveArtists(artists);
        }
        if (albums.length) {
          await localDb.saveAlbums(albums);
        }
        if (tracks.length) {
          await localDb.saveTracks(tracks);
        }
        if (playlists.length) {
          await localDb.savePlaylists(playlists);
        }
      } catch (persistError) {
        logger.warn("Failed to persist remote search results", persistError);
      }
    }

    return deduped;
  } catch (error) {
    logger.error("Error searching all items:", error);
    throw error;
  }
};

// Enhanced search that includes related content for artists
export const searchWithRelatedContent = async (
  searchTerm: string,
  options: { forceRemote?: boolean } = {}
) => {
  try {
    logger.info(`Searching for: "${searchTerm}"`);

    // First get all basic search results
    const basicResults = await searchAllItems(searchTerm, options);
    logger.info(
      `Basic search returned ${basicResults.length} results:`,
      basicResults.map((r) => `${r.Type}: ${r.Name}`)
    );

    // Find any matching artists
    const matchingArtists = basicResults.filter(
      (item) => item.Type === "MusicArtist"
    );
    logger.info(
      `Found ${matchingArtists.length} matching artists:`,
      matchingArtists.map((a) => a.Name)
    );

    // For each artist found, get their albums (prefer local, fallback to server)
    const artistAlbums = [];
    for (const artist of matchingArtists) {
      try {
        let albums: BaseItemDto[] = [];
        try {
          await localDb.initialize();
          albums = await localDb.getAlbumsByArtistId(artist.Id!);
        } catch (dbError) {
          logger.warn(
            `Failed to read albums for ${artist.Name} from local database`,
            dbError
          );
        }

        if (!albums.length) {
          const shouldForceRemote = options.forceRemote === true;
          if (shouldForceRemote) {
            albums = await getAlbumsByArtistId(artist.Id!);
          } else {
            try {
              albums = await getAlbumsByArtistId(artist.Id!);
            } catch (remoteError) {
              logger.warn(
                `Failed remote album fetch for artist ${artist.Name}:`,
                remoteError
              );
              albums = [];
            }
          }

          if (albums.length) {
            try {
              await localDb.initialize();
              await localDb.saveAlbums(albums);
            } catch (persistError) {
              logger.warn(
                `Failed to persist albums for ${artist.Name} after remote fetch`,
                persistError
              );
            }
          }
        }

        if (albums.length) {
          logger.info(
            `Albums for ${artist.Name}:`,
            albums.map((a) => a.Name)
          );
          artistAlbums.push(...albums);
        }
      } catch (error) {
        logger.warn(`Failed to get albums for artist ${artist.Name}:`, error);
      }
    }

    // Combine basic results with artist albums, removing duplicates
    const allResults = [...basicResults];

    // Add artist albums that aren't already in results
    for (const album of artistAlbums) {
      if (!allResults.some((result) => result.Id === album.Id)) {
        allResults.push(album);
      }
    }

    logger.info(`Final results: ${allResults.length} items`);
    return allResults;
  } catch (error) {
    logger.error("Error in enhanced search:", error);
    // Fallback to basic search
    return await searchAllItems(searchTerm, options);
  }
};

// Get albums by artist ID
export const getAlbumsByArtistId = async (artistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const response = await itemsApi.getItems({
      userId: authData.userId,
      artistIds: [artistId],
      includeItemTypes: [BaseItemKind.MusicAlbum],
      recursive: true,
      fields: [ItemFields.PrimaryImageAspectRatio, ItemFields.Genres],
      sortBy: [ItemSortBy.ProductionYear, ItemSortBy.SortName],
      sortOrder: [SortOrder.Descending],
    });

    return response.data.Items || [];
  } catch (error) {
    logger.error("Error getting albums by artist:", error);
    throw error;
  }
};

export const getArtistInfo = async (artistId: string) => {
  let localArtist: BaseItemDto | null = null;
  let dbReady = false;

  try {
    await localDb.initialize();
    dbReady = true;
    localArtist = await localDb.getArtistById(artistId);
    const hasOverview =
      typeof localArtist?.Overview === "string" &&
      localArtist.Overview.trim().length > 0;
    if (localArtist && hasOverview) {
      return localArtist;
    }
  } catch (dbError) {
    logger.warn("Failed to read artist from local database", dbError);
  }

  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const artistsApi = getArtistsApi(api);

    const response = await artistsApi.getArtists({
      userId: authData.userId,
      parentId: artistId,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
        ItemFields.Overview,
        ItemFields.ChildCount,
        ItemFields.ItemCounts,
      ],
      enableUserData: true,
      enableTotalRecordCount: false,
    } as any);

    const remoteArtist = (response.data.Items || [])[0] || null;
    if (remoteArtist) {
      if (!dbReady) {
        try {
          await localDb.initialize();
          dbReady = true;
        } catch (reInitError) {
          logger.warn(
            "Failed to re-initialize local database before persisting artist",
            reInitError
          );
        }
      }

      if (dbReady) {
        try {
          await localDb.saveArtists([remoteArtist as BaseItemDto]);
        } catch (persistError) {
          logger.warn("Failed to persist artist info locally", persistError);
        }
      }

      return remoteArtist;
    }

    return localArtist;
  } catch (error) {
    if (localArtist) {
      logger.warn(
        "Falling back to cached artist info after remote fetch failure",
        error
      );
      return localArtist;
    }

    logger.error("Error getting artist info:", error);
    throw error;
  }
};

export const getArtistAlbums = async (artistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const response = await itemsApi.getItems({
      userId: authData.userId,
      albumArtistIds: [artistId],
      includeItemTypes: [BaseItemKind.MusicAlbum],
      recursive: true,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
      sortBy: [ItemSortBy.ProductionYear, ItemSortBy.SortName],
      sortOrder: [SortOrder.Descending],
    });

    return response.data.Items || [];
  } catch (error) {
    logger.error("Error getting artist albums:", error);
    throw error;
  }
};

export const getArtistTracks = async (artistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const response = await itemsApi.getItems({
      userId: authData.userId,
      albumArtistIds: [artistId],
      includeItemTypes: [BaseItemKind.Audio],
      recursive: true,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
      sortBy: [ItemSortBy.PlayCount, ItemSortBy.SortName],
      sortOrder: [SortOrder.Descending],
      limit: 50,
    });

    return response.data.Items || [];
  } catch (error) {
    logger.error("Error getting artist tracks:", error);
    throw error;
  }
};

// Fetch all tracks for an artist (no limit, paginated)
export const getAllTracksByArtist = async (artistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const pageSize = 500;
    let startIndex = 0;
    let total = Infinity as number;
    let allItems: any[] = [];

    while (startIndex < total) {
      const response = await itemsApi.getItems({
        userId: authData.userId,
        albumArtistIds: [artistId],
        includeItemTypes: [BaseItemKind.Audio],
        recursive: true,
        fields: [
          ItemFields.PrimaryImageAspectRatio,
          ItemFields.MediaSourceCount,
          ItemFields.Path,
          ItemFields.Genres,
          ItemFields.DateCreated,
        ],
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        startIndex,
        limit: pageSize,
        enableTotalRecordCount: true,
      });

      const batch = response.data.Items || [];
      allItems = allItems.concat(batch);

      const totalRecordCount = response.data.TotalRecordCount;
      if (typeof totalRecordCount === "number") {
        total = totalRecordCount;
      } else if (batch.length < pageSize) {
        total = startIndex + batch.length;
      }

      if (batch.length === 0) break;
      startIndex += batch.length;
    }

    return allItems;
  } catch (error) {
    logger.error("Error getting all artist tracks:", error);
    throw error;
  }
};

export const findArtistByName = async (artistName: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const artistsApi = getArtistsApi(api);

    const normalized = artistName.trim();
    const lower = normalized.toLowerCase();

    // Strategy: fetch a larger pool when commas present (compound names)
    const response = await artistsApi.getArtists({
      userId: authData.userId,
      searchTerm: normalized.includes(",")
        ? normalized.split(",")[0].trim()
        : normalized,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
      limit: normalized.includes(",") ? 100 : 25,
    });

    const items = (response.data.Items || []).filter((i: any) => i?.Name);
    if (!items.length) return null;

    // First: exact (case-insensitive) match on full name
    const exact = items.find(
      (i: any) => (i.Name || "").toLowerCase() === lower
    );
    if (exact) return exact;

    // Second: if compound (with comma), try exact on each segment trimmed
    if (normalized.includes(",")) {
      const segments = normalized
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const seg of segments) {
        const segLower = seg.toLowerCase();
        const segExact = items.find(
          (i: any) => (i.Name || "").toLowerCase() === segLower
        );
        if (segExact) return segExact;
      }
    }

    // Third: startsWith
    const starts = items.find((i: any) =>
      (i.Name || "").toLowerCase().startsWith(lower)
    );
    if (starts) return starts;

    // Fourth: includes
    const includes = items.find((i: any) =>
      (i.Name || "").toLowerCase().includes(lower)
    );
    if (includes) return includes;

    return items[0] || null;
  } catch (error) {
    logger.error("Error finding artist by name:", error);
    throw error;
  }
};

export const findAlbumByName = async (
  albumName: string,
  artistName?: string
) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const response = await itemsApi.getItems({
      userId: authData.userId,
      searchTerm: albumName,
      includeItemTypes: [BaseItemKind.MusicAlbum],
      recursive: true,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.Genres,
        ItemFields.DateCreated,
      ],
      limit: 10, // Get more results to find the best match
    });

    const albums = response.data.Items || [];

    // If artist name is provided, try to find a more specific match
    if (artistName && albums.length > 1) {
      const exactMatch = albums.find(
        (album) =>
          album.AlbumArtist === artistName ||
          album.Artists?.includes(artistName)
      );
      if (exactMatch) {
        return exactMatch;
      }
    }

    return albums[0] || null;
  } catch (error) {
    logger.error("Error finding album by name:", error);
    throw error;
  }
};

export const getAllArtists = async () => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const artistsApi = getArtistsApi(api);

    const pageSize = 500; // reasonable page size

    const fetchPage = async (startIndex: number) => {
      const batchStart = performance.now?.() || Date.now();
      const response = await artistsApi.getArtists({
        userId: authData.userId,
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        fields: [
          ItemFields.PrimaryImageAspectRatio,
          ItemFields.MediaSourceCount,
          ItemFields.Path,
          ItemFields.Genres,
          ItemFields.DateCreated,
          ItemFields.Overview,
          ItemFields.ChildCount,
          ItemFields.ItemCounts,
        ],
        startIndex,
        limit: pageSize,
        enableTotalRecordCount: true,
        enableUserData: true,
      });
      const batchTime = (performance.now?.() || Date.now()) - batchStart;
      const batch = response.data.Items || [];

      const withAlbumCount = batch.filter(
        (a: any) => typeof a.AlbumCount === "number" && a.AlbumCount > 0
      ).length;
      const withChildCount = batch.filter(
        (a: any) => typeof a.ChildCount === "number" && a.ChildCount > 0
      ).length;
      const withItemCounts = batch.filter(
        (a: any) =>
          a.ItemCounts &&
          (a.ItemCounts.AlbumCount > 0 || a.ItemCounts.SongCount > 0)
      ).length;

      logger.info(
        `Artists pagination: startIndex=${startIndex} fetched=${
          batch.length
        } batchTime=${batchTime.toFixed(
          1
        )}ms albumCount>0:${withAlbumCount} childCount>0:${withChildCount} itemCountsAvail:${withItemCounts}`
      );

      return {
        items: batch,
        total: response.data.TotalRecordCount,
      };
    };

    const firstPage = await fetchPage(0);
    const allItems: any[] = [...firstPage.items];
    const firstTotal = firstPage.total;

    if (typeof firstTotal !== "number") {
      let startIndex = firstPage.items.length;
      while (true) {
        const page = await fetchPage(startIndex);
        const batch = page.items;
        if (!batch.length) break;
        allItems.push(...batch);
        startIndex += batch.length;
        if (batch.length < pageSize) break;
        if (typeof page.total === "number" && startIndex >= page.total) {
          break;
        }
      }
      return allItems;
    }

    const total = firstTotal;
    const remainingStarts: number[] = [];
    for (let start = pageSize; start < total; start += pageSize) {
      remainingStarts.push(start);
    }

    if (!remainingStarts.length) {
      return allItems;
    }

    const hardwareConcurrencyRaw = (globalThis as any)?.navigator?.hardwareConcurrency;
    const hardwareConcurrency =
      typeof hardwareConcurrencyRaw === "number" && hardwareConcurrencyRaw > 0
        ? hardwareConcurrencyRaw
        : 4;
    const maxWorkers = Math.min(8, Math.max(2, Math.floor(hardwareConcurrency / 2)));
    const workerCount = Math.min(maxWorkers, remainingStarts.length);

    const pageResults = new Map<number, any[]>();
    let nextIndex = 0;

    const worker = async () => {
      for (
        let idx = nextIndex++;
        idx < remainingStarts.length;
        idx = nextIndex++
      ) {
        const startIndex = remainingStarts[idx];
        try {
          const page = await fetchPage(startIndex);
          if (page.items.length) {
            pageResults.set(startIndex, page.items);
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch artist page starting at ${startIndex}`,
            error
          );
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));

    for (const startIndex of remainingStarts.sort((a, b) => a - b)) {
      const batch = pageResults.get(startIndex);
      if (batch?.length) {
        allItems.push(...batch);
      }
    }

    return allItems;
  } catch (error) {
    logger.error("Error getting all artists:", error);
    throw error;
  }
};

// Get all albums from the server
export const getAllAlbums = async () => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const pageSize = 500;
    const fetchPage = async (startIndex: number) => {
      const pageStart = performance.now?.() || Date.now();
      const response = await itemsApi.getItems({
        userId: authData.userId,
        includeItemTypes: [BaseItemKind.MusicAlbum],
        recursive: true,
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        fields: [
          ItemFields.PrimaryImageAspectRatio,
          ItemFields.MediaSourceCount,
          ItemFields.Path,
          ItemFields.Genres,
          ItemFields.DateCreated,
          ItemFields.Overview,
        ],
        enableUserData: true,
        startIndex,
        limit: pageSize,
        enableTotalRecordCount: true,
      });
      const pageTime = (performance.now?.() || Date.now()) - pageStart;
      const batch = response.data.Items || [];

      logger.info(
        `Albums pagination: startIndex=${startIndex} fetched=${batch.length} duration=${pageTime.toFixed(
          1
        )}ms`
      );

      return {
        items: batch,
        total: response.data.TotalRecordCount,
      };
    };

    const firstPage = await fetchPage(0);
    const allItems = [...firstPage.items];
    const firstTotal = firstPage.total;

    if (typeof firstTotal !== "number") {
      // Fall back to sequential pagination when the server doesn't return totals
      let startIndex = firstPage.items.length;
      let keepFetching = true;
      while (keepFetching) {
        const page = await fetchPage(startIndex);
        const batchLength = page.items.length;
        if (!batchLength) {
          break;
        }
        allItems.push(...page.items);
        startIndex += batchLength;
        const reachedReportedTotal =
          typeof page.total === "number" && startIndex >= page.total;
        keepFetching =
          !reachedReportedTotal && batchLength === pageSize;
      }

      return allItems;
    }

    const total = firstTotal;
    const remainingStarts: number[] = [];
    const pageResults = new Map<number, any[]>();
    for (let start = pageSize; start < total; start += pageSize) {
      remainingStarts.push(start);
    }

    if (!remainingStarts.length) {
      return allItems;
    }

    const hardwareConcurrencyRaw = (globalThis as any)?.navigator?.
      hardwareConcurrency;
    const hardwareConcurrency =
      typeof hardwareConcurrencyRaw === "number" &&
      hardwareConcurrencyRaw > 0
        ? hardwareConcurrencyRaw
        : 4;
    const maxWorkers = Math.min(8, Math.max(2, Math.floor(hardwareConcurrency / 2)));
    const workerCount = Math.min(maxWorkers, remainingStarts.length);

    let nextIndex = 0;
    const worker = async () => {
      let idx = nextIndex++;
      while (idx < remainingStarts.length) {
        const startIndex = remainingStarts[idx];
        try {
          const page = await fetchPage(startIndex);
          if (page.items.length) {
            pageResults.set(startIndex, page.items);
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch album page starting at ${startIndex}`,
            error
          );
        }
        idx = nextIndex++;
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));

    for (const startIndex of remainingStarts.sort((a, b) => a - b)) {
      const batch = pageResults.get(startIndex);
      if (batch && batch.length) {
        allItems.push(...batch);
      }
    }

    return allItems;
  } catch (error) {
    logger.error("Error getting all albums:", error);
    throw error;
  }
};

// Get all playlists from the server
export const getAllPlaylists = async () => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken || !authData.userId) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const itemsApi = getItemsApi(api);

    const pageSize = 500;

    const fetchPage = async (startIndex: number) => {
      const pageStart = performance.now?.() || Date.now();
      const response = await itemsApi.getItems({
        userId: authData.userId,
        includeItemTypes: [BaseItemKind.Playlist],
        recursive: true,
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        fields: [
          ItemFields.PrimaryImageAspectRatio,
          ItemFields.MediaSourceCount,
          ItemFields.Path,
          ItemFields.Genres,
          ItemFields.DateCreated,
          ItemFields.Overview,
        ],
        enableUserData: true,
        startIndex,
        limit: pageSize,
        enableTotalRecordCount: true,
      });
      const duration = (performance.now?.() || Date.now()) - pageStart;
      const batch = response.data.Items || [];

      logger.info(
        `Playlists pagination: startIndex=${startIndex} fetched=${batch.length} duration=${duration.toFixed(
          1
        )}ms`
      );

      return {
        items: batch,
        total: response.data.TotalRecordCount,
      };
    };

    const firstPage = await fetchPage(0);
    const allItems = [...firstPage.items];
    const firstTotal = firstPage.total;

    if (typeof firstTotal !== "number") {
      let startIndex = firstPage.items.length;
      while (true) {
        const page = await fetchPage(startIndex);
        const batch = page.items;
        if (!batch.length) break;
        allItems.push(...batch);
        startIndex += batch.length;
        if (batch.length < pageSize) break;
        if (typeof page.total === "number" && startIndex >= page.total) {
          break;
        }
      }
      return allItems;
    }

    const total = firstTotal;
    const remainingStarts: number[] = [];
    for (let start = pageSize; start < total; start += pageSize) {
      remainingStarts.push(start);
    }

    if (!remainingStarts.length) {
      return allItems;
    }

    const hardwareConcurrencyRaw = (globalThis as any)?.navigator?.hardwareConcurrency;
    const hardwareConcurrency =
      typeof hardwareConcurrencyRaw === "number" && hardwareConcurrencyRaw > 0
        ? hardwareConcurrencyRaw
        : 4;
    const maxWorkers = Math.min(6, Math.max(2, Math.floor(hardwareConcurrency / 2)));
    const workerCount = Math.min(maxWorkers, remainingStarts.length);

    const pageResults = new Map<number, any[]>();
    let nextIndex = 0;

    const worker = async () => {
      for (
        let idx = nextIndex++;
        idx < remainingStarts.length;
        idx = nextIndex++
      ) {
        const startIndex = remainingStarts[idx];
        try {
          const page = await fetchPage(startIndex);
          if (page.items.length) {
            pageResults.set(startIndex, page.items);
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch playlist page starting at ${startIndex}`,
            error
          );
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, worker));

    for (const startIndex of remainingStarts.sort((a, b) => a - b)) {
      const batch = pageResults.get(startIndex);
      if (batch?.length) {
        allItems.push(...batch);
      }
    }

    return allItems;
  } catch (error) {
    logger.error("Error getting all playlists:", error);
    throw error;
  }
};

// Create a new playlist
export const createPlaylist = async (name: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const playlistsApi = getPlaylistsApi(api);

    const response = await playlistsApi.createPlaylist({
      createPlaylistDto: {
        Name: name,
        Ids: [], // Start with empty playlist
        UserId: authData.userId,
        MediaType: "Audio",
      },
    });

    return response.data;
  } catch (error) {
    logger.error("Error creating playlist:", error);
    throw error;
  }
};

// Add a track to an existing playlist
export const addTrackToPlaylist = async (
  playlistId: string,
  trackId: string
) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const playlistsApi = getPlaylistsApi(api);

    const response = await playlistsApi.addItemToPlaylist({
      playlistId: playlistId,
      ids: [trackId],
      userId: authData.userId,
    });

    return response.data;
  } catch (error) {
    logger.error("Error adding track to playlist:", error);
    throw error;
  }
};

// Add multiple tracks to an existing playlist
export const addItemsToPlaylist = async (
  playlistId: string,
  trackIds: string[]
) => {
  try {
    if (!Array.isArray(trackIds) || trackIds.length === 0) return;
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const playlistsApi = getPlaylistsApi(api);

    const response = await playlistsApi.addItemToPlaylist({
      playlistId,
      ids: trackIds,
      userId: authData.userId,
    });

    return response.data;
  } catch (error) {
    logger.error("Error adding items to playlist:", error);
    throw error;
  }
};

// Remove one or more tracks from an existing playlist
export const removeItemsFromPlaylist = async (
  playlistId: string,
  entryIds: string[]
) => {
  try {
    if (!Array.isArray(entryIds) || entryIds.length === 0) return;
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    const server = authData.serverAddress;
    const token = authData.accessToken;
    if (!server || !token) throw new Error("No authentication data found");

    // DELETE /Playlists/{playlistId}/Items?EntryIds=... (entry IDs, not item IDs)
    const params = new URLSearchParams();
    params.set("EntryIds", entryIds.join(","));
    params.set("api_key", token);
    const url = `${server}/Playlists/${playlistId}/Items?${params.toString()}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `MediaBrowser Token=\"${token}\"`,
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to remove items from playlist: ${res.status}`);
    }
    return true;
  } catch (error) {
    logger.error("Error removing items from playlist:", error);
    throw error;
  }
};

// Add multiple tracks to an existing playlist
export const addTracksToPlaylist = async (
  playlistId: string,
  trackIds: string[]
) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const playlistsApi = getPlaylistsApi(api);

    const response = await playlistsApi.addItemToPlaylist({
      playlistId: playlistId,
      ids: trackIds,
      userId: authData.userId,
    });

    return response.data;
  } catch (error) {
    logger.error("Error adding tracks to playlist:", error);
    throw error;
  }
};

// Get current user information
export const getCurrentUser = async () => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const userApi = getUserApi(api);

    const response = await userApi.getCurrentUser();

    return response.data;
  } catch (error) {
    logger.error("Error getting current user:", error);
    throw error;
  }
};

// Get server information
export const getServerInfo = async () => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("Authentication data not found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const systemApi = getSystemApi(api);

    const response = await systemApi.getPublicSystemInfo();

    return response.data;
  } catch (error) {
    logger.error("Error getting server info:", error);
    throw error;
  }
};

// Favorite/Unfavorite functions
export const addToFavorites = async (
  serverAddress: string,
  accessToken: string,
  itemId: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const userLibraryApi = getUserLibraryApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  const response = await userLibraryApi.markFavoriteItem({
    userId: authData.userId,
    itemId: itemId,
  });
  return response.data;
};

export const removeFromFavorites = async (
  serverAddress: string,
  accessToken: string,
  itemId: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const userLibraryApi = getUserLibraryApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  const response = await userLibraryApi.unmarkFavoriteItem({
    userId: authData.userId,
    itemId: itemId,
  });
  return response.data;
};

export const checkIsFavorite = async (
  serverAddress: string,
  accessToken: string,
  itemId: string
) => {
  const api = jellyfin.createApi(serverAddress, accessToken);
  const userLibraryApi = getUserLibraryApi(api);
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");

  const response = await userLibraryApi.getItem({
    userId: authData.userId,
    itemId: itemId,
  });

  return response.data.UserData?.IsFavorite || false;
};

// Get playlist information
export const getPlaylistInfo = async (playlistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("No authentication data found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const userLibraryApi = getUserLibraryApi(api);

    const response = await userLibraryApi.getItem({
      userId: authData.userId,
      itemId: playlistId,
    });

    return response.data;
  } catch (error) {
    logger.error("Error getting playlist info:", error);
    throw error;
  }
};

// Get playlist items/tracks
export const getPlaylistItems = async (playlistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("No authentication data found");
    }

    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    const playlistsApi = getPlaylistsApi(api);

    const response = await playlistsApi.getPlaylistItems({
      playlistId: playlistId,
      userId: authData.userId,
      fields: [
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.MediaSourceCount,
        ItemFields.Path,
        ItemFields.ParentId,
        ItemFields.People,
        ItemFields.SortName,
        ItemFields.Studios,
        ItemFields.DateCreated,
        ItemFields.Genres,
        ItemFields.MediaStreams,
        ItemFields.Overview,
        ItemFields.ProviderIds,
        ItemFields.Tags,
      ],
    });

    return response.data.Items || [];
  } catch (error) {
    logger.error("Error getting playlist items:", error);
    throw error;
  }
};

// Delete a playlist
export const deletePlaylist = async (playlistId: string) => {
  try {
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("No authentication data found");
    }
    const api = jellyfin.createApi(
      authData.serverAddress,
      authData.accessToken
    );
    // Direct REST call fallback because SDK lacks typed delete for playlist in some versions
    const res = await fetch(
      `${authData.serverAddress}/Items/${playlistId}?api_key=${authData.accessToken}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `MediaBrowser Token=\"${authData.accessToken}\"`,
        },
      }
    );
    if (!res.ok) {
      throw new Error(`Failed to delete playlist: ${res.status}`);
    }
    return true;
  } catch (error) {
    logger.error("Error deleting playlist:", error);
    throw error;
  }
};

// Playback reporting helpers
export const reportPlaybackStart = async (
  serverAddress: string,
  accessToken: string,
  itemId: string,
  positionTicks: number = 0
) => {
  try {
    await fetch(`${serverAddress}/Sessions/Playing`, {
      method: "POST",
      headers: {
        Authorization: `MediaBrowser Token=\"${accessToken}\"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ItemId: itemId,
        PositionTicks: Math.floor(positionTicks),
        PlaybackRate: 1,
        IsPaused: false,
      }),
    });
  } catch (e) {
    logger.warn("reportPlaybackStart failed", e);
  }
};

export const reportPlaybackProgress = async (
  serverAddress: string,
  accessToken: string,
  itemId: string,
  positionSeconds: number,
  isPaused: boolean,
  durationSeconds?: number
) => {
  try {
    await fetch(`${serverAddress}/Sessions/Playing/Progress`, {
      method: "POST",
      headers: {
        Authorization: `MediaBrowser Token=\"${accessToken}\"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ItemId: itemId,
        PositionTicks: Math.floor(positionSeconds * 10_000_000),
        RunTimeTicks: durationSeconds
          ? Math.floor(durationSeconds * 10_000_000)
          : undefined,
        IsPaused: isPaused,
        PlaybackRate: 1,
      }),
    });
  } catch (e) {
    // Avoid spamming console
  }
};

export const reportPlaybackStopped = async (
  serverAddress: string,
  accessToken: string,
  itemId: string,
  positionSeconds: number
) => {
  try {
    await fetch(`${serverAddress}/Sessions/Playing/Stopped`, {
      method: "POST",
      headers: {
        Authorization: `MediaBrowser Token=\"${accessToken}\"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ItemId: itemId,
        PositionTicks: Math.floor(positionSeconds * 10_000_000),
      }),
    });
  } catch (e) {
    logger.warn("reportPlaybackStopped failed", e);
  }
};

// Lyrics interfaces
export interface LyricLine {
  start: number; // Start time in seconds
  text: string;
}

export interface Lyrics {
  trackId: string;
  lyrics: LyricLine[];
  isTimeSynced: boolean;
}

// Get lyrics for a track
export const getTrackLyrics = async (
  serverAddress: string,
  accessToken: string,
  trackId: string
): Promise<Lyrics | null> => {
  try {
    const api = jellyfin.createApi(serverAddress, accessToken);
    const mediaInfoApi = getMediaInfoApi(api);

    // First, try to get lyrics from the lyrics endpoint (may return JSON array, JSON object, or raw text)
    try {
      const response = await fetch(
        `${serverAddress}/Audio/${trackId}/Lyrics?api_key=${accessToken}`,
        {
          headers: {
            Authorization: `MediaBrowser Token="${accessToken}"`,
          },
        }
      );

      if (response.ok) {
        // Try JSON first, fallback to raw text (LRC)
        let data: any = null;
        let rawText: string | null = null;
        const textBody = await response.text();
        try {
          data = JSON.parse(textBody);
        } catch {
          rawText = textBody;
        }

        // Case 1: Jellyfin JSON with Lyrics array [{ Text, Start }] (Start in ticks)
        if (data && Array.isArray(data.Lyrics)) {
          const parsed = parseJsonArrayLyrics(data.Lyrics);
          return {
            trackId,
            lyrics: parsed.lyrics,
            isTimeSynced: parsed.isTimeSynced,
          };
        }
        // Case 2: Jellyfin JSON with Lyrics string (embedded LRC)
        if (data && typeof data.Lyrics === "string") {
          const parsed = parseLyricsString(data.Lyrics);
          return {
            trackId,
            lyrics: parsed.lyrics,
            isTimeSynced: parsed.isTimeSynced,
          };
        }
        // Case 3: Raw LRC/plain text
        if (rawText) {
          const parsed = parseLyricsString(rawText);
          return {
            trackId,
            lyrics: parsed.lyrics,
            isTimeSynced: parsed.isTimeSynced,
          };
        }
      }
    } catch (error) {
      logger.info(
        "Primary lyrics fetch failed, trying alternative methods",
        error
      );
    }

    // Fallback: embedded subtitle/metadata scan
    try {
      const mediaInfo = await mediaInfoApi.getPlaybackInfo({
        itemId: trackId,
        userId: JSON.parse(localStorage.getItem("authData") || "{}").userId,
      });

      const mediaStreams = mediaInfo.data?.MediaSources?.[0]?.MediaStreams;
      if (mediaStreams) {
        for (const stream of mediaStreams) {
          if (stream.Type === "Subtitle") {
            const subtitleResponse = await fetch(
              `${serverAddress}/Videos/${trackId}/${stream.Index}/Subtitles/0/Stream.srt?api_key=${accessToken}`,
              {
                headers: {
                  Authorization: `MediaBrowser Token="${accessToken}"`,
                },
              }
            );
            if (subtitleResponse.ok) {
              const subtitleText = await subtitleResponse.text();
              const parsedLyrics = parseSRTLyrics(subtitleText);
              if (parsedLyrics.lyrics.length > 0) {
                return {
                  trackId,
                  lyrics: parsedLyrics.lyrics,
                  isTimeSynced: parsedLyrics.isTimeSynced,
                };
              }
            }
          }
        }
      }
    } catch (error) {
      logger.info("No embedded lyrics found");
    }

    return null;
  } catch (error) {
    logger.error("Error fetching lyrics:", error);
    return null;
  }
};

// Parse LRC / plain text lyrics string
const parseLyricsString = (
  lyricsText: string
): { lyrics: LyricLine[]; isTimeSynced: boolean } => {
  const lines = lyricsText.split("\n");
  const lyrics: LyricLine[] = [];
  let isTimeSynced = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const lrcMatch = trimmedLine.match(
      /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/
    );
    if (lrcMatch) {
      const minutes = parseInt(lrcMatch[1]);
      const seconds = parseInt(lrcMatch[2]);
      const milliseconds = lrcMatch[3]
        ? parseInt(lrcMatch[3].padEnd(3, "0"))
        : 0;
      const text = lrcMatch[4];
      const startTime = minutes * 60 + seconds + milliseconds / 1000;
      lyrics.push({ start: startTime, text });
      isTimeSynced = true;
    } else {
      lyrics.push({ start: 0, text: trimmedLine });
    }
  }

  if (!isTimeSynced && lyrics.length === 0) {
    const plainLines = lyricsText.split("\n").filter((line) => line.trim());
    plainLines.forEach((line) => {
      lyrics.push({ start: 0, text: line.trim() });
    });
  }

  return { lyrics, isTimeSynced };
};

// Parse Jellyfin JSON Lyrics array (Start usually in ticks: 10,000,000 per second)
const parseJsonArrayLyrics = (
  arr: { Text?: string; Start?: number }[]
): { lyrics: LyricLine[]; isTimeSynced: boolean } => {
  const lyrics: LyricLine[] = [];
  for (const line of arr) {
    if (line.Text === undefined) continue;
    let startSeconds = 0;
    if (typeof line.Start === "number") {
      // Heuristic: if large value assume ticks
      startSeconds =
        line.Start > 1000000 ? line.Start / 10000000 : line.Start / 1000; // fallback if ms
    }
    lyrics.push({ start: startSeconds, text: line.Text || "" });
  }
  const timed = lyrics.some((l) => l.start > 0);
  return { lyrics, isTimeSynced: timed };
};

// Parse SRT subtitle text into lyrics (restored after refactor)
const parseSRTLyrics = (
  srtText: string
): { lyrics: LyricLine[]; isTimeSynced: boolean } => {
  const lyrics: LyricLine[] = [];
  const blocks = srtText.split(/\r?\n\r?\n/);
  let isTimeSynced = false;
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length >= 2) {
      const timeMatch = lines[1].match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
      );
      if (timeMatch) {
        const startHours = parseInt(timeMatch[1]);
        const startMinutes = parseInt(timeMatch[2]);
        const startSeconds = parseInt(timeMatch[3]);
        const startMilliseconds = parseInt(timeMatch[4]);
        const startTime =
          startHours * 3600 +
          startMinutes * 60 +
          startSeconds +
          startMilliseconds / 1000;
        const text = lines.slice(2).join(" ").trim();
        lyrics.push({ start: startTime, text });
        isTimeSynced = true;
      }
    }
  }
  return { lyrics, isTimeSynced };
};

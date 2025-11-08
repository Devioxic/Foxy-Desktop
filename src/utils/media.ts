interface Item {
  Id?: string;
  ImageTags?: { Primary?: string | null };
  PrimaryImageTag?: string | null;
  LocalImages?: { Primary?: string | null };
}

const getStoredAccessToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage?.getItem("authData");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return typeof parsed?.accessToken === "string"
      ? (parsed.accessToken as string)
      : undefined;
  } catch {
    return undefined;
  }
};

export const resolvePrimaryImageUrl = (options: {
  item?: Item | null;
  serverAddress?: string;
  accessToken?: string;
  size?: number;
  fallbackId?: string;
  fallback?: string | null;
}): string | null => {
  const {
    item,
    serverAddress,
    accessToken,
    size = 300,
    fallbackId,
    fallback = null,
  } = options;

  const localSrc = (item as any)?.LocalImages?.Primary;
  if (typeof localSrc === "string" && localSrc.length > 0) {
    return localSrc;
  }

  const itemId =
    fallbackId ||
    item?.Id ||
    (item as any)?.ItemId ||
    (item as any)?.AlbumId ||
    (item as any)?.CollectionId;

  if (!serverAddress || !itemId) {
    return fallback;
  }

  const imageTag =
    item?.ImageTags?.Primary ||
    item?.PrimaryImageTag ||
    (item as any)?.AlbumPrimaryImageTag ||
    null;

  const params = new URLSearchParams();
  params.set("maxWidth", String(size));
  params.set("quality", "90");
  if (imageTag) params.set("tag", imageTag);
  const token = accessToken ?? getStoredAccessToken();
  if (token) params.set("api_key", token);

  return `${serverAddress}/Items/${itemId}/Images/Primary?${params.toString()}`;
};

export const getImageUrl = (
  item: Item | null,
  serverAddress: string,
  size: number = 300,
  fallback?: string
): string | null => {
  return (
    resolvePrimaryImageUrl({
      item,
      serverAddress,
      size,
      fallback: fallback ?? null,
    }) ||
    fallback ||
    null
  );
};

// Build an image URL directly from an item id when you don't have ImageTags
export const getItemImageUrl = (
  itemId: string | undefined,
  serverAddress: string | undefined,
  size: number = 300,
  type: string = "Primary",
  fallback: string = "/placeholder.svg"
): string => {
  if (!itemId || !serverAddress) return fallback;
  return `${serverAddress}/Items/${itemId}/Images/${type}?maxWidth=${size}&quality=90`;
};

// Format Jellyfin RunTimeTicks (100-ns ticks) to human-readable time
// Examples: 65s -> 1:05, 1h 2m 3s -> 1:02:03
export const formatDuration = (ticks?: number): string => {
  if (!ticks) return "";
  const totalSeconds = Math.floor(ticks / 10_000_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${Math.floor(totalSeconds / 60)}:${seconds
    .toString()
    .padStart(2, "0")}`;
};

export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

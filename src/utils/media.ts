interface Item {
  Id?: string;
  ImageTags?: { Primary?: string };
}

export const getImageUrl = (
  item: Item | null,
  serverAddress: string,
  size: number = 300,
  fallback?: string
): string | null => {
  if (item?.ImageTags?.Primary && serverAddress && item.Id) {
    return `${serverAddress}/Items/${item.Id}/Images/Primary?maxWidth=${size}&quality=90`;
  }
  return fallback || null;
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

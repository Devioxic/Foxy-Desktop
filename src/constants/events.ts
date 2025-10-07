export const APP_EVENTS = {
  syncUpdate: "syncUpdate",
  favoriteStateChanged: "favoriteStateChanged",
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

export interface FavoriteStateChangedDetail {
  trackId: string;
  isFavorite: boolean;
}

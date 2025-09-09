// App-wide constants
export const APP_CONFIG = {
  name: "Foxy",
  version: "1.8.0",
  defaultImageSize: 300,
  thumbnailSize: 150,
  maxInitialTracks: 5,
} as const;

export const STORAGE_KEYS = {
  authData: "authData",
} as const;

export const ROUTES = {
  home: "/home",
  library: "/library",
  search: "/search",
  server: "/server",
  login: "/login",
} as const;

export const NAVIGATION_ITEMS = {
  main: [
    { id: "home", label: "Home", route: ROUTES.home },
    { id: "library", label: "Library", route: ROUTES.library },
    { id: "search", label: "Search", route: ROUTES.search },
  ],
  browse: [
    { label: "Artists" },
    { label: "Albums" },
    { label: "Playlists" },
    { label: "Favourite Songs" },
  ],
} as const;

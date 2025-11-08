import React, { Suspense } from "react";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { MusicProvider } from "@/contexts/MusicContext";
import { useAuthData } from "@/hooks/useAuthData";
import { useSyncInitialization, useAutoSync } from "@/hooks/useSync";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import OfflineMode from "@/components/OfflineMode";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import SettingsPageComponent from "@/pages/SettingsPage";
import { Toaster } from "sonner"; // Global toast renderer
import { ThemeProvider } from "next-themes";
import {
  OfflineModeProvider,
  useOfflineModeContext,
} from "@/contexts/OfflineModeContext";

// Lazy load components
const ServerAddressPage = React.lazy(() => import("@/pages/ServerAddressPage"));
const LoginPage = React.lazy(() => import("@/pages/LoginPage"));
const Home = React.lazy(() => import("@/pages/Home"));
const SearchPage = React.lazy(() => import("@/pages/SearchPage"));
const Library = React.lazy(() => import("@/pages/Library"));
const Artists = React.lazy(() => import("@/pages/Artists"));
const Albums = React.lazy(() => import("@/pages/Albums"));
const Playlists = React.lazy(() => import("@/pages/Playlists"));
const Downloads = React.lazy(() => import("./pages/Downloads"));
const DownloadedSongs = React.lazy(() => import("./pages/DownloadedSongs"));
const AlbumView = React.lazy(() => import("@/pages/AlbumView"));
const ArtistView = React.lazy(() => import("@/pages/ArtistView"));
const PlaylistView = React.lazy(() => import("@/pages/PlaylistView"));
const FavouritePlaylistView = React.lazy(
  () => import("@/pages/FavouritePlaylistView")
);
const Favourites = React.lazy(() => import("@/pages/Favourites"));
const SettingsPage = React.lazy(async () => ({
  default: SettingsPageComponent,
}));
const NotFound = React.lazy(() => import("@/pages/NotFound"));

const LoadingFallback = () => (
  <div className="space-y-4">
    <div className="h-8 w-64 animate-shimmer rounded" />
    <div className="h-4 w-48 animate-shimmer rounded" />
  </div>
);

const LayoutFallback: React.FC<{ activeSection: string; type: any }> = ({
  activeSection,
  type,
}) => (
  <div className="min-h-screen bg-background">
    <Sidebar activeSection={activeSection} />
    <div className="ml-64 pb-28 p-6">
      <LoadingSkeleton type={type} />
    </div>
    <MusicPlayer />
  </div>
);

type OfflineGuardProps = {
  allowOffline?: boolean;
  title?: string;
  message?: string;
  showDownloadsButton?: boolean;
  activeSection?: string;
  renderContent: () => React.ReactNode;
};

const OfflineGuard: React.FC<OfflineGuardProps> = ({
  allowOffline = false,
  title,
  message,
  showDownloadsButton = true,
  activeSection,
  renderContent,
}) => {
  const { isOffline, simulateOffline } = useOfflineModeContext();
  const isOfflineActive = isOffline || simulateOffline;

  if (isOfflineActive && !allowOffline) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar activeSection={activeSection} />
        <div className="ml-64 p-6 pb-28">
          <OfflineMode
            title={title ?? "Offline Mode Active"}
            message={
              message ??
              "This section isn't available while the server is offline. Check your downloads to enjoy your offline library."
            }
            showDownloadsButton={showDownloadsButton}
          />
        </div>
        <MusicPlayer />
      </div>
    );
  }

  return <>{renderContent()}</>;
};

type LayoutFallbackOptions = React.ComponentProps<typeof LayoutFallback>;
type OfflineGuardOptions = Omit<OfflineGuardProps, "renderContent">;

const isDynamicImportError = (error?: Error) => {
  if (!error) return false;
  const message = error.message || "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed")
  );
};

const OfflineRouteFallback: React.FC<OfflineGuardOptions> = ({
  title,
  message,
  showDownloadsButton = true,
  activeSection,
  allowOffline,
}) => (
  <div className="min-h-screen bg-background">
    <Sidebar activeSection={activeSection} />
    <div className="ml-64 p-6 pb-28">
      <OfflineMode
        title={title ?? "Offline Mode Active"}
        message={
          message ??
          (allowOffline
            ? "This section is taking a moment to load."
            : "This section isn't available while the server is offline. Check your downloads to enjoy your offline library.")
        }
        showDownloadsButton={showDownloadsButton}
      />
    </div>
    <MusicPlayer />
  </div>
);

interface RouteErrorFallbackProps {
  error?: Error;
  resetError: () => void;
  offlineOptions?: OfflineGuardOptions;
}

const RouteErrorFallback: React.FC<RouteErrorFallbackProps> = ({
  error,
  resetError,
  offlineOptions,
}) => {
  if (isDynamicImportError(error)) {
    return <OfflineRouteFallback {...(offlineOptions ?? {})} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Something went wrong
        </h2>
        <p className="text-gray-600 mb-6">
          An unexpected error occurred. Please try again.
        </p>
        <div className="space-x-4">
          <Button onClick={resetError} variant="outline">
            Try Again
          </Button>
          <Button onClick={() => window.location.reload()}>Refresh Page</Button>
        </div>
        {error && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              Error Details
            </summary>
            <pre className="mt-2 text-xs text-gray-600 bg-gray-100 p-3 rounded overflow-auto">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

type RenderLazyRouteOptions = {
  layoutFallback?: LayoutFallbackOptions;
  fallback?: React.ReactNode;
  offline?: OfflineGuardOptions;
};

const renderLazyRoute = (
  Component: React.LazyExoticComponent<React.ComponentType<unknown>>,
  { layoutFallback, fallback, offline }: RenderLazyRouteOptions = {}
) => {
  const RouteWrapper: React.FC = () => {
    const { isOffline, simulateOffline } = useOfflineModeContext();
    const isOfflineActive = isOffline || simulateOffline;

    const suspenseFallback = layoutFallback ? (
      <LayoutFallback {...layoutFallback} />
    ) : (
      (fallback ?? <LoadingFallback />)
    );

    const renderLazyContent = () => (
      <Suspense fallback={suspenseFallback}>
        <Component />
      </Suspense>
    );

    if (offline && isOfflineActive && !offline.allowOffline) {
      return <OfflineRouteFallback {...offline} />;
    }

    return (
      <ErrorBoundary
        fallback={({ error, resetError }) => (
          <RouteErrorFallback
            error={error}
            resetError={resetError}
            offlineOptions={offline}
          />
        )}
      >
        {offline ? (
          <OfflineGuard {...offline} renderContent={renderLazyContent} />
        ) : (
          renderLazyContent()
        )}
      </ErrorBoundary>
    );
  };

  return <RouteWrapper />;
};

const AppContent = () => {
  const { isAuthenticated } = useAuthData();

  // Initialize sync system when user is authenticated
  const { isInitializing, error: syncError } = useSyncInitialization();

  // Enable auto-sync for background updates
  useAutoSync();

  const shouldUseHash =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" || !!window.electronAPI);
  const RouterComponent = shouldUseHash ? HashRouter : BrowserRouter;

  return (
    <RouterComponent>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              isAuthenticated() ? (
                <Navigate to="/home" replace />
              ) : (
                <Navigate to="/server" replace />
              )
            }
          />
          <Route path="/server" element={renderLazyRoute(ServerAddressPage)} />
          <Route path="/login" element={renderLazyRoute(LoginPage)} />
          <Route
            path="/home"
            element={renderLazyRoute(Home, {
              layoutFallback: { activeSection: "home", type: "home" },
              offline: {
                title: "Home is unavailable offline",
                activeSection: "home",
              },
            })}
          />
          <Route
            path="/search"
            element={renderLazyRoute(SearchPage, {
              layoutFallback: { activeSection: "search", type: "home" },
              offline: {
                title: "Search is unavailable offline",
                activeSection: "search",
              },
            })}
          />
          <Route
            path="/library"
            element={renderLazyRoute(Library, {
              layoutFallback: { activeSection: "library", type: "library" },
              offline: {
                title: "Library is unavailable offline",
                activeSection: "library",
              },
            })}
          />
          <Route
            path="/artists"
            element={renderLazyRoute(Artists, {
              layoutFallback: { activeSection: "artists", type: "artists" },
              offline: {
                title: "Artists are unavailable offline",
                activeSection: "artists",
              },
            })}
          />
          <Route
            path="/albums"
            element={renderLazyRoute(Albums, {
              layoutFallback: { activeSection: "albums", type: "albums" },
              offline: {
                title: "Albums are unavailable offline",
                activeSection: "albums",
              },
            })}
          />
          <Route
            path="/playlists"
            element={renderLazyRoute(Playlists, {
              layoutFallback: {
                activeSection: "playlists",
                type: "playlists",
              },
              offline: {
                title: "Playlists are unavailable offline",
                activeSection: "playlists",
              },
            })}
          />
          <Route
            path="/downloads"
            element={renderLazyRoute(Downloads, {
              layoutFallback: {
                activeSection: "downloads",
                type: "library",
              },
              offline: { allowOffline: true, activeSection: "downloads" },
            })}
          />
          <Route
            path="/downloads/songs"
            element={renderLazyRoute(DownloadedSongs, {
              layoutFallback: {
                activeSection: "downloads",
                type: "library",
              },
              offline: { allowOffline: true, activeSection: "downloads" },
            })}
          />
          <Route
            path="/album/:albumId"
            element={renderLazyRoute(AlbumView, {
              layoutFallback: {
                activeSection: "albums",
                type: "albumDetail",
              },
              offline: {
                title: "Albums are unavailable offline",
                message:
                  "Connect to your Jellyfin server to view album details.",
                activeSection: "albums",
              },
            })}
          />
          <Route
            path="/artist/:artistId"
            element={renderLazyRoute(ArtistView, {
              layoutFallback: {
                activeSection: "artists",
                type: "artist",
              },
              offline: {
                title: "Artists are unavailable offline",
                message:
                  "Connect to your Jellyfin server to explore artist details.",
                activeSection: "artists",
              },
            })}
          />
          <Route
            path="/playlist/favourites"
            element={renderLazyRoute(FavouritePlaylistView, {
              layoutFallback: {
                activeSection: "favourites",
                type: "playlist",
              },
            })}
          />
          <Route
            path="/playlist/:playlistId"
            element={renderLazyRoute(PlaylistView, {
              layoutFallback: {
                activeSection: "playlists",
                type: "playlist",
              },
              offline: {
                title: "Playlists are unavailable offline",
                message:
                  "Playlist details require a connection to your Jellyfin server.",
                activeSection: "playlists",
              },
            })}
          />
          <Route
            path="/favourites"
            element={renderLazyRoute(Favourites, {
              layoutFallback: {
                activeSection: "favourites",
                type: "albums",
              },
              offline: {
                title: "Favourites are unavailable offline",
                activeSection: "favourites",
              },
            })}
          />
          <Route
            path="/settings"
            element={renderLazyRoute(SettingsPage, {
              fallback: <LoadingFallback />,
              offline: {
                allowOffline: true,
                showDownloadsButton: false,
                activeSection: "settings",
              },
            })}
          />
          <Route path="*" element={renderLazyRoute(NotFound)} />
        </Routes>
      </ErrorBoundary>
    </RouterComponent>
  );
};

const App = () => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <OfflineModeProvider>
        <MusicProvider>
          <AppContent />
          {/* Global Toaster for notifications */}
          <Toaster richColors closeButton />
        </MusicProvider>
      </OfflineModeProvider>
    </ThemeProvider>
  );
};

export default App;

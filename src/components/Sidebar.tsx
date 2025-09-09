import React, { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import UserProfile from "@/components/UserProfile";
import {
  Home,
  Users,
  Disc3,
  ListMusic,
  Star,
  Search,
  Download,
} from "lucide-react";

interface SidebarProps {
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}

const Sidebar: React.FC<SidebarProps> = React.memo(
  ({ activeSection, onSectionChange }) => {
    const navigate = useNavigate();
    const location = useLocation();

    // Determine active section from URL if not provided
    const currentActiveSection = useMemo(() => {
      if (activeSection) return activeSection;

      const path = location.pathname;
      if (path === "/home" || path === "/dashboard") return "home";
      if (path === "/library") return "library";
      if (path === "/search") return "search";
      if (path === "/artists" || path.startsWith("/artist/")) return "artists";
      if (path === "/albums" || path.startsWith("/album/")) return "albums";
      if (path === "/playlist/favourites") return "favourites";
      if (path === "/playlists" || path.startsWith("/playlist/"))
        return "playlists";
      if (path.includes("favourite")) return "favourites";
      if (path === "/downloads") return "downloads";
      return "home";
    }, [activeSection, location.pathname]);

    const handleSectionClick = (sectionId: string) => {
      if (onSectionChange) {
        onSectionChange(sectionId);
      }

      // Navigate to the appropriate page
      if (sectionId === "home") navigate("/home");
      if (sectionId === "search") navigate("/search");
      if (sectionId === "library") navigate("/library");
      if (sectionId === "artists") navigate("/artists");
      if (sectionId === "albums") navigate("/albums");
      if (sectionId === "playlists") navigate("/playlists");
      if (sectionId === "favourites") {
        navigate("/favourites");
      }
      if (sectionId === "downloads") navigate("/downloads");
    };

    const navigationItems = useMemo(
      () => [
        { id: "home", icon: Home, label: "Home" },
        { id: "search", icon: Search, label: "Search" },
        { id: "artists", icon: Users, label: "Artists" },
        { id: "albums", icon: Disc3, label: "Albums" },
        { id: "playlists", icon: ListMusic, label: "Playlists" },
        { id: "favourites", icon: Star, label: "Favourite Albums" },
        { id: "downloads", icon: Download, label: "Downloads" },
      ],
      []
    );

    return (
      <div className="fixed left-0 top-0 w-64 h-full bg-card border-r border-border z-40 flex flex-col">
        <div className="p-6 flex-1 overflow-y-auto">
          {/* Logo and Branding */}
          <div className="flex items-center space-x-3 mb-8">
            <img src="./Foxy.svg" alt="Foxy" className="w-8 h-8" />
            <h1 className="text-xl font-bold text-card-foreground">Foxy</h1>
          </div>

          {/* Navigation */}
          <nav className="space-y-2">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSectionClick(item.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  currentActiveSection === item.id
                    ? "bg-primary/10 text-primary"
                    : "text-card-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* User Profile */}
        <div className="border-t border-border">
          <UserProfile />
        </div>
      </div>
    );
  }
);

export default Sidebar;

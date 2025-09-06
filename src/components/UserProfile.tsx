import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Settings, User } from "lucide-react";
import { getCurrentUser, getServerInfo } from "@/lib/jellyfin";
import SyncStatusIndicator from "@/components/SyncStatusIndicator";

const UserProfile = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      const cached = localStorage.getItem("userProfile.cache");
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [serverInfo, setServerInfo] = useState<any>(() => {
    try {
      const cached = localStorage.getItem("serverInfo.cache");
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [authData] = useState(() =>
    JSON.parse(localStorage.getItem("authData") || "{}")
  );

  useEffect(() => {
    loadUserInfo();
  }, []);

  const loadUserInfo = async () => {
    try {
      const [user, server] = await Promise.all([
        getCurrentUser().catch((_e): null => null),
        getServerInfo().catch((_e): null => null),
      ]);
      if (user) {
        setCurrentUser(user);
        try {
          localStorage.setItem("userProfile.cache", JSON.stringify(user));
        } catch {}
      }
      if (server) {
        setServerInfo(server);
        try {
          localStorage.setItem("serverInfo.cache", JSON.stringify(server));
        } catch {}
      }
    } catch (error) {
      logger.error("Failed to load user info", error);
    }
  };

  const handleSettingsClick = () => {
    navigate("/settings");
  };

  return (
    <div className="p-4 h-20 bg-white">
      <div className="flex items-center space-x-3">
        <Avatar className="w-12 h-12">
          {currentUser?.PrimaryImageTag ? (
            <AvatarImage
              src={`${authData.serverAddress}/Users/${currentUser.Id}/Images/Primary?maxWidth=128&quality=90`}
              alt={currentUser.Name || "User"}
            />
          ) : null}
          <AvatarFallback className="bg-pink-100 text-pink-700">
            {currentUser?.Name?.charAt(0)?.toUpperCase() || (
              <User className="w-4 h-4" />
            )}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {currentUser?.Name || "User"}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {serverInfo?.ServerName || authData.serverAddress}
          </p>
        </div>
        <div className="flex items-center space-x-1">
          <SyncStatusIndicator className="mr-1" />
          <Button
            variant="ghost"
            size="sm"
            className="p-1"
            onClick={handleSettingsClick}
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;

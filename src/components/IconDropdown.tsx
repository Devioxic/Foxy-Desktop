import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

interface IconDropdownProps {
  children: React.ReactNode;
  disabled?: boolean;
  size?: "sm" | "xs";
  tooltip?: string;
  align?: "start" | "end" | "center";
  sideOffset?: number;
  className?: string;
  menuWidthClass?: string; // new prop
}

const IconDropdown: React.FC<IconDropdownProps> = ({
  children,
  disabled = false,
  size = "sm",
  tooltip = "More actions",
  align = "end",
  sideOffset = 5,
  className = "",
  menuWidthClass = "w-52",
}) => {
  const iconClasses = size === "xs" ? "w-4 h-4" : "w-5 h-5";
  const padding = size === "xs" ? "p-1.5" : "p-2";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size === "xs" ? "sm" : "sm"}
          disabled={disabled}
          title={tooltip}
          className={`${padding} text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className={iconClasses} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={`w-52 rounded-md border border-gray-200 bg-white p-1 shadow-lg`}
        sideOffset={sideOffset}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default IconDropdown;

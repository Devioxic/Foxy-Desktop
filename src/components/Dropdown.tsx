import * as React from "react";
import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Reusable dropdown component for simple action menus.
 *
 * Usage:
 * <Dropdown
 *   trigger={<Button variant="ghost" size="sm">⋯</Button>}
 *   actions=[
 *     { label: "Add to Queue", onSelect: handleAdd, icon: <ListMusic size={14}/> },
 *     { separator: true },
 *     { label: "Delete", destructive: true, onSelect: handleDelete, shortcut: "⌘⌫" }
 *   ]
 * />
 */
export interface DropdownAction {
  id?: string;
  /** Set to true to render a visual separator */
  separator?: boolean;
  label?: string; // optional when separator
  icon?: React.ReactNode;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface DropdownProps {
  trigger: React.ReactNode;
  /** List of actions & separators in the order they should appear */
  actions: DropdownAction[];
  /** Called when the open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Control open state externally */
  open?: boolean;
  /** Alignment of the menu relative to trigger */
  align?: RadixDropdown.DropdownMenuContentProps["align"];
  /** Side offset in pixels */
  sideOffset?: number;
  /** Additional className for the content container */
  className?: string;
  /** Optional label at top of menu */
  label?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  actions,
  onOpenChange,
  open,
  align = "end",
  sideOffset = 4,
  className,
  label,
}) => {
  return (
    <RadixDropdown.Root open={open} onOpenChange={onOpenChange}>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 rounded-md border bg-background p-1 shadow-md focus:outline-none animate-in fade-in-0 zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          className
        )}
      >
        {label ? (
          <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ) : null}
        {actions.map((a, i) => {
          if (a.separator) {
            return (
              <RadixDropdown.Separator
                key={a.id || `sep-${i}`}
                className="my-1 h-px bg-border"
              />
            );
          }
          if (!a.label) return null; // skip invalid
          return (
            <RadixDropdown.Item
              key={a.id || a.label || i}
              disabled={a.disabled}
              onSelect={(e) => {
                // Allow menu to close (no preventDefault) but stop propagation so parent row handlers don't fire
                e.stopPropagation();
                if (a.disabled) return;
                a.onSelect?.();
              }}
              className={cn(
                "group flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                "focus:bg-accent focus:text-accent-foreground",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                a.destructive &&
                  "text-destructive focus:bg-destructive/10 focus:text-destructive"
              )}
            >
              {a.icon && (
                <span className="flex h-4 w-4 items-center justify-center text-muted-foreground group-focus:text-inherit">
                  {a.icon}
                </span>
              )}
              <span className="flex-1 text-left">{a.label}</span>
              {a.shortcut && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {a.shortcut}
                </span>
              )}
            </RadixDropdown.Item>
          );
        })}
      </RadixDropdown.Content>
    </RadixDropdown.Root>
  );
};

// Low-level exports (optional) if consumers need more control
export const DropdownRoot = RadixDropdown.Root;
export const DropdownTrigger = RadixDropdown.Trigger;
export const DropdownContent = RadixDropdown.Content;
export const DropdownItem = RadixDropdown.Item;
export const DropdownSeparator = RadixDropdown.Separator;
export const DropdownLabel = RadixDropdown.Label;

export default Dropdown;

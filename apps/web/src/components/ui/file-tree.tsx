"use client";

// AI Elements File Tree (https://ui.shadcn.com/docs/ai-elements/base/file-tree),
// added from its registry and adapted for Selah: monochrome icons, logical
// (RTL-safe) spacing, a chevron that flips in Arabic, the shared motion tokens,
// folders that open on a click anywhere on their row, and an optional meta
// slot at the end of a row.

import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export function FileTree({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const next = new Set(expandedPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [expandedPaths, onExpandedChange],
  );

  const value = useMemo(() => ({ expandedPaths, onSelect, selectedPath, togglePath }), [expandedPaths, onSelect, selectedPath, togglePath]);

  return (
    <FileTreeContext.Provider value={value}>
      <div className={cn("text-sm", className)} role="tree" {...props}>
        {children}
      </div>
    </FileTreeContext.Provider>
  );
}

export function FileTreeIcon({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("flex shrink-0 text-muted-foreground [&_svg]:size-4", className)} {...props}>
      {children}
    </span>
  );
}

export function FileTreeName({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("min-w-0 truncate", className)} {...props}>
      {children}
    </span>
  );
}

const row =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-start outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type FileTreeFolderProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  path: string;
  name: ReactNode;
  /** Shown at the end of the row (a count, a badge). */
  meta?: ReactNode;
  icon?: ReactNode;
};

export function FileTreeFolder({ path, name, meta, icon, className, children, ...props }: FileTreeFolderProps) {
  const { expandedPaths, togglePath } = useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  return (
    <Collapsible open={isExpanded} onOpenChange={() => togglePath(path)}>
      <div role="treeitem" aria-expanded={isExpanded} aria-selected={false} className={className} {...props}>
        <CollapsibleTrigger className={row}>
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-base) ease-(--ease-out-soft) rtl:-scale-x-100",
              isExpanded && "rotate-90 rtl:-rotate-90",
            )}
          />
          <FileTreeIcon>{icon ?? (isExpanded ? <FolderOpenIcon /> : <FolderIcon />)}</FileTreeIcon>
          <FileTreeName className="font-medium">{name}</FileTreeName>
          {meta ? <span className="ms-auto flex shrink-0 items-center gap-1 ps-2">{meta}</span> : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div role="group" className="ms-4 border-s ps-2">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export type FileTreeFileProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  path: string;
  name: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
};

export function FileTreeFile({ path, name, icon, meta, disabled, className, ...props }: FileTreeFileProps) {
  const { selectedPath, onSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  const select = () => onSelect?.(path);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select();
    }
  };
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      tabIndex={0}
      onClick={select}
      onKeyDown={onKeyDown}
      className={cn(row, "cursor-pointer", isSelected && "bg-accent font-medium", disabled && "text-muted-foreground", className)}
      {...props}
    >
      <span className="size-4 shrink-0" />
      <FileTreeIcon>{icon ?? <FileIcon />}</FileTreeIcon>
      <FileTreeName>{name}</FileTreeName>
      {meta ? <span className="ms-auto flex shrink-0 items-center gap-1 ps-2">{meta}</span> : null}
    </div>
  );
}

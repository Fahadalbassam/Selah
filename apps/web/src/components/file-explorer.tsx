"use client";

import { FileArchive, FileImage, FileSpreadsheet, FileText, FileType, GripVertical, Lock, Search, Users } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Download } from "@/components/animate-ui/icons/download";
import { Folder } from "@/components/animate-ui/icons/folder";
import { FolderOpen } from "@/components/animate-ui/icons/folder-open";
import { Upload } from "@/components/animate-ui/icons/upload";
import { X } from "@/components/animate-ui/icons/x";
import { BrandLoader } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ui/file-tree";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCEPTED_EXTENSIONS } from "@/lib/upload-rules";
import type { FileEntry, uploadTargets } from "@/services/files";

// The file explorer: every file the person can already open in Selah, from
// GET /api/files (the database, checked per file on the server). It opens
// from the sidebar as a floating card that can be moved around the screen,
// and the evidence dialog embeds it to reuse a file instead of uploading it
// again.

type SourceKind = FileEntry["source"]["kind"];
const SOURCE_ORDER: SourceKind[] = ["evidence", "deliverable", "client_document", "meeting", "assessment"];

/** The sidebar entry: an animated folder that opens the floating Files card. */
export function FilesSidebarItem({ orgKind, side }: { orgKind: "firm" | "client"; side: "left" | "right" }) {
  const t = useTranslations("files");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          ref={trigger}
          tooltip={t("title")}
          isActive={open}
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls="files-card"
        >
          {open ? <FolderOpen animate /> : <Folder animateOnHover />}
          <span>{t("title")}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      {open ? <FloatingFiles orgKind={orgKind} side={side} onClose={close} /> : null}
    </SidebarMenu>
  );
}

const POSITION_KEY = "selah.files.position";
const MARGIN = 16;
const STEP = 16;

interface Point {
  x: number;
  y: number;
}

function readPosition(): Point | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    const p = raw ? (JSON.parse(raw) as Point) : null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

function savePosition(p: Point) {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(p));
  } catch {
    // A private window or blocked storage: the card just opens in its default spot next time.
  }
}

/** Keep the whole card on screen. */
function clamp(p: Point, card: HTMLElement): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - card.offsetWidth - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - card.offsetHeight - MARGIN);
  return { x: Math.min(Math.max(p.x, MARGIN), maxX), y: Math.min(Math.max(p.y, MARGIN), maxY) };
}

/**
 * The Files card. Not modal: the page stays usable behind it. Drag it by its
 * header, or focus the header and move it with the arrow keys (Shift for
 * bigger steps). It stays inside the window, remembers where it was left,
 * and closes with Escape or its close button.
 */
function FloatingFiles({ orgKind, side, onClose }: { orgKind: "firm" | "client"; side: "left" | "right"; onClose: () => void }) {
  const t = useTranslations("files");
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [reload, setReload] = useState(0);

  // First placement: where it was left, else next to the sidebar.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const saved = readPosition();
    const sidebar = 16 * 16 + MARGIN;
    const fallback = { x: side === "right" ? window.innerWidth - el.offsetWidth - sidebar : sidebar, y: 64 };
    setPos(clamp(saved ?? fallback, el));
    el.querySelector<HTMLInputElement>("input")?.focus();
  }, [side]);

  useEffect(() => {
    const onResize = () => card.current && setPos((p) => (p ? clamp(p, card.current!) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const move = (next: Point) => {
    if (!card.current) return;
    const p = clamp(next, card.current);
    setPos(p);
    return p;
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button") || !pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current) move({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    if (pos) savePosition(pos);
  }
  function onHandleKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[e.key];
    if (!d || !pos) return;
    e.preventDefault();
    const p = move({ x: pos.x + d.x, y: pos.y + d.y });
    if (p) savePosition(p);
  }

  return createPortal(
    <div
      ref={card}
      id="files-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="files-card-title"
      aria-describedby="files-card-description"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed z-50 flex h-[min(38rem,calc(100vh-2rem))] w-[min(26rem,calc(100vw-2rem))] animate-page-in flex-col overflow-hidden surface-floating rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <div
        tabIndex={0}
        role="group"
        aria-roledescription={t("moveRole")}
        aria-label={t("move")}
        title={t("move")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onHandleKey}
        className="flex cursor-grab touch-none items-start gap-2 border-b bg-muted px-4 py-3 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset active:cursor-grabbing"
      >
        <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="files-card-title" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p id="files-card-description" className="text-xs text-muted-foreground">
            {orgKind === "firm" ? t("descriptionFirm") : t("descriptionClient")}
          </p>
        </div>
        <UploadDialog onDone={() => setReload((n) => n + 1)} />
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label={t("close")} title={t("close")}>
          <X />
        </Button>
      </div>
      <FileBrowser key={reload} orgKind={orgKind} className="min-h-0 flex-1 p-3" />
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------- uploading

type UploadTargets = Awaited<ReturnType<typeof uploadTargets>>;

/** "Add a file": pick a project, the file, who can see it and, at a client with departments, the team. */
function UploadDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("files");
  const rtl = useLocale() === "ar";
  const [targets, setTargets] = useState<UploadTargets | null>(null);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/files/targets")
      .then(async (res) => (res.ok ? ((await res.json()) as UploadTargets) : null))
      .then((x) => {
        if (!live || !x) return;
        setTargets(x);
        setProjectId(x.projects[0]?.id ?? "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!targets?.projects.length) return null;
  const project = targets.projects.find((p) => p.id === projectId) ?? targets.projects[0]!;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    form.delete("project");
    if (!form.get("departmentId")) form.delete("departmentId");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/documents`, { method: "POST", body: form });
      if (res.ok) {
        toast.success(t("uploaded"));
        setOpen(false);
        onDone();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      const m = body.message ?? "";
      setError(
        res.status === 503
          ? t("errors.scanner")
          : m.includes("infected")
            ? t("errors.infected")
            : m.includes("too large")
              ? t("errors.tooLarge")
              : m.includes("rejected")
                ? t("errors.type")
                : t("errors.generic"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7">
          <Upload className="size-3.5" />
          {t("upload")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("uploadTitle")}</DialogTitle>
            <DialogDescription>{t("uploadHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="upload-project">{t("project")}</Label>
            <NativeSelect id="upload-project" name="project" className="w-full" value={project.id} onChange={(e) => setProjectId(e.target.value)}>
              {targets.projects.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.kind === "internal" ? `${t("internal")} · ${p.title}` : `${(rtl ? p.org.nameAr : null) ?? p.org.name} · ${p.title}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="upload-file">{t("file")}</Label>
            <Input id="upload-file" name="file" type="file" accept={ACCEPTED_EXTENSIONS} required />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("sharing")}</legend>
            <RadioGroup key={project.id} name="visibility" defaultValue={project.visibilities[0]} className="gap-2">
              {project.visibilities.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <RadioGroupItem id={`vis-${v}`} value={v} />
                  <Label htmlFor={`vis-${v}`} className="font-normal">
                    {t(`visibility.${v}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          {project.departments.length ? (
            <div className="grid gap-2">
              <Label htmlFor="upload-dept">{t("department")}</Label>
              <NativeSelect id="upload-dept" name="departmentId" className="w-full" defaultValue="">
                <NativeSelectOption value="">{t("wholeCompany")}</NativeSelectOption>
                {project.departments.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {rtl ? d.nameAr : (d.nameEn ?? d.nameAr)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">{t("departmentHint")}</p>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {t("upload")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FileBrowserProps {
  /** Firm staff see a client level at the top of the tree. */
  orgKind?: "firm" | "client";
  /** Pick mode: only this action's client, and a "use this file" button. */
  pick?: { actionId: string; onPick: (file: FileEntry) => void; busy?: boolean };
  className?: string;
}

/** Search, the tree, and the selected file's details. */
export function FileBrowser({ orgKind = "client", pick, className }: FileBrowserProps) {
  const t = useTranslations("files");
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<string> | null>(null);

  useEffect(() => {
    let live = true;
    const url = pick ? `/api/files?actionId=${pick.actionId}` : "/api/files";
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as FileEntry[];
      })
      .then((list) => live && setFiles(list))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [pick?.actionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) =>
      [f.title, f.project.title, f.org.name, f.org.nameAr, f.uploaderName, "title" in f.source ? f.source.title : null]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  }, [files, query]);

  const tree = useMemo(() => buildTree(shown, orgKind === "firm" && !pick), [shown, orgKind, pick]);
  // First open: the top level is open. While searching, everything is.
  const open = query.trim() ? tree.allPaths : (expanded ?? tree.topPaths);
  const onExpandedChange = useCallback((next: Set<string>) => setExpanded(next), []);
  const current = files?.find((f) => `file:${f.id}` === selected);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
      </InputGroup>
      {pick ? <p className="text-xs text-muted-foreground">{t("pickHint")}</p> : null}

      <ScrollArea className="min-h-48 flex-1 rounded-xl border bg-card shadow-xs">
        <div className="p-2">
          {failed ? (
            <p className="p-4 text-sm text-destructive">{t("loadFailed")}</p>
          ) : files === null ? (
            <TreeSkeleton />
          ) : shown.length === 0 ? (
            <EmptyState
              className="border-0 bg-transparent"
              icon={<Folder animateOnView className="size-5" />}
              description={query ? t("noMatch") : pick ? t("emptyPick") : t("empty")}
            />
          ) : (
            <FileTree expanded={open} onExpandedChange={onExpandedChange} selectedPath={selected} onSelect={setSelected}>
              {tree.nodes.map((n) => (
                <TreeNode key={n.path} node={n} pick={Boolean(pick)} />
              ))}
            </FileTree>
          )}
        </div>
      </ScrollArea>

      {current ? <FileDetails file={current} pick={pick} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ tree

type FolderLabel = { text: string } | { org: FileEntry } | { source: SourceKind } | { unnamed: SourceKind };

type Node =
  | { type: "folder"; path: string; label: FolderLabel; kind: "org" | "internal" | "project" | "source" | "item"; children: Node[]; count: number }
  | { type: "file"; path: string; file: FileEntry };

function useLabels() {
  const t = useTranslations("files");
  const rtl = useLocale() === "ar";
  return {
    org: (f: FileEntry) => (f.org.kind === "firm" ? t("internal") : ((rtl ? f.org.nameAr : null) ?? f.org.name)),
    source: (k: SourceKind) => t(`source.${k}`),
    unnamed: (k: SourceKind) => t(`unnamed.${k}`),
  };
}

function buildTree(files: FileEntry[], byOrg: boolean) {
  const nodes: Node[] = [];
  const allPaths = new Set<string>();
  const folder = (list: Node[], path: string, kind: Extract<Node, { type: "folder" }>["kind"], label: FolderLabel) => {
    let f = list.find((n) => n.path === path) as Extract<Node, { type: "folder" }> | undefined;
    if (!f) {
      f = { type: "folder", path, kind, label, children: [], count: 0 };
      list.push(f);
      allPaths.add(path);
    }
    f.count++;
    return f;
  };
  for (const file of files) {
    let level = nodes;
    if (byOrg) {
      const org = folder(level, `org:${file.org.id}`, file.org.kind === "firm" ? "internal" : "org", { org: file });
      level = org.children;
    }
    const project = folder(level, `${byOrg ? `org:${file.org.id}/` : ""}project:${file.project.id}`, "project", { text: file.project.title });
    const src = folder(project.children, `${project.path}/source:${file.source.kind}`, "source", { source: file.source.kind });
    level = src.children;
    if ("id" in file.source) {
      const s = file.source;
      level = folder(level, `${src.path}/item:${s.id ?? "none"}`, "item", s.title ? { text: s.title } : { unnamed: s.kind }).children;
    }
    level.push({ type: "file", path: `file:${file.id}`, file });
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => {
      if (a.type === "folder" && b.type === "folder" && a.kind === "source" && b.kind === "source") {
        return SOURCE_ORDER.indexOf(a.path.split("source:")[1] as SourceKind) - SOURCE_ORDER.indexOf(b.path.split("source:")[1] as SourceKind);
      }
      if (a.type === "folder" && b.type === "folder" && (a.kind === "internal") !== (b.kind === "internal")) return a.kind === "internal" ? 1 : -1;
      return 0; // files keep the server's order, newest first
    });
    for (const n of list) if (n.type === "folder") sort(n.children);
  };
  sort(nodes);
  return { nodes, allPaths, topPaths: new Set(nodes.map((n) => n.path)) };
}

function TreeNode({ node, pick }: { node: Node; pick: boolean }) {
  const labels = useLabels();
  if (node.type === "file") {
    const f = node.file;
    const usable = !pick || (f.available && f.visibility === "shared");
    return (
      <FileTreeFile
        path={node.path}
        name={<bdi>{f.title}</bdi>}
        icon={fileIcon(f.contentType)}
        disabled={!usable}
        meta={f.version > 1 ? <Badge variant="outline" className="h-5 px-1.5 text-xs tabular-nums">v{f.version}</Badge> : null}
      />
    );
  }
  const label = node.label;
  const name =
    "org" in label
      ? labels.org(label.org)
      : "source" in label
        ? labels.source(label.source)
        : "unnamed" in label
          ? labels.unnamed(label.unnamed)
          : label.text;
  return (
    <FileTreeFolder
      path={node.path}
      name={name}
      icon={node.kind === "internal" ? <Lock /> : undefined}
      meta={<span className="text-xs text-muted-foreground tabular-nums">{node.count}</span>}
    >
      {node.children.map((c) => (
        <TreeNode key={c.path} node={c} pick={pick} />
      ))}
    </FileTreeFolder>
  );
}

function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return <FileImage />;
  if (contentType.includes("spreadsheet") || contentType.includes("csv")) return <FileSpreadsheet />;
  if (contentType.includes("zip")) return <FileArchive />;
  if (contentType === "application/pdf") return <FileType />;
  return <FileText />;
}

function TreeSkeleton() {
  return (
    <div className="grid gap-2 p-2" aria-hidden>
      {[60, 45, 70, 50, 40].map((w, i) => (
        <Skeleton key={i} className="h-5" style={{ width: `${w}%`, marginInlineStart: `${(i % 3) * 1}rem` }} />
      ))}
    </div>
  );
}

// --------------------------------------------------------------- details

function FileDetails({ file, pick }: { file: FileEntry; pick?: FileBrowserProps["pick"] }) {
  const t = useTranslations("files");
  const format = useFormatter();
  const labels = useLabels();
  const rtl = useLocale() === "ar";
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${file.id}/download`);
      if (res.ok) window.location.assign(((await res.json()) as { url: string }).url);
      else toast.error(t("downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  const sourceHref =
    file.source.kind === "evidence" && file.source.id
      ? `/actions/${file.source.id}`
      : file.source.kind === "meeting"
        ? `/meetings/${file.source.id}`
        : file.source.kind === "assessment"
          ? `/assessments/${file.source.id}`
          : `/projects/${file.project.id}`;
  const sourceName = "title" in file.source && file.source.title ? file.source.title : file.project.title;
  const department = (rtl ? file.departmentName : (file.departmentNameEn ?? file.departmentName)) ?? null;
  const usable = file.available && file.visibility === "shared";

  return (
    <div className="grid animate-page-in gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            <bdi>{file.title}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            {labels.source(file.source.kind)} ·{" "}
            <Link href={sourceHref} className="underline-offset-2 hover:underline">
              {sourceName}
            </Link>
          </p>
        </div>
        <VisibilityBadge visibility={file.visibility} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t("uploadedBy")}</dt>
        <dd>
          {file.uploadedByMe ? t("you") : (file.uploaderName ?? "—")} · {format.dateTime(new Date(file.createdAt), { dateStyle: "medium" })}
        </dd>
        <dt className="text-muted-foreground">{t("version")}</dt>
        <dd className="tabular-nums">
          v{file.version} · {formatSize(file.sizeBytes, rtl)}
        </dd>
        {department ? (
          <>
            <dt className="text-muted-foreground">{t("department")}</dt>
            <dd>{department}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{t("sharing")}</dt>
        <dd>
          {t(`visibility.${file.visibility}`)}
          {file.sharedWith.length > 0 ? (
            <span className="ms-1 inline-flex items-center gap-1 text-muted-foreground">
              <Users className="size-3" />
              {file.sharedWith.join(rtl ? "، " : ", ")}
            </span>
          ) : null}
        </dd>
      </dl>
      {!file.available ? <p className="text-xs text-muted-foreground">{t("notCleared")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy || !file.available}>
          {busy ? <BrandLoader tone="current" className="size-4" /> : <Download className="size-4" />}
          {t("download")}
        </Button>
        {pick ? (
          <Button type="button" size="sm" onClick={() => pick.onPick(file)} disabled={!usable || pick.busy}>
            {pick.busy ? <BrandLoader tone="current" className="size-4" /> : null}
            {t("useFile")}
          </Button>
        ) : null}
      </div>
      {pick && file.available && file.visibility !== "shared" ? <p className="text-xs text-muted-foreground">{t("notShared")}</p> : null}
    </div>
  );
}

function VisibilityBadge({ visibility }: { visibility: FileEntry["visibility"] }) {
  const t = useTranslations("files");
  if (visibility === "shared") return <Badge variant="secondary">{t("visibility.shared")}</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <Lock className="size-3" />
      {t(`visibility.${visibility}`)}
    </Badge>
  );
}

function formatSize(bytes: number, rtl: boolean) {
  const units = rtl ? ["بايت", "ك.ب", "م.ب"] : ["B", "KB", "MB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

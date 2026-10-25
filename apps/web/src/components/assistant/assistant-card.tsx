"use client";

import { GripVertical } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/ui/toast";
import { Bot } from "@/components/animate-ui/icons/bot";
import { Maximize } from "@/components/animate-ui/icons/maximize";
import { MessageSquarePlus } from "@/components/animate-ui/icons/message-square-plus";
import { Minimize } from "@/components/animate-ui/icons/minimize";
import { PanelLeftClose } from "@/components/animate-ui/icons/panel-left-close";
import { PanelLeftOpen } from "@/components/animate-ui/icons/panel-left-open";
import { X } from "@/components/animate-ui/icons/x";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { useFloatingCard } from "@/components/floating-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ChatHeader, ChatList, Composer, getJson, NewChatHeader, Thread, type Chat, type ChatRow, type Lang, type NewChatCase } from "./assistant-chat";
import { assistant, useAssistant } from "./store";

// The assistant as a floating card, like the Files card: it opens from the
// sidebar (or "Ask the assistant" on a record) and stays open while the
// person moves between pages. Small, it shows one thing at a time: the chats,
// or one chat. Focused, it moves to the middle of the screen, grows, and
// shows the chats beside the open chat. A chat is about every project the
// person may ask about ("All my clients", the default), or one project and
// optionally one record in it (docs/assistant.md).

interface Context {
  projects: { id: string; title: string; client: string }[];
  projectId: string | null;
  case: NewChatCase | null;
  usage: { used: number; limit: number } | null;
  /** "local": a model on this machine's processor answers, slowly. */
  model: "local" | "hosted";
}

/** A question on its way: what it is, and the answer written so far. */
export interface Pending {
  question: string;
  /** The search is done and the model is writing. */
  writing: boolean;
  answer: string;
}

/**
 * Asks with the answer streaming in. Gives the saved answer's chat, or why it failed:
 * "limit" (the client's daily limit) or "error".
 */
async function askStreaming(body: unknown, onWriting: () => void, onAnswer: (text: string) => void): Promise<{ conversationId: string } | "limit" | "error"> {
  const res = await fetch("/api/assistant/query", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res?.ok || !res.body) return res?.status === 429 ? "limit" : "error";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (let r = await reader.read().catch(() => null); r && !r.done; r = await reader.read().catch(() => null)) {
    buffer += decoder.decode(r.value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; text?: string; conversationId?: string };
      if (event.type === "writing") onWriting();
      else if (event.type === "text" && event.text !== undefined) onAnswer(event.text);
      else if (event.type === "done" && event.conversationId) return { conversationId: event.conversationId };
      else if (event.type === "error") return "error";
    }
  }
  return "error";
}

/** The sidebar entry: opens and closes the card. */
export function AssistantSidebarItem({ title }: { title: string }) {
  const { open } = useAssistant();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={title}
        isActive={open}
        onClick={() => assistant.toggle()}
        aria-expanded={open}
        aria-controls={open ? "assistant-card" : undefined}
      >
        <Bot animate={open} animateOnHover />
        <span>{title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Mounted once in the app layout, for people who may use the assistant. */
export function AssistantHost({ side, client }: { side: "left" | "right"; client: boolean }) {
  const { open, seq, request } = useAssistant();
  return open ? <AssistantCard side={side} client={client} seq={seq} request={request} /> : null;
}

const spring = { type: "spring", stiffness: 380, damping: 34 } as const;

function AssistantCard({ side, client, seq, request }: { side: "left" | "right"; client: boolean; seq: number; request: ReturnType<typeof useAssistant>["request"] }) {
  const t = useTranslations("assistant");
  const locale = useLocale() as Lang;
  const [focused, setFocused] = useState(false);
  const [view, setView] = useState<"list" | "chat">(request ? "chat" : "list");
  // Focused: the chats beside the open chat, unless hidden.
  const [listShown, setListShown] = useState(true);
  const { card, pos, handle } = useFloatingCard({ storageKey: "selah.assistant.position", side, pinned: focused });

  const [ctx, setCtx] = useState<Context | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [archived, setArchived] = useState<ChatRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [chatId, setChatId] = useState<string | null>(request && "chatId" in request ? request.chatId : null);
  // Bumped to load the list or the open chat again.
  const [listVersion, setListVersion] = useState(0);
  const [chatVersion, setChatVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; chat: Chat | null } | null>(null);
  // projectId null: all the projects the person may ask about.
  const [draft, setDraft] = useState<{ projectId: string | null; case: NewChatCase | null }>({ projectId: null, case: null });
  const [pending, setPending] = useState<Pending | null>(null);
  // "limit": the person asked their questions for today (the client assistant's daily limit).
  const [failed, setFailed] = useState<false | "error" | "limit">(false);

  // Loaded again when the interface language changes, to pick up kept translations.
  const chatKey = chatId ? `${chatId}:${locale}:${chatVersion}` : null;
  const chat = chatKey && loaded?.key === chatKey ? loaded.chat : chatId && loaded?.chat?.id === chatId ? loaded.chat : null;
  const loadingChat = Boolean(chatKey && loaded?.key !== chatKey);

  // The projects, and the record a new chat is about. Read again for every request to open.
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ locale });
    if (request && "projectId" in request) {
      params.set("project", request.projectId);
      if (request.case) params.set("case", `${request.case.type}:${request.case.id}`);
    }
    void getJson<Context>(`/api/assistant/context?${params}`).then((c) => {
      if (!live || !c) return;
      setCtx(c);
      // Opened from a project or a record: that project. Otherwise as it was (all, at first).
      if (request && "projectId" in request) setDraft({ projectId: c.case?.projectId ?? c.projectId, case: c.case });
    });
    return () => {
      live = false;
    };
    // `request` changes only with `seq`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, locale]);

  // A request while open: show what it asked for.
  const firstSeq = useRef(seq);
  useEffect(() => {
    if (seq === firstSeq.current || !request) return;
    setFailed(false);
    setChatId("chatId" in request ? request.chatId : null);
    setView("chat");
  }, [seq, request]);

  const loadArchived = useCallback(async () => {
    const rows = await getJson<ChatRow[]>("/api/assistant/conversations?archived=1");
    if (rows) setArchived(rows);
  }, []);

  useEffect(() => {
    let live = true;
    void getJson<ChatRow[]>("/api/assistant/conversations").then((rows) => {
      if (!live || !rows) return;
      setChats(rows);
      // No chats yet: the card opens on a new one, not on an empty list.
      if (listVersion === 0 && rows.length === 0) setView("chat");
    });
    return () => {
      live = false;
    };
  }, [listVersion]);

  useEffect(() => {
    if (!chatId || !chatKey) return;
    let live = true;
    void getJson<Chat>(`/api/assistant/conversations/${chatId}?lang=${locale}`).then((data) => {
      if (!live) return;
      setLoaded({ key: chatKey, chat: data });
      if (!data) {
        toast.error(t("chatGone"));
        setChatId(null);
      }
    });
    return () => {
      live = false;
    };
  }, [chatId, chatKey, locale, t]);

  function refresh() {
    setListVersion((v) => v + 1);
    if (archived) void loadArchived();
  }

  function openChat(id: string | null) {
    setChatId(id);
    setFailed(false);
    setView("chat");
  }

  function newChat() {
    setDraft((d) => ({ ...d, case: null }));
    openChat(null);
  }

  async function ask(question: string) {
    setPending({ question, writing: false, answer: "" });
    setFailed(false);
    const body = chat
      ? { projectId: chat.projectId, conversationId: chat.id, question, language: locale }
      : {
          projectId: draft.projectId,
          question,
          language: locale,
          ...(draft.case ? { caseType: draft.case.type, caseId: draft.case.id } : {}),
        };
    const r = await askStreaming(
      body,
      () => setPending({ question, writing: true, answer: "" }),
      (answer) => setPending({ question, writing: true, answer }),
    );
    setPending(null);
    if (typeof r === "string") {
      setFailed(r);
      return false;
    }
    const { conversationId } = r;
    if (conversationId !== chatId) setChatId(conversationId);
    else setChatVersion((v) => v + 1);
    if (ctx?.usage) setCtx({ ...ctx, usage: { ...ctx.usage, used: ctx.usage.used + 1 } });
    refresh();
    return true;
  }

  async function patch(change: { title?: string; keep?: boolean; archived?: boolean }) {
    if (!chat) return;
    const r = await callApi(`/api/assistant/conversations/${chat.id}`, "PATCH", change);
    if (!r.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    setChatVersion((v) => v + 1);
    refresh();
  }

  async function remove() {
    if (!chat) return;
    const r = await callApi(`/api/assistant/conversations/${chat.id}`, "DELETE");
    if (!r.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("deleted"));
    setChatId(null);
    setView("list");
    refresh();
  }

  // Following a link out of the focused card: back to the small card, so the page shows.
  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (focused && (e.target as HTMLElement).closest("a[href]")) setFocused(false);
  }

  const showList = focused ? listShown : view === "list";
  const showChat = focused || view === "chat";
  const listLabel = showList ? t("card.hideChats") : t("card.showChats");
  const noProjects = ctx !== null && ctx.projects.length === 0;

  return createPortal(
    <>
      <AnimatePresence>
        {focused ? (
          <motion.div
            key="backdrop"
            aria-hidden
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] dark:bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFocused(false)}
          />
        ) : null}
      </AnimatePresence>
      <motion.div
        ref={card}
        id="assistant-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="assistant-card-title"
        layout
        layoutDependency={focused}
        transition={spring}
        onClickCapture={onClickCapture}
        onKeyDown={(e) => {
          // Escape inside a menu or dialog opened from the card closes only that.
          if (e.key !== "Escape" || e.defaultPrevented || !card.current?.contains(e.target as Node)) return;
          e.stopPropagation();
          if (focused) setFocused(false);
          else assistant.close();
        }}
        className={cn(
          "floating-card-assistant fixed z-50 flex flex-col overflow-hidden surface-floating rounded-xl border bg-popover text-popover-foreground shadow-2xl",
          focused ? "inset-0 m-auto h-[min(48rem,calc(100vh-4rem))] w-[min(72rem,calc(100vw-4rem))]" : "h-[min(40rem,calc(100vh-2rem))] w-[min(28rem,calc(100vw-2rem))]",
        )}
        style={focused ? undefined : { left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? "visible" : "hidden" }}
      >
        <motion.div
          layout
          layoutDependency={focused}
          transition={spring}
          tabIndex={focused ? -1 : 0}
          role="group"
          aria-roledescription={focused ? undefined : t("card.moveRole")}
          aria-label={focused ? undefined : t("card.move")}
          title={focused ? undefined : t("card.move")}
          {...handle}
          className={cn(
            "flex touch-none items-center gap-1 border-b bg-muted px-3 py-2 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
            focused ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          )}
        >
          {focused ? null : <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          {focused || view === "chat" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => (focused ? setListShown(!listShown) : setView("list"))}
              aria-label={listLabel}
              title={listLabel}
              aria-pressed={focused ? listShown : undefined}
            >
              {showList ? <PanelLeftClose animateOnHover className="rtl:-scale-x-100" /> : <PanelLeftOpen animateOnHover className="rtl:-scale-x-100" />}
            </Button>
          ) : null}
          <h2 id="assistant-card-title" className="min-w-0 flex-1 truncate px-1 text-base font-semibold">
            {t("title")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={newChat}
            disabled={noProjects}
            aria-label={t("newChat")}
            title={t("newChat")}
          >
            <MessageSquarePlus animateOnHover />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setFocused(!focused)}
            aria-pressed={focused}
            aria-label={focused ? t("card.unfocus") : t("card.focus")}
            title={focused ? t("card.unfocus") : t("card.focus")}
          >
            {focused ? <Minimize animateOnHover /> : <Maximize animateOnHover />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => assistant.close()}
            aria-label={t("card.close")}
            title={t("card.close")}
          >
            <X animateOnHover />
          </Button>
        </motion.div>

        <motion.div layout layoutDependency={focused} transition={spring} className="flex min-h-0 flex-1">
          {ctx === null ? (
            <div className="flex flex-1 items-center justify-center">
              <BrandLoader className="size-8" />
            </div>
          ) : noProjects ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyDescription>{t("noProjects")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {showList ? (
                  <motion.div
                    key="list"
                    className={cn("flex min-h-0 flex-col", focused ? "w-72 shrink-0 border-e bg-muted/40" : "flex-1")}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChatList
                      className="flex-1"
                      chats={chats}
                      archived={archived}
                      filter={filter}
                      onFilter={setFilter}
                      selected={showChat ? chatId : null}
                      onOpen={openChat}
                      onShowArchived={() => (archived ? setArchived(null) : void loadArchived())}
                      client={client}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {showChat ? (
                <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={chat?.title || t("newChat")}>
                  {chat ? (
                    <ChatHeader chat={chat} onPatch={patch} onDelete={remove} client={client} />
                  ) : (
                    <NewChatHeader projects={ctx.projects} draft={draft} onChange={setDraft} disabled={Boolean(chatId)} client={client} />
                  )}
                  <Thread
                    chat={chat}
                    loading={loadingChat}
                    pending={pending}
                    failed={failed}
                    note={client ? t("clientDisclaimer") : t("disclaimer")}
                    slow={ctx.model === "local"}
                  />
                  <Composer onAsk={ask} busy={pending !== null} disabled={false} usage={ctx.usage} />
                </section>
              ) : null}
            </>
          )}
        </motion.div>
      </motion.div>
    </>,
    document.body,
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { FileBrowser } from "@/components/file-explorer";
import { AfterSendChoice, SendFileDialog, type AfterSend } from "@/components/send-file-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DialogControl } from "@/hooks/use-dialog-control";
import type { FileEntry } from "@/services/files";
import { json, ReceivedFields, send, useReceived, useRun } from "./action-panel";

const NO_ITEM = "none";

/**
 * Sending a file on an action, from the next step or from one item of "What
 * to send": the one dialog (components/send-file-dialog.tsx). With an
 * evidence list a file always goes to an item ("Not an item on the list"
 * covers the rest). Its last choice is "Send for review now" or "Save
 * without sending", whenever the reader may send it for review; from a sent
 * back action, sending for review is one step (the server moves it through
 * "in progress"). Without a new file, "send for review" sends what was
 * attached before.
 */
export function ActionSendFile(props: {
  actionId: string;
  /** Items still waiting for a file (open or not accepted). */
  items: { id: string; title: string }[];
  /** Opened from one item's row: the file answers it. */
  item?: { id: string; title: string };
  /** The reader may send the action for review now. */
  canReview: boolean;
  /** Which choice is made when it opens. */
  defaultAfter: AfterSend;
  /** Firm staff recording for a client the firm runs: how and when the client sent the file. */
  recordFor: boolean;
  /** A firm reader sends it: the dialog speaks of the firm's reviewers, not "your consultant". */
  firm: boolean;
  title: string;
  trigger?: ReactNode;
  control?: DialogControl;
}) {
  const t = useTranslations("action");
  const ts = useTranslations("sendFile");
  const router = useRouter();
  const received = useReceived(props.recordFor);
  const [item, setItem] = useState("");
  const [note, setNote] = useState("");
  const [after, setAfter] = useState<AfterSend>(props.canReview ? props.defaultAfter : "save");
  const { busy, error, go, setError } = useRun(() => router.refresh());
  // Held here, so a successful send closes it whether its own button or a menu opened it.
  const [own, setOwn] = useState(false);
  const open = props.control?.open ?? own;
  const setOpen = (o: boolean) => (props.control?.onOpenChange ? props.control.onOpenChange(o) : setOwn(o));
  const review = props.canReview && after === "review";
  const choose = !props.item && props.items.length > 0;
  const itemId = props.item?.id ?? (choose && item && item !== NO_ITEM ? item : undefined);
  const needItem = choose && !item;

  function reset(isOpen: boolean) {
    if (isOpen) return;
    setItem("");
    setNote("");
    setAfter(props.canReview ? props.defaultAfter : "save");
    setError(null);
    received.reset();
  }
  const closeDialog = () => {
    setOpen(false);
    reset(false);
  };

  function submit(form: FormData) {
    if (needItem) return setError("chooseItem");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      // Sending for review what was attached before needs no new file.
      if (review) go(() => send(`/api/actions/${props.actionId}/transition`, json({ to: "awaiting_review" })), closeDialog);
      return;
    }
    if (!received.ready) return setError("received");
    form.delete("receivedOn");
    form.set("submitForReview", String(review));
    if (itemId) form.set("evidenceRequestId", itemId);
    if (note.trim()) form.set("note", note.trim());
    for (const [k, v] of Object.entries(received.payload)) form.set(k, v);
    go(() => send(`/api/actions/${props.actionId}/evidence`, { method: "POST", body: form }), closeDialog);
  }

  function pick(file: FileEntry) {
    if (needItem) return setError("chooseItem");
    if (!received.ready) return setError("received");
    go(
      () =>
        send(
          `/api/actions/${props.actionId}/evidence/existing`,
          json({ documentId: file.id, note: note.trim() || undefined, submitForReview: review, evidenceRequestId: itemId, ...received.payload }),
        ),
      closeDialog,
    );
  }

  return (
    <SendFileDialog
      title={props.title}
      description={props.item ? ts("forItem", { item: props.item.title }) : ts("forAction")}
      trigger={props.trigger}
      control={{ open, onOpenChange: setOpen, returnFocus: props.control?.returnFocus }}
      onOpenChange={reset}
      fileRequired={!review}
      busy={busy}
      error={error ? t(`errors.${error}`) : null}
      submitLabel={review ? t("sendForReview") : ts("save")}
      submitDisabled={needItem}
      onSubmit={submit}
      before={
        <>
          {choose ? (
            <div className="grid gap-2">
              <Label htmlFor="send-item">{t("answersItem")}</Label>
              <Select value={item} onValueChange={setItem}>
                <SelectTrigger id="send-item" className="w-full">
                  <SelectValue placeholder={t("answersItemPick")} />
                </SelectTrigger>
                <SelectContent>
                  {props.items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.title}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_ITEM}>{t("answersNone")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {props.recordFor ? <ReceivedFields idPrefix="ev" {...received} /> : null}
        </>
      }
      pick={<FileBrowser className="max-h-[50vh]" pick={{ actionId: props.actionId, onPick: pick, busy: busy || needItem }} />}
      after={
        <>
          <div className="grid gap-2">
            <Label htmlFor="send-note">{t("note")}</Label>
            <Textarea id="send-note" maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
          </div>
          {props.canReview ? <AfterSendChoice value={after} onChange={setAfter} idPrefix="after" firm={props.firm} /> : null}
        </>
      }
    />
  );
}

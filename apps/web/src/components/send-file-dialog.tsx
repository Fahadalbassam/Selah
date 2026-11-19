"use client";

import { Upload } from "@/components/animate-ui/icons/upload";
import { useTranslations } from "next-intl";
import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { BrandLoader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDialogControl, type DialogControl } from "@/hooks/use-dialog-control";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/upload-rules";
import { cn } from "@/lib/utils";

// One way to send a file (page audit U05, 4.5 block 5; batch 4). Every place
// in the app that takes a file opens this dialog: an action's evidence (the
// next step and each item of "What to send"), a document request, "Add a
// file" on a project and in the Files card, a file's new version. The
// signed-out upload page uses its file field. The same title words, the same
// field, the same rules line, the same order: what the file is for, the
// file (or one already in Selah), who sees it, and last the choice of what
// happens next. Each caller keeps its own endpoint and its own checks; the
// server decides everything again. tests/action-page.test.ts checks that no
// other screen has a file field.

/** The file field, with the accepted types and size said under it. */
/** Words come from the caller, so a signed-out page passes only its own catalogue (src/i18n/signed-out-messages.ts). */
export function FileField({ id, label, required = true, hint }: { id: string; label: string; required?: boolean; hint: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name="file" type="file" accept={ACCEPTED_EXTENSIONS} required={required} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The key under sendFile.errors for an upload the server refused. */
export function uploadErrorKey(status: number, message: string | undefined): "scanner" | "infected" | "tooLarge" | "type" | "generic" {
  const m = message ?? "";
  if (status === 503) return "scanner";
  if (m.includes("infected")) return "infected";
  if (m.includes("too large")) return "tooLarge";
  if (m.includes("rejected")) return "type";
  return "generic";
}

/** "Send for review now" or "Save without sending": the dialog's last choice on an action. */
export type AfterSend = "review" | "save";

/** `firm`: a firm reader sends it (for a client the firm runs, or on an internal project), so the hint names the firm's reviewers, not "your consultant" (N24, review N7). */
export function AfterSendChoice({ value, onChange, idPrefix, firm = false }: { value: AfterSend; onChange: (v: AfterSend) => void; idPrefix: string; firm?: boolean }) {
  const t = useTranslations("sendFile");
  return (
    <fieldset className="grid gap-2 border-t pt-4">
      <legend className="mb-2 text-sm font-medium">{t("after")}</legend>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as AfterSend)} className="gap-2">
        {(["review", "save"] as const).map((v) => (
          <label key={v} htmlFor={`${idPrefix}-${v}`} className="flex items-start gap-2 text-sm">
            <RadioGroupItem id={`${idPrefix}-${v}`} value={v} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block">{t(`afterChoice.${v}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`afterHint.${v}${firm && v === "review" ? "Firm" : ""}`)}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

export interface SendFileDialogProps {
  title: string;
  description?: ReactNode;
  /** Its own button, or opened from a row menu through `control`. */
  trigger?: ReactNode;
  control?: DialogControl;
  /** A line above the form (a confidential request, a firm-run client). */
  notice?: ReactNode;
  /** What the file is for, above the file: the project, the item, how the client sent it. */
  before?: ReactNode;
  /** After the file: a note, who sees it, the department, what happens next. */
  after?: ReactNode;
  /** The second way in: a file already in Selah. Drawn under a "Choose from Selah files" tab. */
  pick?: ReactNode;
  fileLabel?: string;
  /** False when a file is optional (sending for review a file sent earlier). */
  fileRequired?: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  /** Told when it opens or closes, to reset the caller's state. */
  onOpenChange?: (open: boolean) => void;
}

export function SendFileDialog(props: SendFileDialogProps) {
  const t = useTranslations("sendFile");
  const tc = useTranslations("common");
  const { open, setOpen, contentProps } = useDialogControl(props.control);
  const [mode, setMode] = useState<"upload" | "pick">("upload");
  const change = (o: boolean) => {
    setOpen(o);
    if (!o) setMode("upload");
    props.onOpenChange?.(o);
  };
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Picking a file sends on its own button; Enter in the search box sends nothing.
    if (mode === "pick") return;
    props.onSubmit(new FormData(e.currentTarget));
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent {...contentProps} className={cn("max-h-[85vh] overflow-y-auto", props.pick && "sm:max-w-2xl")}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description ? <DialogDescription dir="auto">{props.description}</DialogDescription> : null}
          </DialogHeader>
          {props.notice}
          {props.pick ? (
            <Tabs value={mode} onValueChange={(v) => setMode(v as "upload" | "pick")}>
              <TabsList className="w-full">
                <TabsTrigger value="upload">{t("uploadNew")}</TabsTrigger>
                <TabsTrigger value="pick">{t("pickExisting")}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          {props.before}
          {mode === "upload" ? (
            <FileField
              id="send-file"
              label={props.fileLabel ?? t("file")}
              required={props.fileRequired ?? true}
              hint={t.rich("rules", {
                // One left-to-right piece: loose inside an Arabic sentence, the dots land on the wrong sides.
                types: () => <bdi dir="ltr">{ACCEPTED_EXTENSIONS.replaceAll(",", " ")}</bdi>,
                mb: MAX_UPLOAD_BYTES / 1024 / 1024,
              })}
            />
          ) : (
            props.pick
          )}
          {props.after}
          {props.error ? (
            <p role="alert" className="text-sm text-destructive">
              {props.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)}>
              {tc("cancel")}
            </Button>
            {mode === "upload" ? (
              <Button type="submit" disabled={props.busy || props.submitDisabled}>
                {props.busy ? <BrandLoader tone="current" className="size-4" /> : null}
                {props.busy ? t("sending") : props.submitLabel}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The outline "Send a file" button most callers open it with. */
export function SendFileButton({
  label,
  size = "sm",
  variant = "outline",
  ...rest
}: { label?: string; size?: "sm" | "default"; variant?: "outline" | "default" } & Omit<ComponentProps<typeof Button>, "size" | "variant">) {
  const t = useTranslations("sendFile");
  return (
    <Button type="button" size={size} variant={variant} className="w-fit" {...rest}>
      <Upload />
      {label ?? t("button")}
    </Button>
  );
}

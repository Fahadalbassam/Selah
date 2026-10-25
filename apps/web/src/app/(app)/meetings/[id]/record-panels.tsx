"use client";

import { UserPlus } from "lucide-react";
import { Check } from "@/components/animate-ui/icons/check";
import { Plus } from "@/components/animate-ui/icons/plus";
import { RotateCcw } from "@/components/animate-ui/icons/rotate-ccw";
import { X } from "@/components/animate-ui/icons/x";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PersonPicker } from "@/components/person-picker";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { meetingError } from "@/lib/meetings";
import { useConfirm } from "@/components/confirm-dialog";

type Visibility = "shared" | "firm_private";

/** Runs one call, shows what went wrong (in the meeting screens' words where it can), and refreshes. */
function useCall() {
  const t = useTranslations("meeting.form.errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(url: string, method: string, body?: unknown, done?: string) {
    setBusy(true);
    const r = await callApi(url, method, body);
    setBusy(false);
    if (!r.ok) {
      const key = meetingError(r.message);
      toast.error(key ? t(key) : tc(`errors.${r.error}`));
      return false;
    }
    if (done) toast.success(done);
    router.refresh();
    return true;
  }
  return { busy, run };
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="sm" disabled={busy}>
      {busy ? <BrandLoader tone="current" className="size-4" /> : null}
      {children}
    </Button>
  );
}

/** "Shared with client" switch; hidden when the meeting itself is firm-only. */
function ShareSwitch(props: { id: string; meetingShared: boolean; shared: boolean; onChange: (on: boolean) => void }) {
  const tv = useTranslations("visibility");
  if (!props.meetingShared) return <p className="text-xs text-muted-foreground">{tv("firm_private")}</p>;
  return (
    <div className="flex items-center gap-2">
      <Switch id={props.id} checked={props.shared} onCheckedChange={props.onChange} />
      <Label htmlFor={props.id} className="text-sm font-normal">
        {props.shared ? tv("shared") : tv("firm_private")}
      </Label>
    </div>
  );
}

/** The attendee's own answer to the invitation. */
export function RespondButtons({ meetingId, current }: { meetingId: string; current: string }) {
  const t = useTranslations("meeting");
  const { busy, run } = useCall();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t("yourAnswer")}</span>
      {(["accepted", "tentative", "declined"] as const).map((r) => (
        <Button
          key={r}
          size="sm"
          variant={current === r ? "default" : "outline"}
          disabled={busy}
          onClick={() => run(`/api/meetings/${meetingId}/response`, "PUT", { response: r })}
        >
          {t(`response.${r}`)}
        </Button>
      ))}
    </div>
  );
}

/** Add someone who can open the project, or one of the client's contacts (firm only). */
export function AddAttendee(props: { meetingId: string; options: { value: string; label: string }[] }) {
  const t = useTranslations("meeting.form");
  const { busy, run } = useCall();
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState(false);
  if (!props.options.length) return null;
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus />
        {t("addAttendee")}
      </Button>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const [kind, id] = pick.split(":");
        if (!id) return;
        const ok = await run(
          `/api/meetings/${props.meetingId}/attendees`,
          "POST",
          kind === "c" ? { contactId: id } : { userId: id },
        );
        if (!ok) return;
        setPick("");
        setOpen(false);
      }}
    >
      <PersonPicker onValueChange={setPick} options={props.options} placeholder={t("addAttendee")} />
      <div className="flex gap-2">
        <Submit busy={busy}>{t("add")}</Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("close")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("resendHint")}</p>
    </form>
  );
}

export function RemoveAttendee({ meetingId, attendeeId, name }: { meetingId: string; attendeeId: string; name: string }) {
  const t = useTranslations("meeting.form");
  const { busy, run } = useCall();
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={busy}
        aria-label={t("remove", { name })}
        title={t("remove", { name })}
        onClick={async () =>
          (await confirm(t("removeConfirm", { name }))) && run(`/api/meetings/${meetingId}/attendees/${attendeeId}`, "DELETE")
        }
      >
        <X />
      </Button>
      {confirmDialog}
    </>
  );
}

/** Write or rewrite the summary. Saving it confirms it; it starts firm-only. */
export function SummaryEditor(props: {
  meetingId: string;
  meetingShared: boolean;
  initial: { mainPointsMd: string; lang: "ar" | "en"; visibility: Visibility } | null;
  defaultLang: "ar" | "en";
  onDone?: () => void;
}) {
  const t = useTranslations("meeting.record");
  const tl = useTranslations("meeting.transcript.langs");
  const { busy, run } = useCall();
  const [lang, setLang] = useState(props.initial?.lang ?? props.defaultLang);
  const [shared, setShared] = useState(props.initial?.visibility === "shared");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("points") ?? "").trim();
    if (!text) return;
    const ok = await run(
      `/api/meetings/${props.meetingId}/summary`,
      "PUT",
      { lang, mainPointsMd: text, visibility: props.meetingShared && shared ? "shared" : "firm_private" },
      t("summarySaved"),
    );
    if (ok) props.onDone?.();
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="summary-points">{t("mainPoints")}</Label>
        <Textarea
          id="summary-points"
          name="points"
          rows={8}
          maxLength={20000}
          required
          dir="auto"
          defaultValue={props.initial?.mainPointsMd}
          placeholder={t("mainPointsHint")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <NativeSelect value={lang} onChange={(e) => setLang(e.target.value as "ar" | "en")} aria-label={t("writtenIn")}>
          <NativeSelectOption value="ar">{tl("ar")}</NativeSelectOption>
          <NativeSelectOption value="en">{tl("en")}</NativeSelectOption>
        </NativeSelect>
        <ShareSwitch id="summary-shared" meetingShared={props.meetingShared} shared={shared} onChange={setShared} />
      </div>
      <p className="text-xs text-muted-foreground">{t("confirmHint")}</p>
      <div className="flex gap-2">
        <Submit busy={busy}>{t("saveSummary")}</Submit>
        {props.onDone && props.initial ? (
          <Button type="button" size="sm" variant="ghost" onClick={props.onDone}>
            {t("close")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A summary that is shown, with an Edit button for whoever runs the meeting. */
export function SummaryBlock(props: { view: ReactNode; editor: Omit<Parameters<typeof SummaryEditor>[0], "onDone"> }) {
  const t = useTranslations("meeting.record");
  const [editing, setEditing] = useState(false);
  if (editing || !props.editor.initial) return <SummaryEditor {...props.editor} onDone={() => setEditing(false)} />;
  return (
    <div className="space-y-2">
      {props.view}
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        {t("editSummary")}
      </Button>
    </div>
  );
}

/** Record a decision. Decisions are never edited: a correction replaces an earlier one. */
export function DecisionForm(props: {
  meetingId: string;
  meetingShared: boolean;
  defaultLang: "ar" | "en";
  decisions: { id: string; text: string }[];
}) {
  const t = useTranslations("meeting.record");
  const tl = useTranslations("meeting.transcript.langs");
  const { busy, run } = useCall();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState(props.defaultLang);
  const [shared, setShared] = useState(true);
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus />
        {t("addDecision")}
      </Button>
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const ok = await run(
      `/api/meetings/${props.meetingId}/decisions`,
      "POST",
      {
        text: get("text"),
        lang,
        decidedBy: get("decidedBy"),
        supersedesId: get("supersedes"),
        visibility: props.meetingShared && shared ? "shared" : "firm_private",
      },
      t("decisionSaved"),
    );
    if (ok) setOpen(false);
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-2">
        <Label htmlFor="decision-text">{t("decision")}</Label>
        <Textarea id="decision-text" name="text" rows={3} minLength={2} maxLength={4000} required dir="auto" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="decision-by">{t("decidedBy")}</Label>
          <Input id="decision-by" name="decidedBy" maxLength={200} dir="auto" placeholder={t("decidedByHint")} />
        </div>
        {props.decisions.length ? (
          <div className="grid gap-2">
            <Label htmlFor="decision-supersedes">{t("supersedes")}</Label>
            <NativeSelect id="decision-supersedes" name="supersedes" defaultValue="">
              <NativeSelectOption value="">{t("supersedesNone")}</NativeSelectOption>
              {props.decisions.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {d.text.length > 70 ? `${d.text.slice(0, 70)}…` : d.text}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <NativeSelect value={lang} onChange={(e) => setLang(e.target.value as "ar" | "en")} aria-label={t("writtenIn")}>
          <NativeSelectOption value="ar">{tl("ar")}</NativeSelectOption>
          <NativeSelectOption value="en">{tl("en")}</NativeSelectOption>
        </NativeSelect>
        <ShareSwitch id="decision-shared" meetingShared={props.meetingShared} shared={shared} onChange={setShared} />
      </div>
      <p className="text-xs text-muted-foreground">{t("decisionHint")}</p>
      <div className="flex gap-2">
        <Submit busy={busy}>{t("saveDecision")}</Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}

/** A follow-up out of the meeting, optionally following up one of its decisions. */
export function FollowUpForm(props: {
  meetingId: string;
  meetingShared: boolean;
  people: { userId: string; name: string; firm: boolean }[];
  decisions: { id: string; text: string }[];
}) {
  const t = useTranslations("meeting.record");
  const { busy, run } = useCall();
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(true);
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const visibility: Visibility = props.meetingShared && shared ? "shared" : "firm_private";
  // Firm-only follow-ups go to firm staff.
  const people = visibility === "shared" ? props.people : props.people.filter((p) => p.firm);
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus />
        {t("addFollowUp")}
      </Button>
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim() || null;
    const ok = await run(
      `/api/meetings/${props.meetingId}/follow-ups`,
      "POST",
      {
        title: get("title"),
        // End of the chosen day, local time.
        dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null,
        assigneeUserId: people.some((p) => p.userId === assignee) ? assignee : null,
        decisionId: get("decision"),
        visibility,
      },
      t("followUpSaved"),
    );
    if (!ok) return;
    setOpen(false);
    setDue("");
    setAssignee("");
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-2">
        <Label htmlFor="fu-title">{t("followUp")}</Label>
        <Input id="fu-title" name="title" minLength={2} maxLength={300} required dir="auto" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="fu-assignee">{t("assignee")}</Label>
          {/* Starts again when the audience changes, since the list does. */}
          <PersonPicker
            key={visibility}
            id="fu-assignee"
            clearable
            defaultValue={people.some((p) => p.userId === assignee) ? assignee : undefined}
            onValueChange={setAssignee}
            placeholder={t("nobody")}
            options={people.map((p) => ({ value: p.userId, label: p.name }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fu-due">{t("due")}</Label>
          <DatePicker id="fu-due" value={due} onChange={(v) => setDue(v ?? "")} placeholder={t("due")} />
        </div>
      </div>
      {props.decisions.length ? (
        <div className="grid gap-2">
          <Label htmlFor="fu-decision">{t("forDecision")}</Label>
          <NativeSelect id="fu-decision" name="decision" defaultValue="">
            <NativeSelectOption value="">{t("supersedesNone")}</NativeSelectOption>
            {props.decisions.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.text.length > 70 ? `${d.text.slice(0, 70)}…` : d.text}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <ShareSwitch id="fu-shared" meetingShared={props.meetingShared} shared={shared} onChange={setShared} />
      <div className="flex gap-2">
        <Submit busy={busy}>{t("saveFollowUp")}</Submit>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}

/** Done / open again, for the firm and for the person it is assigned to. */
export function FollowUpToggle({ id, status }: { id: string; status: "open" | "done" }) {
  const t = useTranslations("meeting.record");
  const { busy, run } = useCall();
  const done = status === "done";
  return (
    <Button
      size="sm"
      variant={done ? "ghost" : "outline"}
      disabled={busy}
      onClick={() => run(`/api/follow-ups/${id}`, "PATCH", { status: done ? "open" : "done" })}
    >
      {done ? <RotateCcw /> : <Check />}
      {done ? t("reopen") : t("markDone")}
    </Button>
  );
}

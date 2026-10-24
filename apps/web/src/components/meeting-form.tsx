"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { BrandLoader } from "@/components/brand";
import { callApi } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { callProvider, DURATIONS, localInstant, localParts, meetingError } from "@/lib/meetings";

const KINDS = ["kickoff", "status", "steering", "workshop", "handover", "other"] as const;
type Location = "online" | "in_person" | "phone";
type Lang = "ar" | "en" | "mixed";

export interface Invitees {
  people: { userId: string; name: string; firm: boolean }[];
  contacts: { contactId: string; name: string; title: string | null; hasEmail: boolean }[];
}

export interface MeetingValues {
  title: string;
  startsAt: string;
  endsAt: string;
  location: Location;
  joinUrl: string | null;
  locationText: string | null;
  spokenLang: Lang;
}

/**
 * Book a meeting (with its attendees, and the invite sent in the same step),
 * or move and edit one that is still scheduled. Selah links to the call; the
 * organiser makes the Meet link and pastes it here.
 */
export function MeetingForm(props: {
  trigger: ReactNode;
  /** Book on this project, or edit this meeting. */
  projectId?: string;
  meetingId?: string;
  initial?: MeetingValues;
  firm: boolean;
  invitees?: Invitees;
  /** The booker, who attends as organiser. */
  me?: string;
  /** The client's departments: a department's meeting gets an agenda of its work (F31). */
  departments?: { id: string; label: string }[];
}) {
  const t = useTranslations("meeting.form");
  const tm = useTranslations("meeting");
  const tc = useTranslations("common");
  const router = useRouter();
  const editing = Boolean(props.meetingId);
  const start = props.initial ? new Date(props.initial.startsAt) : null;
  const minutes = props.initial ? Math.round((new Date(props.initial.endsAt).getTime() - start!.getTime()) / 60_000) : 60;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(start ? localParts(start).date : "");
  const [time, setTime] = useState(start ? localParts(start).time : "10:00");
  const [duration, setDuration] = useState(String(minutes));
  const [location, setLocation] = useState<Location>(props.initial?.location ?? "online");
  const [link, setLink] = useState(props.initial?.joinUrl ?? "");
  const [shared, setShared] = useState(true);
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Set<string>>(new Set());
  const [send, setSend] = useState(true);

  const linkBad = location === "online" ? !callProvider(link) : link.trim() !== "" && !callProvider(link);
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const startsAt = localInstant(date, time);
    if (!startsAt) return setError("when");
    if (linkBad) return setError("badLink");
    const endsAt = new Date(startsAt.getTime() + Number(duration) * 60_000);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    const values = {
      title: text("title"),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      location,
      joinUrl: link.trim() || (editing ? null : undefined),
      locationText: text("locationText") || (editing ? null : undefined),
      spokenLang: text("spokenLang") as Lang,
    };
    setBusy(true);
    setError(null);
    const r = editing
      ? await callApi(`/api/meetings/${props.meetingId}`, "PATCH", values)
      : await callApi(`/api/projects/${props.projectId}/meetings`, "POST", {
          ...values,
          kind: text("kind"),
          departmentId: text("departmentId") || undefined,
          visibility: props.firm && !shared ? "firm_private" : "shared",
          attendees: [
            ...[...people].map((userId) => ({ userId })),
            ...(props.firm && shared ? [...contacts].map((contactId) => ({ contactId })) : []),
          ],
          sendInvites: send,
        });
    if (r.ok && editing && send) await callApi(`/api/meetings/${props.meetingId}/invites`, "POST");
    setBusy(false);
    if (!r.ok) return setError(meetingError(r.message) ?? r.error);
    setOpen(false);
    toast.success(editing ? tc("saved") : t("booked"));
    if (editing) router.refresh();
    else router.push(`/meetings/${(r.data as { id: string }).id}`);
  }

  const others = props.invitees?.people.filter((p) => p.userId !== props.me) ?? [];
  const firmPeople = others.filter((p) => p.firm);
  const clientPeople = shared ? others.filter((p) => !p.firm) : [];
  const contactList = props.firm && shared ? (props.invitees?.contacts ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("editTitle") : t("bookTitle")}</DialogTitle>
            <DialogDescription>{editing ? t("editHint") : t("bookHint")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <div className="grid gap-2">
              <Label htmlFor="m-title">{t("title")}</Label>
              <Input
                id="m-title"
                name="title"
                required
                minLength={2}
                maxLength={200}
                defaultValue={props.initial?.title}
                dir="auto"
              />
            </div>
            {editing ? null : (
              <div className="grid gap-2">
                <Label htmlFor="m-kind">{t("kind")}</Label>
                <NativeSelect id="m-kind" name="kind" defaultValue="status">
                  {KINDS.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {tm(`kinds.${k}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>

          {!editing && props.departments?.length ? (
            <div className="grid gap-2">
              <Label htmlFor="m-dept">{t("department")}</Label>
              <NativeSelect id="m-dept" name="departmentId" defaultValue="">
                <NativeSelectOption value="">{t("wholeProject")}</NativeSelectOption>
                {props.departments.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">{t("departmentHint")}</p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="m-date">{t("date")}</Label>
              <DatePicker
                id="m-date"
                value={date}
                onChange={(v) => setDate(v ?? "")}
                placeholder={t("date")}
                required
                disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-time">{t("time")}</Label>
              <Input id="m-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required dir="ltr" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-duration">{t("duration")}</Label>
              <NativeSelect id="m-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
                {[...new Set([...DURATIONS, minutes])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <NativeSelectOption key={m} value={String(m)}>
                      {t("minutes", { n: m })}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="m-location">{t("location")}</Label>
              <NativeSelect id="m-location" value={location} onChange={(e) => setLocation(e.target.value as Location)}>
                <NativeSelectOption value="online">{t("locations.online")}</NativeSelectOption>
                <NativeSelectOption value="in_person">{t("locations.in_person")}</NativeSelectOption>
                <NativeSelectOption value="phone">{t("locations.phone")}</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="m-lang">{t("spokenLang")}</Label>
              <NativeSelect id="m-lang" name="spokenLang" defaultValue={props.initial?.spokenLang ?? "ar"}>
                <NativeSelectOption value="ar">{tm("transcript.langs.ar")}</NativeSelectOption>
                <NativeSelectOption value="en">{tm("transcript.langs.en")}</NativeSelectOption>
                <NativeSelectOption value="mixed">{tm("transcript.langs.mixed")}</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="m-link">{location === "online" ? t("link") : t("linkOptional")}</Label>
              <a
                href="https://meet.google.com/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("newMeet")}
                <ExternalLink className="size-3" />
              </a>
            </div>
            <Input
              id="m-link"
              type="url"
              dir="ltr"
              value={link}
              onChange={(e) => (setLink(e.target.value), setError(null))}
              placeholder="https://meet.google.com/abc-defg-hij"
              required={location === "online"}
              maxLength={500}
              aria-invalid={link !== "" && linkBad}
            />
            <p className="text-xs text-muted-foreground">{t("linkHint")}</p>
          </div>
          {location === "online" ? null : (
            <div className="grid gap-2">
              <Label htmlFor="m-place">{location === "phone" ? t("phone") : t("place")}</Label>
              <Input
                id="m-place"
                name="locationText"
                maxLength={300}
                defaultValue={props.initial?.locationText ?? ""}
                dir="auto"
              />
            </div>
          )}

          {!editing && props.firm ? (
            <div className="flex items-start gap-3">
              <Switch id="m-shared" checked={shared} onCheckedChange={setShared} />
              <Label htmlFor="m-shared" className="leading-snug font-normal">
                {shared ? t("shared") : t("firmOnly")}
              </Label>
            </div>
          ) : null}

          {!editing && props.invitees ? (
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{t("attendees")}</legend>
              {firmPeople.length + clientPeople.length + contactList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noInvitees")}</p>
              ) : null}
              {[
                { label: t("firmPeople"), rows: firmPeople },
                { label: t("clientPeople"), rows: clientPeople },
              ].map((g) =>
                g.rows.length ? (
                  <div key={g.label} className="grid gap-2">
                    <p className="text-xs text-muted-foreground">{g.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {g.rows.map((p) => (
                        <label key={p.userId} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={people.has(p.userId)}
                            onCheckedChange={(on) => setPeople(toggle(people, p.userId, on === true))}
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
              {contactList.length ? (
                <div className="grid gap-2">
                  <p className="text-xs text-muted-foreground">{t("contacts")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {contactList.map((c) => (
                      <label key={c.contactId} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={contacts.has(c.contactId)}
                          onCheckedChange={(on) => setContacts(toggle(contacts, c.contactId, on === true))}
                        />
                        <span>
                          {c.name}
                          {c.title ? <span className="text-muted-foreground"> · {c.title}</span> : null}
                          {c.hasEmail ? null : <span className="text-xs text-muted-foreground"> ({t("noEmail")})</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={send} onCheckedChange={(on) => setSend(on === true)} />
            {editing ? t("resend") : t("send")}
          </label>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {["when", "badLink", "cannotOpen", "firmPrivate", "cannotMove"].includes(error)
                ? t(`errors.${error}`)
                : tc(`errors.${error}`)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <BrandLoader tone="current" className="size-4" /> : null}
              {busy ? tc("saving") : editing ? t("save") : t("book")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

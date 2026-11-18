"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CircleAlert } from "@/components/animate-ui/icons/circle-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * The invite warning (decision 1a): people chosen for a meeting of the whole
 * project who could not open it, named before saving, with what to do
 * instead. While booking, the organiser can make it a department's meeting
 * (`offers`); a meeting already booked keeps its department (`booked`).
 * Someone in no department is not included by any department's meeting
 * either, and the warning says so. Saving anyway is allowed; the server
 * decides who opens the meeting.
 */
export function LeftOutWarning(props: {
  people: { name: string; departmentIds: string[] }[];
  /** Departments the organiser may book for that the people left out belong to (booking only). */
  offers?: { id: string; label: string }[];
  onOffer?: (departmentId: string) => void;
  /** The meeting is already booked: its department cannot change. */
  booked?: boolean;
}) {
  const t = useTranslations("meeting.form");
  const format = useFormatter();
  if (!props.people.length) return null;
  const n = props.people.length;
  // Each line names the people it is about: the Arabic says no "him" or "them" (a man's word for a woman).
  const list = (people: { name: string }[]) =>
    format.list(
      people.map((p) => p.name),
      { type: "conjunction" },
    );
  const names = list(props.people);
  const homeless = props.people.filter((p) => p.departmentIds.length === 0);
  const homelessNames = list(homeless);
  const inADepartment = list(props.people.filter((p) => p.departmentIds.length > 0));
  const offers = props.booked ? [] : (props.offers ?? []);
  return (
    <Alert data-testid="meeting-left-out">
      <CircleAlert />
      <AlertDescription className="gap-2">
        <p>{t("leftOut", { names, n })}</p>
        {offers.length ? (
          <div className="flex flex-wrap gap-2">
            {offers.map((d) => (
              <Button key={d.id} type="button" size="sm" variant="outline" onClick={() => props.onOffer?.(d.id)}>
                {t("makeDepartmentMeeting", { department: d.label })}
              </Button>
            ))}
          </div>
        ) : homeless.length === n ? null : (
          <p>{props.booked ? t("leftOutKeepsDepartment", { names: inADepartment }) : t("leftOutNoOffer", { names: inADepartment })}</p>
        )}
        {homeless.length ? <p>{t("leftOutNoDepartment", { n: homeless.length, names: homelessNames })}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

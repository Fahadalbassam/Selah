import "server-only";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import { closingTabShown, projectTabs } from "@/lib/project-tabs";
import { projectAttention } from "./action-board";
import { listAssessments, listTemplates } from "./assessments";
import { getCaseStudyConsent } from "./case-study";
import { listClientRoles } from "./client-roles";
import { getClosure } from "./closure";
import { uploadTargets } from "./files";
import { listReports, projectMetrics, projectProgress } from "./follow-through";
import { getHandover } from "./handover";
import { projectConsultants } from "./help";
import { listInfoRequests } from "./info-requests";
import { sinceLastVisit } from "./insight";
import { listMeetings, meetingInvitees } from "./meetings";
import { planOptions } from "./plan";
import { getPulse } from "./pulse";
import { getProject, planEvidence } from "./queries";
import { getProjectPeople, getProjectTeam } from "./staffing";

// Everything the project page draws, for one reader (page audit 4.3, batch 3).
// Each part comes from the service that owns it, read as the signed-in person
// under row-level security and checked again with authorize(); a part the
// reader may not open is null, and the tab that would hold only it is not
// drawn (lib/project-tabs.ts). Nothing here reads for anyone else.

export async function loadProjectPage(tx: Tx, principal: Principal, id: string) {
  const data = await getProject(tx, principal, id);
  const client = data.project.kind === "client";
  const firmStaff = principal.orgKind === "firm";
  const actionIds = data.recommendations.flatMap((r) => r.actions.map((a) => a.id));
  const closure =
    data.project.state === "draft"
      ? null
      : await getClosure(tx, principal, id).then((c) => (c.firm || c.state === "closing" || c.state === "closed" || c.can.request || c.request ? c : null));
  const page = {
    data,
    // Client projects only; roles that can't read assessments get neither Sources nor the shared list.
    assessments: client ? await listAssessments(tx, principal, id).catch(() => null) : null,
    // Published templates to start from, for firm staff. Not for an observer:
    // the database refuses an assessment of theirs (migration 0034), so the button is not drawn.
    templates:
      client && firmStaff && !principal.observedProjectIds?.has(id)
        ? (await listTemplates(tx, principal)).templates.filter((x) => x.published && !x.archivedAt)
        : null,
    // What this user may add to the plan, with the choices for a new action; null for clients.
    plan: await planOptions(tx, principal, id),
    // The status line under the title and the rule chips on Plan, from the Actions list's own rows.
    attention: await projectAttention(tx, principal, id),
    // The files sent and the last review of each action on the plan (Trace's parts, page audit row 4d).
    evidence: await planEvidence(tx, actionIds),
    team: await getProjectTeam(tx, principal, id),
    // The client's own people on the project: the firm, and the client's admin.
    people: await getProjectPeople(tx, principal, id),
    // Sponsor, coordinator, steering committee, acceptors, observers (client projects).
    roles: client ? await listClientRoles(tx, principal, id) : null,
    // The firm's consultants on the project, for a client reader (until batch 3 only Help named them).
    consultants: client ? await projectConsultants(tx, principal, id) : null,
    firmStaff,
    // Roles that can't read meetings simply get no tab.
    meetings: await listMeetings(tx, principal, id).catch(() => null),
    // Who may book: the list of people to invite, or null.
    invitees: await meetingInvitees(tx, principal, id).catch(() => null),
    me: principal.userId,
    // Reads and comments only here (N6).
    observing: principal.observedProjectIds?.has(id) ?? false,
    // Action owners don't read metrics or reports.
    metrics: await projectMetrics(tx, principal, id)
      .then(async (m) => ({ ...m, progress: await projectProgress(tx, principal, id) }))
      .catch(() => null),
    reports: await listReports(tx, principal, id).catch(() => null),
    // What moved since this person's last visit; the page moves the mark once shown.
    visit: await sinceLastVisit(tx, principal, id).catch(() => null),
    // The firm's handover card (date, sponsor, check-ins); a client's Progress tab does not draw it.
    handover: principal.orgKind === "firm" ? await getHandover(tx, principal, id) : null,
    // What the firm asked the client for (client projects only).
    requests: client ? await listInfoRequests(tx, principal, id).catch(() => null) : null,
    // "Add a file" on Requests and files: this project, when the person may add to it (October review, item 13).
    upload: (await uploadTargets(tx, principal)).projects.find((p) => p.id === id) ?? null,
    // Closing (baseline: Closing). The firm reads it on every signed project; the
    // client once it is closing or closed, or when they may ask the firm to close.
    closure,
    // The closing pulse (F36): the client people asked answer it; the firm admin and the lead read it.
    pulse: client && data.project.state !== "draft" ? await getPulse(tx, principal, id) : null,
    // Case-study consent (F37): on a closing or closed client project, for everyone on it.
    caseStudy: client && data.project.state !== "draft" ? await getCaseStudyConsent(tx, principal, id) : null,
  };
  const tabs = projectTabs({
    meetings: page.meetings !== null,
    progress: page.metrics !== null || data.activity !== null,
    people: !!(page.team || page.people || page.roles || page.consultants),
    closing: closingTabShown(closure && { state: closure.state, request: closure.request, history: closure.history.length }),
  });
  return { ...page, tabs };
}

export type ProjectPageData = Awaited<ReturnType<typeof loadProjectPage>>;

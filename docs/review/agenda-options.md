# The meeting agenda: three options (for Fahad, 17 Nov 2026)

## The situation

Your rule (D8): a person limited to a department sees nothing by title from other departments.

The meeting agenda breaks that rule today. When a meeting is booked, Selah writes one agenda for everyone: every late, waiting and blocked task of the whole project, by name. A manager limited to the Board secretariat reads Finance's and Legal's tasks there.

**This leak is already closed** (batch 0, waiting to merge): a person who cannot open all of the project's work now sees one line, "The agenda is shown to people who can open all of the project's work. Ask the organiser what concerns you." Nobody sees a title they should not.

The question is only **what the agenda should become**, so limited people get a useful agenda instead of that one line.

## The three options side by side

| | **A. Each reader sees their own agenda** (my first recommendation) | **B. Named roles see everything** | **C. The agenda follows the meeting** (from the October research) |
|---|---|---|---|
| How it works | The agenda is no longer one stored text. Each person who opens the meeting sees a list built for them: only tasks they may open, and "2 more tasks in other departments" with no names. | Anyone named in a project role (sponsor, coordinator, steering committee) sees the whole agenda with every task name. Everyone else sees only what they may open. | A meeting can belong to a department. A department's meeting lists only that department's work, and everyone at it sees all of it. A project-wide meeting (the steering meeting) lists everything, and is shown only to people who can open all the project's work; others see the one line above. |
| A department-limited **sponsor or steering member** at the steering meeting sees | Only their own department's tasks, plus a count of the rest | Every task by name | The one line, unless the firm makes them able to open all the project's work |
| A department-limited **manager at her department's meeting** sees | Her department's tasks | Her department's tasks | Her department's tasks, as the full agenda |
| Does it keep your rule? | Yes, everywhere | **No**: named roles see other departments' task names. The promise on the client's own Departments page would have to change, and the assistant would still follow the stricter rule. | Yes |
| What the firm does differently | Nothing | Nothing | Book department meetings for department work, and steering meetings for people who see the whole project (the client admin, the sponsor if not department-limited) |
| Already built? | No | No | **Mostly.** A meeting can already belong to a department and gets that department's agenda (since migration 0021). The steering-meeting rule is the line already in batch 0. |
| Work to build | Medium to large: rebuild the agenda as a live list per reader, change the meeting page, the calendar file stays as it is, tests | Small to medium: a check of the reader's role, plus rewording the Departments page promise | Small: make the department choice visible when booking, say on a steering meeting who sees its agenda, tests |
| Risk | The agenda changes after booking (it is live), so what was discussed is not frozen; the summary keeps the record | Weakens a promise made to clients in writing | A limited person invited to a steering meeting gets no agenda; the organiser must brief them |

## What the research says

- The October research on departments: "Selah should let a meeting carry a department (so the agenda shows only that department's open actions) and let a steering meeting pull open items from every active project." That is option C, and it is already half built.
- It also says the sponsor "chairs steering" and the committee makes cross-department trade-offs. Under your rule, a sponsor limited to one department cannot see the other departments' items under any option except B. In practice the sponsor is usually the CEO and not department-limited; in the sample data he is limited to two departments.
- No comparable product the research studied builds a different agenda per reader.

## My recommendation

**Option C.** It keeps your rule, it is mostly built, and it matches how the research says firms already run meetings: department meetings for department work, a steering meeting for the people who see the whole project. If a department-limited sponsor must chair steering, the firm admin can make the sponsor able to open all of the project's work (remove the department limit for that person), which is a decision about that one person, made openly.

## Two smaller questions I am adding here

**1. Should an action owner see their teammates' tasks?** The privacy helper found that the database lets an action owner read tasks of their own department and company-wide tasks, while every screen is meant to show them only their own. Most screens filter correctly; a few do not (the Files card names a teammate's task as a file's source; the translation feature, the mute list, the "replaced by" line, two notification cases and one progress count). Your earlier decision (22 Oct) says "the team sees each other's work" for files. My recommendation: **an action owner reads only their own tasks, enforced in the database**; teammates' files stay visible as you decided, but without the task names. This closes all of these places at once.

**2. Who may link a business indicator to a recommendation?** Today the client admin can. The October review says the link is the consultant's statement ("this recommendation is expected to move this number"). My recommendation: **the firm only**; the client admin still adds and updates the indicators themselves.

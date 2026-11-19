// What publishing a draft changes against the version in effect (org chart,
// part 5): the units and positions added, moved, renamed and removed, for
// the publishing screen. Pure: it compares two lists the services read, and
// says nothing about whether a change is good. Selah records the structure
// the firm decides; it never judges one.

export interface ChangeUnit {
  id: string;
  parentId: string | null;
  code: string;
  nameAr: string | null;
  nameEn: string | null;
}

export interface ChangePosition {
  id: string;
  /** The same position across versions (positions.lineage_id). */
  lineageId: string;
  unitId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
}

export interface StructureChanges {
  units: {
    added: ChangeUnit[];
    /** Now under another unit (or at the top). */
    moved: { unit: ChangeUnit; from: ChangeUnit | null; to: ChangeUnit | null }[];
    renamed: { unit: ChangeUnit; before: ChangeUnit }[];
    removed: ChangeUnit[];
  };
  positions: {
    added: ChangePosition[];
    /** Now in another unit. */
    moved: { position: ChangePosition; from: ChangeUnit | null; to: ChangeUnit | null }[];
    renamed: { position: ChangePosition; before: ChangePosition }[];
    removed: ChangePosition[];
  };
  /** Nothing added, moved, renamed or removed. */
  none: boolean;
}

/**
 * Compare the draft (`after`) with the version in effect (`before`; empty
 * for a first version). A position is the same across versions when its
 * lineage is; a unit when `sameUnit` says so (the draft's copy of it: the
 * services work that out from how a draft is copied), or else when its code
 * is. Each list keeps the draft's order (the version's for what is removed).
 */
export function structureChanges(
  before: { units: readonly ChangeUnit[]; positions: readonly ChangePosition[] },
  after: { units: readonly ChangeUnit[]; positions: readonly ChangePosition[] },
  sameUnit: (draftUnitId: string) => string | null = () => null,
): StructureChanges {
  const beforeUnit = new Map(before.units.map((u) => [u.id, u]));
  const beforeByCode = new Map(before.units.map((u) => [u.code, u]));
  const afterUnit = new Map(after.units.map((u) => [u.id, u]));
  // Each draft unit's counterpart in the version in effect, at most one each way.
  const match = new Map<string, ChangeUnit>();
  const taken = new Set<string>();
  const pair = (draftUnit: ChangeUnit, b: ChangeUnit | undefined) => {
    if (!b || taken.has(b.id) || match.has(draftUnit.id)) return;
    match.set(draftUnit.id, b);
    taken.add(b.id);
  };
  for (const u of after.units) {
    const id = sameUnit(u.id);
    pair(u, id ? beforeUnit.get(id) : undefined);
  }
  for (const u of after.units) pair(u, beforeByCode.get(u.code));
  const counterpart = new Map([...match].map(([a, b]) => [b.id, a]));
  /** A draft unit, seen from the version in effect: its counterpart there, or null when new. */
  const asBefore = (draftUnitId: string | null) => (draftUnitId ? (match.get(draftUnitId)?.id ?? `new:${draftUnitId}`) : null);
  const name = (x: { nameAr: string | null; nameEn: string | null }) => `${x.nameAr ?? ""}\u0000${x.nameEn ?? ""}`;
  const title = (x: { titleAr: string | null; titleEn: string | null }) => `${x.titleAr ?? ""}\u0000${x.titleEn ?? ""}`;

  const units: StructureChanges["units"] = { added: [], moved: [], renamed: [], removed: [] };
  for (const u of after.units) {
    const b = match.get(u.id);
    if (!b) {
      units.added.push(u);
      continue;
    }
    if (asBefore(u.parentId) !== b.parentId) {
      units.moved.push({ unit: u, from: b.parentId ? (beforeUnit.get(b.parentId) ?? null) : null, to: u.parentId ? (afterUnit.get(u.parentId) ?? null) : null });
    }
    if (name(u) !== name(b)) units.renamed.push({ unit: u, before: b });
  }
  for (const b of before.units) if (!counterpart.has(b.id)) units.removed.push(b);

  const beforePos = new Map(before.positions.map((p) => [p.lineageId, p]));
  const afterLineages = new Set(after.positions.map((p) => p.lineageId));
  const positions: StructureChanges["positions"] = { added: [], moved: [], renamed: [], removed: [] };
  for (const p of after.positions) {
    const b = beforePos.get(p.lineageId);
    if (!b) {
      positions.added.push(p);
      continue;
    }
    if (asBefore(p.unitId) !== b.unitId) positions.moved.push({ position: p, from: beforeUnit.get(b.unitId) ?? null, to: afterUnit.get(p.unitId) ?? null });
    if (title(p) !== title(b)) positions.renamed.push({ position: p, before: b });
  }
  for (const b of before.positions) if (!afterLineages.has(b.lineageId)) positions.removed.push(b);

  const none = [...Object.values(units), ...Object.values(positions)].every((list) => list.length === 0);
  return { units, positions, none };
}

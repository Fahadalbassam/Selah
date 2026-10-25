import { describe, expect, it } from "vitest";
import { traceRoots } from "@/lib/trace";

const row = (nodeType: string, nodeId: string, parentType: string | null = null, parentId: string | null = null) => ({
  nodeType,
  nodeId,
  parentType,
  parentId,
});

describe("traceRoots", () => {
  it("starts the tree at an assessment, not at the findings under it", () => {
    const rows = [
      row("assessment", "a1"),
      row("finding", "f1", "assessment", "a1"),
      row("finding", "f2"),
      row("recommendation", "r1", "finding", "f1"),
    ];
    expect(traceRoots(rows).map((r) => r.nodeId)).toEqual(["a1", "f2"]);
  });

  it("keeps a node whose parent is not visible", () => {
    const rows = [row("finding", "f1", "assessment", "hidden"), row("recommendation", "r1", "finding", "f1")];
    expect(traceRoots(rows).map((r) => r.nodeId)).toEqual(["f1"]);
  });

  it("matches the parent by type as well as id", () => {
    const rows = [row("kpi", "x"), row("recommendation", "r1", "kpi", "x"), row("finding", "f1", "assessment", "x")];
    expect(traceRoots(rows).map((r) => r.nodeId)).toEqual(["x", "f1"]);
  });
});

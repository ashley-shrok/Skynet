import { describe, expect, it } from "vitest";
import { projectLineage } from "./project-lineage";
import type { ProjectRow } from "./conversation-store";

const row = (slug: string, displayName: string, parent?: string, hostId = "6"): ProjectRow => ({
  slug,
  displayName,
  hostId,
  hostname: "skynet",
  archived: false,
  parent: parent ?? null,
});

describe("projectLineage", () => {
  const projects = [
    row("m2", "Morpheus 2"),
    row("m2-runs", "M2 · Runs", "m2"),
    row("deep", "Deep", "m2-runs"),
    row("skynet", "SKYNET"),
    row("m2", "Other host's M2", undefined, "7"),
  ];

  it("names a top-level project alone", () => {
    expect(projectLineage(projects, 6, "skynet")).toEqual(["SKYNET"]);
  });

  it("names every project above a sub-project, top level first", () => {
    expect(projectLineage(projects, 6, "deep")).toEqual(["Morpheus 2", "M2 · Runs", "Deep"]);
  });

  it("is empty with no project, or one that isn't on the agent's host", () => {
    expect(projectLineage(projects, 6, null)).toEqual([]);
    expect(projectLineage(projects, 6, "gone")).toEqual([]);
    expect(projectLineage(projects, 8, "m2")).toEqual([]);
  });

  it("stops where the sidebar does when a parent is missing", () => {
    expect(projectLineage([row("orphan", "Orphan", "gone")], "6", "orphan")).toEqual(["Orphan"]);
  });
});

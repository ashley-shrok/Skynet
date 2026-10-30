import { describe, expect, it } from "vitest";
import {
  planShareChange,
  projectVisibleTo,
  projectsHiding,
  shownAudience,
  ShareError,
  type ShareHostState,
} from "./sharing-plan.js";

function machine(over: Partial<ShareHostState> = {}): ShareHostState {
  return {
    people: ["ana", "bo", "cy"],
    agents: [],
    roles: [],
    projects: [],
    apps: [],
    tasks: [],
    ...over,
  };
}

const agent = (name: string, o: Partial<{ roles: string[]; project: string | null; users: string[] | null }> = {}) => ({
  name,
  label: name.toUpperCase(),
  roles: o.roles ?? [],
  project: o.project ?? null,
  users: o.users ?? null,
});
const role = (name: string, users: string[] | null, instanceWide = false) => ({
  name,
  label: `${name} role`,
  users,
  instanceWide,
});
const project = (slug: string, parent: string | null, users: string[] | null) => ({
  slug,
  label: slug.toUpperCase(),
  parent,
  users,
});

describe("planShareChange — agents", () => {
  it("writes the agent's new list and offers the role that would still hide it", () => {
    const state = machine({
      agents: [agent("scout", { roles: ["painter"], users: ["ana"] })],
      roles: [role("painter", ["ana"])],
    });
    const plan = planShareChange(state, "agent", "scout", { add: ["bo"] });
    expect(plan.added).toEqual(["bo"]);
    expect(plan.rolesToShare).toEqual([{ name: "painter", label: "painter role", people: ["bo"] }]);
    expect(plan.writes).toEqual([{ kind: "agent", slug: "scout", users: ["ana", "bo"] }]);
  });

  it("shares the role too when asked", () => {
    const state = machine({
      agents: [agent("scout", { roles: ["painter"], users: ["ana"] })],
      roles: [role("painter", ["ana"])],
    });
    const plan = planShareChange(state, "agent", "scout", { add: ["bo"] }, { shareRoles: true });
    expect(plan.writes).toContainEqual({ kind: "role", slug: "painter", users: ["ana", "bo"] });
  });

  it("never offers a role kept on every machine", () => {
    const state = machine({
      agents: [agent("scout", { roles: ["shared"], users: ["ana"] })],
      roles: [role("shared", ["ana"], true)],
    });
    const plan = planShareChange(state, "agent", "scout", { add: ["bo"] }, { shareRoles: true });
    expect(plan.rolesToShare).toEqual([]);
    expect(plan.writes).toHaveLength(1);
  });

  it("the first untick of a never-limited agent writes everyone else out", () => {
    const state = machine({ agents: [agent("eve")] });
    const plan = planShareChange(state, "agent", "eve", { remove: ["cy"] });
    expect(plan.removed).toEqual(["cy"]);
    expect(plan.writes).toEqual([{ kind: "agent", slug: "eve", users: ["ana", "bo"] }]);
  });

  it("refuses an empty list and someone not on the machine", () => {
    const state = machine({ agents: [agent("eve", { users: ["ana"] })] });
    expect(() => planShareChange(state, "agent", "eve", { remove: ["ana"] })).toThrow(ShareError);
    expect(() => planShareChange(state, "agent", "eve", { add: ["zed"] })).toThrow(/not someone/);
  });

  it("keeps someone who has lost access when they were already listed", () => {
    const state = machine({ agents: [agent("eve", { users: ["ana", "gone"] })] });
    const plan = planShareChange(state, "agent", "eve", { add: ["bo"] });
    expect(plan.writes[0].users).toEqual(["ana", "gone", "bo"]);
  });
});

describe("planShareChange — roles", () => {
  it("names agents that disappear for the people taken off", () => {
    const state = machine({
      agents: [
        agent("a1", { roles: ["painter"] }),
        agent("a2", { roles: ["painter"], users: ["ana"] }),
        agent("a3", { roles: ["other"] }),
      ],
      roles: [role("painter", ["ana", "bo"]), role("other", null)],
    });
    const plan = planShareChange(state, "role", "painter", { remove: ["bo"] });
    expect(plan.disappearing.map((r) => r.label)).toEqual(["A1"]);
    expect(plan.writes).toEqual([{ kind: "role", slug: "painter", users: ["ana"] }]);
  });

  it("refuses a role kept on every machine", () => {
    const state = machine({ roles: [role("shared", null, true)] });
    expect(() => planShareChange(state, "role", "shared", { remove: ["bo"] })).toThrow(/every machine/);
  });
});

describe("planShareChange — projects", () => {
  const state = () =>
    machine({
      projects: [
        project("garden", null, ["ana"]),
        project("prints", "garden", ["ana"]),
        project("open-sub", "garden", null),
        project("elsewhere", null, ["ana"]),
      ],
      agents: [
        agent("scout", { project: "prints", roles: ["painter"], users: ["ana"] }),
        agent("free", { project: "garden" }),
        agent("out", { project: "elsewhere", users: ["ana"] }),
      ],
      roles: [role("painter", ["ana"])],
    });

  it("sharing reaches sub-projects, agents inside and their roles", () => {
    const plan = planShareChange(state(), "project", "garden", { add: ["bo"] });
    expect(plan.alsoShared).toEqual({
      projects: [{ name: "prints", label: "PRINTS" }],
      agents: [{ name: "scout", label: "SCOUT" }],
      roles: [{ name: "painter", label: "painter role" }],
    });
    expect(plan.writes).toEqual(
      expect.arrayContaining([
        { kind: "project", slug: "garden", users: ["ana", "bo"] },
        { kind: "project", slug: "prints", users: ["ana", "bo"] },
        { kind: "agent", slug: "scout", users: ["ana", "bo"] },
        { kind: "role", slug: "painter", users: ["ana", "bo"] },
      ]),
    );
    expect(plan.writes.some((w) => w.slug === "out" || w.slug === "elsewhere")).toBe(false);
  });

  it("unsharing takes the person off agents inside, writing out never-limited ones", () => {
    const s = state();
    s.projects[0].users = ["ana", "bo"];
    s.projects[1].users = ["ana", "bo"];
    s.agents[0].users = ["ana", "bo"];
    const plan = planShareChange(s, "project", "garden", { remove: ["bo"] });
    expect(plan.alsoUnshared.projects.map((r) => r.label)).toEqual(["PRINTS"]);
    expect(plan.alsoUnshared.agents.map((r) => r.label).sort()).toEqual(["FREE", "SCOUT"]);
    expect(plan.writes).toContainEqual({ kind: "agent", slug: "free", users: ["ana", "cy"] });
    expect(plan.writes.some((w) => w.kind === "role")).toBe(false);
  });

  it("keeps an agent shared when the person is the only one on its list", () => {
    const s = state();
    s.projects[0].users = ["ana", "bo"];
    s.agents[0].users = ["bo"];
    const plan = planShareChange(s, "project", "garden", { remove: ["bo"] });
    expect(plan.keptShared).toEqual([{ agent: { name: "scout", label: "SCOUT" }, people: ["bo"] }]);
    expect(plan.writes.some((w) => w.slug === "scout")).toBe(false);
  });

  it("leaves a sub-project whose list would empty (the chain hides it)", () => {
    const s = state();
    s.projects[0].users = ["ana", "bo"];
    s.projects[1].users = ["bo"];
    const plan = planShareChange(s, "project", "garden", { remove: ["bo"] });
    expect(plan.writes.some((w) => w.slug === "prints")).toBe(false);
  });
});

describe("planShareChange — Share role fix", () => {
  it("shares just the hiding role for someone already on the list, leaving the agent alone", () => {
    const state = machine({
      agents: [agent("scout", { roles: ["painter"], users: ["ana", "bo"] })],
      roles: [role("painter", ["ana"])],
    });
    const plan = planShareChange(state, "agent", "scout", {}, { shareRolesFor: ["bo"] });
    expect(plan.writes).toEqual([{ kind: "role", slug: "painter", users: ["ana", "bo"] }]);
  });

  it("fixing the role of a never-limited agent doesn't write the agent out", () => {
    const state = machine({
      agents: [agent("scout", { roles: ["painter"] })],
      roles: [role("painter", ["ana"])],
    });
    const plan = planShareChange(state, "agent", "scout", {}, { shareRolesFor: ["cy"] });
    expect(plan.writes).toEqual([{ kind: "role", slug: "painter", users: ["ana", "cy"] }]);
  });
});

describe("planShareChange — changes apply to the list as it is now", () => {
  it("an untick never takes off someone another person just added", () => {
    // The caller loaded [ana, bo]; meanwhile cy was added on disk.
    const state = machine({ agents: [agent("eve", { users: ["ana", "bo", "cy"] })] });
    const plan = planShareChange(state, "agent", "eve", { remove: ["bo"] });
    expect(plan.removed).toEqual(["bo"]);
    expect(plan.writes).toEqual([{ kind: "agent", slug: "eve", users: ["ana", "cy"] }]);
  });

  it("ticking someone already on it changes nothing", () => {
    const state = machine({ agents: [agent("eve", { users: ["ana", "bo"] })] });
    expect(planShareChange(state, "agent", "eve", { add: ["bo"] }).writes).toEqual([]);
  });
});

describe("projects hidden by a project above them", () => {
  const state = () =>
    machine({
      projects: [project("top", null, ["ana", "bo"]), project("kid", "top", null)],
    });

  it("a sub-project with no list of its own shows who the projects above let in", () => {
    expect(shownAudience(state(), "project", "kid")).toEqual(["ana", "bo"]);
  });

  it("names the project above that hides it from someone", () => {
    expect(projectsHiding(state().projects, "kid", "cy").map((p) => p.slug)).toEqual(["top"]);
    expect(projectsHiding(state().projects, "kid", "bo")).toEqual([]);
  });

  it("ticking someone on such a sub-project writes its first list from that audience", () => {
    const plan = planShareChange(state(), "project", "kid", { add: ["cy"] });
    expect(plan.writes).toContainEqual({ kind: "project", slug: "kid", users: ["ana", "bo", "cy"] });
  });

  it("judges a hand-edited loop the way the sidebar does", () => {
    const loop = [project("a", "b", null), project("b", "a", ["ana"])];
    // a sits on the loop and is drawn at top level: b's list doesn't hide it.
    expect(projectVisibleTo(loop, "a", "bo")).toBe(true);
    expect(projectVisibleTo(loop, "b", "bo")).toBe(false);
  });
});

describe("apps and scheduled tasks", () => {
  const task = (name: string, roles: string[], users: string[] | null) => ({ name, label: name, roles, users });

  it("an app's change writes only the app", () => {
    const st = machine({ apps: [{ name: "tracker", label: "Tracker", users: null }], agents: [agent("scout", { users: ["ana"] })] });
    const plan = planShareChange(st, "app", "tracker", { remove: ["cy"] });
    expect(plan.writes).toEqual([{ kind: "app", slug: "tracker", users: ["ana", "bo"] }]);
    expect(plan.rolesToShare).toEqual([]);
  });

  it("offers a task's hiding roles, and writes them only when asked", () => {
    const st = machine({ roles: [role("painter", ["ana"])], tasks: [task("morning", ["painter"], ["ana"])] });
    const offered = planShareChange(st, "task", "morning", { add: ["bo"] });
    expect(offered.rolesToShare).toEqual([{ name: "painter", label: "painter role", people: ["bo"] }]);
    expect(offered.writes).toEqual([{ kind: "task", slug: "morning", users: ["ana", "bo"] }]);
    const both = planShareChange(st, "task", "morning", { add: ["bo"] }, { shareRoles: true });
    expect(both.writes).toContainEqual({ kind: "role", slug: "painter", users: ["ana", "bo"] });
  });

  it("refuses emptying a task's list and a task that isn't there", () => {
    const st = machine({ tasks: [task("morning", [], ["ana"])] });
    expect(() => planShareChange(st, "task", "morning", { remove: ["ana"] })).toThrow(ShareError);
    expect(() => planShareChange(st, "task", "nope", { add: ["bo"] })).toThrow(ShareError);
  });
});

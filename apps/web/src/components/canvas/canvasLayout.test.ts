import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import { buildCanvasNodes } from "./canvasLayout";

function project(id: string, title: string): EnvironmentProject {
  return {
    environmentId: "env-1",
    id,
    title,
    workspaceRoot: `/repo/${id}`,
    faviconPath: null,
    projectIcon: null,
  } as unknown as EnvironmentProject;
}

function thread(
  id: string,
  projectId: string,
  updatedAt: string,
  overrides: Partial<Record<keyof EnvironmentThreadShell, unknown>> = {},
): EnvironmentThreadShell {
  return {
    environmentId: "env-1",
    id,
    projectId,
    title: id,
    branch: null,
    updatedAt,
    archivedAt: null,
    lineage: { relationshipToParent: null },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

describe("buildCanvasNodes", () => {
  const projects = [project("quiet", "Quiet"), project("busy", "Busy")];
  const threads = [
    thread("idle", "busy", "2026-10-12T00:00:00.000Z"),
    thread("running", "busy", "2026-10-10T00:00:00.000Z", {
      runtime: { status: "running", activityStartedAt: "2026-10-10T00:00:00.000Z" },
    }),
    thread("archived", "busy", "2026-10-11T00:00:00.000Z", {
      archivedAt: "2026-10-12T00:00:00.000Z",
    }),
    thread("child", "busy", "2026-10-11T00:00:00.000Z", {
      lineage: { relationshipToParent: "subagent" },
    }),
  ];

  it("puts the most recently active project first, each followed by running threads first", () => {
    const nodes = buildCanvasNodes({ projects, threads, showThreads: true });

    expect(nodes.map((node) => node.id)).toEqual([
      "project:env-1:busy",
      "thread:env-1:running",
      "thread:env-1:idle",
      "project:env-1:quiet",
    ]);
    expect(nodes[0]?.data).toMatchObject({
      project: { title: "Busy" },
      threadCount: 2,
      hiddenThreadCount: 0,
      counts: { working: 1, attention: 0, failed: 0, idle: 1 },
    });
    expect(nodes[1]?.parentId).toBe("project:env-1:busy");
    expect(nodes[1]?.data).toMatchObject({
      status: "working",
      activeSince: "2026-10-10T00:00:00.000Z",
    });
  });

  it("hides thread nodes while zoomed out", () => {
    const nodes = buildCanvasNodes({ projects, threads, showThreads: false });

    expect(nodes.filter((node) => node.type === "thread").every((node) => node.hidden)).toBe(true);
    expect(nodes.filter((node) => node.type === "project").some((node) => node.hidden)).toBe(false);
  });
});

import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { Node } from "@xyflow/react";

import {
  filterSidebarV2VisibleThreads,
  resolveSidebarThreadStatus,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import type { ProjectFaviconProject } from "../ProjectFavicon";

/** Below this zoom the canvas shows project names only; at or above it, their threads. */
export const CANVAS_THREAD_ZOOM = 0.6;
/** The initial fit never zooms past this, so the canvas opens on the project overview. */
export const CANVAS_INITIAL_MAX_ZOOM = 0.5;

export const PROJECT_NODE_WIDTH = 280;
export const PROJECT_HEADER_HEIGHT = 36;
export const THREAD_ROW_HEIGHT = 28;
/** Rows past this collapse into a "+N more" footer; active threads sort first. */
const MAX_THREAD_ROWS = 10;
const PROJECT_GAP = 64;

/** How a project's threads split across the states worth seeing at a glance. */
export type CanvasStatusCounts = {
  working: number;
  attention: number;
  failed: number;
  idle: number;
};

export type ProjectNodeData = {
  project: ProjectFaviconProject;
  threadCount: number;
  hiddenThreadCount: number;
  counts: CanvasStatusCounts;
};

export type ThreadNodeData = {
  title: string;
  status: SidebarThreadStatus;
  /** When the current activity started, for working threads. */
  activeSince: string | null;
  updatedAt: string;
  threadRef: ScopedThreadRef;
};

export type ProjectNode = Node<ProjectNodeData, "project">;
export type ThreadNode = Node<ThreadNodeData, "thread">;
export type CanvasNode = ProjectNode | ThreadNode;

function projectKey(item: { environmentId: string; projectId: string }) {
  return `${item.environmentId}:${item.projectId}`;
}

function statusBucket(status: SidebarThreadStatus): keyof CanvasStatusCounts {
  if (status === "working") return "working";
  if (status === "approval" || status === "input") return "attention";
  if (status === "failed" || status === "limited") return "failed";
  return "idle";
}

const BUCKET_ORDER: Record<keyof CanvasStatusCounts, number> = {
  working: 0,
  attention: 1,
  failed: 2,
  idle: 3,
};

/**
 * Lays every project out as a UML-style box: a header, then one row per
 * thread, running threads first. Boxes are packed into rows, most recently
 * active project first. Thread rows are child nodes so later work can draw
 * edges between threads; they stay in the list while hidden so React Flow
 * keeps their identity across zoom changes.
 */
export function buildCanvasNodes(input: {
  projects: ReadonlyArray<EnvironmentProject>;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  showThreads: boolean;
}): CanvasNode[] {
  const threadsByProject = new Map<
    string,
    Array<{ thread: EnvironmentThreadShell; status: SidebarThreadStatus }>
  >();
  for (const thread of filterSidebarV2VisibleThreads(input.threads, null)) {
    const key = projectKey(thread);
    const entry = { thread, status: resolveSidebarThreadStatus(thread) };
    const list = threadsByProject.get(key);
    if (list) list.push(entry);
    else threadsByProject.set(key, [entry]);
  }
  for (const list of threadsByProject.values()) {
    list.sort(
      (a, b) =>
        BUCKET_ORDER[statusBucket(a.status)] - BUCKET_ORDER[statusBucket(b.status)] ||
        b.thread.updatedAt.localeCompare(a.thread.updatedAt),
    );
  }

  const boxes = input.projects
    .map((project) => {
      const threads =
        threadsByProject.get(
          projectKey({ environmentId: project.environmentId, projectId: project.id }),
        ) ?? [];
      const latest = threads.reduce(
        (max, { thread }) => (thread.updatedAt > max ? thread.updatedAt : max),
        "",
      );
      const rows = threads.slice(0, MAX_THREAD_ROWS);
      // One extra row holds either the empty state or the "+N more" footer.
      const footerRows = threads.length === 0 || threads.length > rows.length ? 1 : 0;
      return {
        project,
        threads,
        rows,
        latest,
        height: PROJECT_HEADER_HEIGHT + (rows.length + footerRows) * THREAD_ROW_HEIGHT,
      };
    })
    .sort(
      (a, b) => b.latest.localeCompare(a.latest) || a.project.title.localeCompare(b.project.title),
    );

  // Aim for a roughly square overall layout.
  const totalArea = boxes.reduce((sum, box) => sum + PROJECT_NODE_WIDTH * box.height, 0);
  const columns = Math.max(
    1,
    Math.round(Math.sqrt(totalArea) / (PROJECT_NODE_WIDTH + PROJECT_GAP)),
  );

  const nodes: CanvasNode[] = [];
  let y = 0;
  let rowHeight = 0;

  boxes.forEach(({ project, threads, rows, height }, index) => {
    const column = index % columns;
    if (column === 0 && index > 0) {
      y += rowHeight + PROJECT_GAP;
      rowHeight = 0;
    }
    rowHeight = Math.max(rowHeight, height);

    const projectNodeId = `project:${projectKey({ environmentId: project.environmentId, projectId: project.id })}`;
    const counts: CanvasStatusCounts = { working: 0, attention: 0, failed: 0, idle: 0 };
    for (const { status } of threads) counts[statusBucket(status)] += 1;

    nodes.push({
      id: projectNodeId,
      type: "project",
      position: { x: column * (PROJECT_NODE_WIDTH + PROJECT_GAP), y },
      width: PROJECT_NODE_WIDTH,
      height,
      data: {
        project: {
          environmentId: project.environmentId,
          workspaceRoot: project.workspaceRoot,
          title: project.title,
          faviconPath: project.faviconPath,
          projectIcon: project.projectIcon,
        },
        threadCount: threads.length,
        hiddenThreadCount: threads.length - rows.length,
        counts,
      },
    });

    rows.forEach(({ thread, status }, rowIndex) => {
      nodes.push({
        id: `thread:${thread.environmentId}:${thread.id}`,
        type: "thread",
        parentId: projectNodeId,
        extent: "parent",
        hidden: !input.showThreads,
        position: { x: 0, y: PROJECT_HEADER_HEIGHT + rowIndex * THREAD_ROW_HEIGHT },
        width: PROJECT_NODE_WIDTH,
        height: THREAD_ROW_HEIGHT,
        data: {
          title: thread.title,
          status,
          activeSince: status === "working" ? (thread.runtime?.activityStartedAt ?? null) : null,
          updatedAt: thread.updatedAt,
          threadRef: { environmentId: thread.environmentId, threadId: thread.id },
        },
      });
    });
  });

  return nodes;
}

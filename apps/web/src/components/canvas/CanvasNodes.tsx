import { useStore, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatElapsedDurationLabel } from "~/timestampFormat";

import { ProjectFavicon } from "../ProjectFavicon";
import type { SidebarThreadStatus } from "../Sidebar.logic";
import {
  CANVAS_THREAD_ZOOM,
  PROJECT_HEADER_HEIGHT,
  PROJECT_NODE_WIDTH,
  THREAD_ROW_HEIGHT,
  type CanvasStatusCounts,
  type ProjectNode,
  type ThreadNode,
} from "./canvasLayout";

// Same hues the sidebar uses, so a thread reads the same color everywhere.
const STATUS_DOT: Record<SidebarThreadStatus, string> = {
  working: "bg-info",
  waiting: "bg-muted-foreground/40",
  approval: "bg-warning",
  input: "bg-indigo-500",
  limited: "bg-warning",
  failed: "bg-error",
  ready: "bg-muted-foreground/40",
};

const STATUS_SEGMENTS: ReadonlyArray<{ key: keyof CanvasStatusCounts; className: string }> = [
  { key: "working", className: "bg-info" },
  { key: "attention", className: "bg-warning" },
  { key: "failed", className: "bg-error" },
  { key: "idle", className: "bg-muted-foreground/25" },
];

/** The project's thread statuses as one strip under the header. */
function StatusStrip({ counts, height }: { counts: CanvasStatusCounts; height: number }) {
  const total = counts.working + counts.attention + counts.failed + counts.idle;
  return (
    <div className="flex w-full shrink-0 bg-border" style={{ height }}>
      {total === 0
        ? null
        : STATUS_SEGMENTS.map(({ key, className }) =>
            counts[key] === 0 ? null : (
              <div
                key={key}
                className={className}
                style={{ width: `${(counts[key] / total) * 100}%` }}
              />
            ),
          )}
    </div>
  );
}

function summarize(counts: CanvasStatusCounts, threadCount: number) {
  const parts = [
    counts.working > 0 ? `${counts.working} running` : null,
    counts.attention > 0 ? `${counts.attention} need you` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
  ].filter((part) => part !== null);
  if (parts.length > 0) return parts.join(" · ");
  return threadCount === 1 ? "1 thread" : `${threadCount} threads`;
}

// Quantized so project nodes re-render on zoom steps, not on every frame.
const selectOverviewZoom = (state: { transform: [number, number, number] }) => {
  const zoom = state.transform[2];
  return zoom >= CANVAS_THREAD_ZOOM ? null : Math.max(0.05, Math.round(zoom * 40) / 40);
};

/**
 * Zoomed out, the whole box becomes the header: icon and name sized to stay
 * readable on screen, bounded by what fits inside the box.
 */
function ProjectOverview({
  data,
  zoom,
  boxHeight,
}: {
  data: ProjectNode["data"];
  zoom: number;
  boxHeight: number;
}) {
  // Rough glyph width of 0.6em, plus room for the icon and padding.
  const fitsWidth = PROJECT_NODE_WIDTH / (0.6 * Math.max(data.project.title.length, 4) + 2.5);
  const fontSize = Math.min(14 / zoom, fitsWidth, boxHeight * 0.4);
  const stripHeight = Math.min(3 / zoom, boxHeight * 0.08);

  return (
    <div className="flex size-full flex-col overflow-hidden border border-border bg-muted">
      <div
        className="flex min-h-0 flex-1 items-center"
        style={{ gap: fontSize * 0.4, paddingInline: fontSize * 0.5 }}
      >
        <span className="flex shrink-0" style={{ width: fontSize, height: fontSize }}>
          <ProjectFavicon project={data.project} className="size-full" />
        </span>
        <span
          className="min-w-0 truncate font-semibold leading-none text-foreground"
          style={{ fontSize }}
        >
          {data.project.title}
        </span>
      </div>
      <StatusStrip counts={data.counts} height={stripHeight} />
    </div>
  );
}

export const CanvasProjectNode = memo(function CanvasProjectNode({
  data,
  height,
}: NodeProps<ProjectNode>) {
  const overviewZoom = useStore(selectOverviewZoom);

  if (overviewZoom !== null) {
    return (
      <ProjectOverview
        data={data}
        zoom={overviewZoom}
        boxHeight={height ?? PROJECT_HEADER_HEIGHT + THREAD_ROW_HEIGHT}
      />
    );
  }

  const footer =
    data.threadCount === 0
      ? "No threads"
      : data.hiddenThreadCount > 0
        ? `+${data.hiddenThreadCount} more`
        : null;

  // Thread rows are separate child nodes drawn over the body of this box.
  return (
    <div className="flex size-full flex-col overflow-hidden border border-border bg-card">
      <div
        className="flex shrink-0 items-center gap-2 bg-muted px-2.5"
        style={{ height: PROJECT_HEADER_HEIGHT - 2 }}
      >
        <ProjectFavicon project={data.project} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {data.project.title}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {summarize(data.counts, data.threadCount)}
        </span>
      </div>
      <StatusStrip counts={data.counts} height={2} />
      {footer ? (
        <div
          className="mt-auto flex shrink-0 items-center px-2.5 text-2xs text-muted-foreground"
          style={{ height: THREAD_ROW_HEIGHT }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
});

export const CanvasThreadNode = memo(function CanvasThreadNode({ data }: NodeProps<ThreadNode>) {
  // Subscribed only to re-render once a minute so the elapsed label stays current.
  useNowMinute();
  const elapsed = formatElapsedDurationLabel(data.activeSince ?? data.updatedAt);

  return (
    <div className="flex size-full cursor-pointer items-center gap-2 border-b border-border px-2.5 hover:bg-accent">
      <span className={cn("size-1.5 shrink-0", STATUS_DOT[data.status])} />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{data.title}</span>
      <span
        className={cn(
          "shrink-0 text-2xs tabular-nums",
          data.status === "working" ? "text-info" : "text-muted-foreground",
        )}
      >
        {elapsed}
      </span>
    </div>
  );
});

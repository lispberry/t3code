import "@xyflow/react/dist/style.css";

import { useNavigate } from "@tanstack/react-router";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useStore,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useMemo, type CSSProperties } from "react";

import { isElectron } from "../../env";
import { useTheme } from "../../hooks/useTheme";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { CanvasProjectNode, CanvasThreadNode } from "./CanvasNodes";
import {
  buildCanvasNodes,
  CANVAS_INITIAL_MAX_ZOOM,
  CANVAS_THREAD_ZOOM,
  type CanvasNode,
} from "./canvasLayout";

const nodeTypes: NodeTypes = {
  project: CanvasProjectNode,
  thread: CanvasThreadNode,
};

// Let the page background show through instead of React Flow's own fill.
const TRANSPARENT_BACKGROUND = { "--xy-background-color": "transparent" } as CSSProperties;

const FIT_VIEW_OPTIONS = { maxZoom: CANVAS_INITIAL_MAX_ZOOM };

const selectShowThreads = (state: { transform: [number, number, number] }) =>
  state.transform[2] >= CANVAS_THREAD_ZOOM;

function CanvasFlow() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const projects = useProjects();
  const threads = useThreadShells();
  const showThreads = useStore(selectShowThreads);
  const nodes = useMemo(
    () => buildCanvasNodes({ projects, threads, showThreads }),
    [projects, threads, showThreads],
  );

  const onNodeClick = useCallback<NodeMouseHandler<CanvasNode>>(
    (_event, node) => {
      if (node.type !== "thread") return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(node.data.threadRef),
      });
    },
    [navigate],
  );

  return (
    <ReactFlow<CanvasNode>
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      colorMode={resolvedTheme}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.05}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements
      style={TRANSPARENT_BACKGROUND}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function CanvasPage() {
  const projectsReady = useAllEnvironmentProjectSnapshotsReady();
  const shellsReady = useAllEnvironmentShellsBootstrapped();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <h1 className="text-sm font-medium">Canvas</h1>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1">
          {/* fitView only runs on the first layout, so wait for real data. */}
          {projectsReady && shellsReady ? (
            <ReactFlowProvider>
              <CanvasFlow />
            </ReactFlowProvider>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

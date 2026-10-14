import { createFileRoute } from "@tanstack/react-router";

import { CanvasPage } from "../components/canvas/CanvasPage";

export const Route = createFileRoute("/_chat/canvas")({
  component: CanvasPage,
});

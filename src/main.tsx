import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { progressStore } from "./storage/progress-store";
import "./ui/theme.css";
import "./ui/app.css";

// Load the progress file before first paint so no screen renders with empty state
// and then jumps once progress arrives.
await progressStore.load();

const container = document.getElementById("root");
if (!container) throw new Error("No #root element to mount into.");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

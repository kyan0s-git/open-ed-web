import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { progressStore } from "./storage/progress-store";
import { readSyncConfig } from "./sync/config";
import { installDesktopHandlers } from "./desktop";
import "./ui/theme.css";
import "./ui/app.css";

// Load the progress file before first paint so no screen renders with empty state
// and then jumps once progress arrives.
await progressStore.load();

installDesktopHandlers();

// Sync only loads on devices that have turned it on.
if (readSyncConfig()) void import("./sync/engine").then(({ syncEngine }) => syncEngine.start());

const container = document.getElementById("root");
if (!container) throw new Error("No #root element to mount into.");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Finish reading any course PDFs into search that an earlier session left unfinished.
// Deferred until the browser is idle, and it loads nothing heavy when nothing is pending.
const resumeIndexing = () => void import("./search/pdf-indexer").then(({ indexPdfText }) => indexPdfText());
if ("requestIdleCallback" in window) requestIdleCallback(resumeIndexing, { timeout: 5000 });
else setTimeout(resumeIndexing, 3000);

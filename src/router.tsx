import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/RootLayout";

/**
 * Routes are declared in code rather than generated from files: the app has a small,
 * fixed set of screens, and this keeps the build to plain Vite with no route codegen
 * step.
 *
 * Every screen is lazy, including the library: the library needs the content database
 * and the reader needs the archive reader and sanitizer, and none of that belongs in
 * the first payload. The initial chunk is the shell and the progress file, nothing more.
 */

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./routes/LibraryPage"), "LibraryPage"),
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: lazyRouteComponent(() => import("./routes/ImportPage"), "ImportPage"),
});

const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$courseId",
  component: lazyRouteComponent(() => import("./routes/CoursePage"), "CoursePage"),
});

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$courseId/p/$pageUid",
  component: lazyRouteComponent(() => import("./routes/ContentPage"), "ContentPage"),
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: lazyRouteComponent(() => import("./routes/ReviewPage"), "ReviewPage"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./routes/SettingsPage"), "SettingsPage"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  importRoute,
  courseRoute,
  pageRoute,
  reviewRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

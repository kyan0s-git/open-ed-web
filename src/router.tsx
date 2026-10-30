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
  component: lazyRouteComponent(() => import("./routes/DashboardPage"), "DashboardPage"),
});

const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses",
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

/** Optional: open a PDF at a page, and highlight words a search matched. */
export interface ContentSearch {
  page?: number;
  q?: string;
}

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$courseId/p/$pageUid",
  validateSearch: (search: Record<string, unknown>): ContentSearch => ({
    page: Number(search.page) > 0 ? Math.floor(Number(search.page)) : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
  component: lazyRouteComponent(() => import("./routes/ContentPage"), "ContentPage"),
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: lazyRouteComponent(() => import("./routes/ReviewPage"), "ReviewPage"),
});

export interface SearchPageSearch {
  q?: string;
  course?: string;
  kind?: string;
}

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>): SearchPageSearch => ({
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    course: typeof search.course === "string" && search.course ? search.course : undefined,
    kind: typeof search.kind === "string" && search.kind ? search.kind : undefined,
  }),
  component: lazyRouteComponent(() => import("./routes/SearchPage"), "SearchPage"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./routes/SettingsPage"), "SettingsPage"),
});

const pairRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pair",
  component: lazyRouteComponent(() => import("./routes/PairPage"), "PairPage"),
});

const routeTree = rootRoute.addChildren([
  pairRoute,
  indexRoute,
  coursesRoute,
  importRoute,
  courseRoute,
  pageRoute,
  reviewRoute,
  searchRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  defaultPreload: "intent",
  // Long course pages: start each one at the top, restore position on back/forward.
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

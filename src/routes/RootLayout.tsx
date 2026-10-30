import { useEffect } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useDueCount } from "@/mastery/useProgress";
import { Icon, type IconName } from "@/ui/icons";
import {
  effectiveTheme,
  nextPreference,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from "@/ui/theme";

const THEME_ICON: Record<ThemePreference, IconName> = {
  system: "system",
  light: "sun",
  dark: "moon",
};

export function RootLayout() {
  const due = useDueCount();
  const theme = useThemePreference();
  const next = nextPreference(theme);
  useSearchShortcut();

  return (
    <div className="shell">
      <a href="#content" className="sr-only">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="open-ed-web, dashboard">
          <span className="brand__mark" aria-hidden="true">
            o
          </span>
          <span className="brand__name">open-ed-web</span>
        </Link>

        <nav className="topnav" aria-label="Main">
          <NavItem to="/" icon="home" label="Dashboard" exact />
          <NavItem to="/courses" icon="courses" label="Courses" />
          <Link to="/review">
            <Icon name="review" />
            <span className="topnav__label">Review</span>
            {due > 0 && (
              <span className="badge">
                {due}
                <span className="sr-only"> due</span>
              </span>
            )}
          </Link>
          <NavItem to="/import" icon="upload" label="Import" />
        </nav>

        <div className="topbar__actions">
          <Link to="/search" className="searchlink" aria-label="Search" title="Search (press /)">
            <Icon name="search" />
            <span className="searchlink__label">Search</span>
            <kbd className="searchlink__kbd">/</kbd>
          </Link>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setThemePreference(next)}
            aria-label={`Theme: ${theme === "system" ? `system (${effectiveTheme(theme)})` : theme}. Switch to ${next}.`}
            title={`Theme: ${theme}`}
          >
            <Icon name={THEME_ICON[theme]} />
          </button>
          <Link to="/settings" className="iconbtn" aria-label="Settings" title="Settings">
            <Icon name="settings" />
          </Link>
        </div>
      </header>

      <main id="content">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * "/" (or Ctrl/Cmd+K) opens search from anywhere, unless the learner is typing. From
 * inside a course the search starts scoped to that course.
 */
function useSearchShortcut() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const commandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!slash && !commandK) return;

      event.preventDefault();
      const course = pathname.match(/\/c\/([^/]+)/)?.[1];
      void navigate({ to: "/search", search: { course } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);
}

function NavItem({
  to,
  icon,
  label,
  exact,
}: {
  to: "/" | "/courses" | "/import";
  icon: IconName;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link to={to} activeOptions={{ exact }}>
      <Icon name={icon} />
      <span className="topnav__label">{label}</span>
    </Link>
  );
}

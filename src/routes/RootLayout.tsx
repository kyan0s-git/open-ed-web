import { Link, Outlet } from "@tanstack/react-router";
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

import { Link, Outlet } from "@tanstack/react-router";
import { useDueCount } from "@/mastery/useProgress";

export function RootLayout() {
  const due = useDueCount();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="topbar__mark">
          open&#8209;ed&#8209;web
        </Link>
        <nav>
          <Link to="/" activeOptions={{ exact: true }}>
            Courses
          </Link>
          <Link to="/review">
            Review
            {due > 0 && (
              <span className="topbar__due">
                {due}
                <span className="sr-only"> items due</span>
              </span>
            )}
          </Link>
          <Link to="/import">Import</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

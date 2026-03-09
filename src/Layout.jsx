import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { LogOut, Shield, Sprout, User } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const HOME_PATH = "/";
const HOME_ALIAS = createPageUrl("Home");

export default function Layout({ children, currentPageName: _currentPageName }) {
  const location = useLocation();
  const { user: currentUser, logout } = useAuth();

  const navItems = useMemo(
    () => [
      { name: "Home", path: HOME_PATH },
      { name: "Diagnose", path: createPageUrl("Diagnose") },
      { name: "History", path: createPageUrl("Dashboard") },
      { name: "Schedule", path: createPageUrl("Schedule") },
      { name: "Planner", path: createPageUrl("Planner") },
      { name: "Chat", path: createPageUrl("Chat") },
      { name: "Community", path: createPageUrl("Community") },
      { name: "Treatments", path: createPageUrl("Treatments") },
    ],
    []
  );

  const pathname = location.pathname.toLowerCase();
  const isHome = pathname === HOME_PATH || pathname === HOME_ALIAS;

  const handleLogout = async () => {
    await logout(true);
  };

  const isItemActive = (item) => {
    if (item.name === "Home") return isHome;
    return pathname === item.path.toLowerCase();
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-violet-100/80 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-10">
          <Link to={HOME_PATH} className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 p-2.5 text-white shadow-lg shadow-cyan-500/30">
              <Sprout className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <p className="app-brand text-[1.78rem] font-semibold sm:text-[2.35rem]">AEROVANTA</p>
            </div>
          </Link>

          <nav className="flex max-w-full flex-1 items-center justify-center overflow-x-auto">
            <div className="flex min-w-max items-center gap-1 rounded-2xl bg-white/60 p-1.5 backdrop-blur-lg">
              {navItems.map((item) => {
                const active = isItemActive(item);
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                      active
                        ? "bg-violet-100 text-violet-700"
                        : "text-slate-700 hover:bg-violet-50/80 hover:text-violet-700"
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
              {currentUser?.role === "admin" ? (
                <Link
                  to={createPageUrl("Admin")}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                    pathname === createPageUrl("Admin")
                      ? "bg-violet-100 text-violet-700"
                      : "text-slate-700 hover:bg-violet-50/80 hover:text-violet-700"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Admin
                  </span>
                </Link>
              ) : null}
            </div>
          </nav>          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-rose-200 bg-white/80 px-4 text-sm font-medium text-rose-600 transition-all hover:bg-rose-50"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>

            <Link
              to={createPageUrl("Profile")}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all ${
                pathname === createPageUrl("Profile")
                  ? "border-violet-200 bg-violet-100 text-violet-700"
                  : "border-white/70 bg-white/65 text-violet-600 hover:bg-violet-100/70"
              }`}
            >
              <User className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}

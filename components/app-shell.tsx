"use client";

import {
  Activity,
  ArrowUpRight,
  Boxes,
  Clock3,
  FolderDown,
  Gauge,
  HardDrive,
  LogOut,
  MessageSquareText,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Brand } from "./brand";
import { FeedbackWidget } from "./feedback-widget";
import { apiRequest } from "@/lib/client-api";

const navItems = [
  { href: "/", label: "Create", caption: "Optimize a video", icon: Gauge },
  { href: "/exports", label: "Exports", caption: "Finished files", icon: FolderDown },
  { href: "/history", label: "History", caption: "Recent activity", icon: Clock3 },
  { href: "/storage", label: "Storage", caption: "Manage local files", icon: HardDrive },
  { href: "/diagnostics", label: "Diagnostics", caption: "Check your system", icon: Activity },
  { href: "/settings", label: "Settings", caption: "Processing defaults", icon: Settings },
];

const pageNames: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Create", title: "Video workspace" },
  "/exports": { eyebrow: "Library", title: "Completed exports" },
  "/history": { eyebrow: "Activity", title: "Processing history" },
  "/storage": { eyebrow: "Local files", title: "Storage management" },
  "/diagnostics": { eyebrow: "System", title: "Diagnostics" },
  "/settings": { eyebrow: "Preferences", title: "Settings" },
  "/feedback": { eyebrow: "Developer", title: "Feedback inbox" },
};

export function AppShell({ children, user }: { children: ReactNode; user: { email: string; role: "admin" | "user" } }) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const page = pageNames[path] ?? pageNames["/"];
  const visibleNavItems = user.role === "admin" ? [...navItems, { href: "/feedback", label: "Feedback", caption: "User reports", icon: MessageSquareText }] : navItems;
  async function logout() { await apiRequest("/api/auth/logout", { method: "POST", body: "{}" }); window.location.assign("/login"); }

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      window.setTimeout(() => menuButtonRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  function trapMenuFocus(event: KeyboardEvent<HTMLElement>) {
    if (!menuOpen || event.key !== "Tab") return;
    const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="app-frame">
      <aside
        ref={sidebarRef}
        id="primary-sidebar"
        className={`sidebar ${menuOpen ? "is-open" : ""}`}
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label={menuOpen ? "Application navigation" : undefined}
        onKeyDown={trapMenuFocus}
      >
        <div className="sidebar-head">
          <Brand />
          <button ref={closeButtonRef} className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={19} />
          </button>
        </div>
        <div className="privacy-chip">
          <ShieldCheck size={15} />
          <span>
            <strong>Account protected</strong>
            <small>Your workspace is separated</small>
          </span>
        </div>
        <p className="nav-label">Workspace</p>
        <nav className="side-nav" aria-label="Primary navigation">
          {visibleNavItems.map(({ href, label, caption, icon: Icon }) => {
            const active = href === "/" ? path === href : path.startsWith(href);
            return (
              <Link
                href={href}
                key={href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span className="nav-copy"><strong>{label}</strong><small>{caption}</small></span>
                <i className="nav-indicator" aria-hidden="true" />
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="owner-card">
            <span className="owner-avatar" aria-hidden="true">{user.email.slice(0,1).toUpperCase()}</span>
            <span>
              <strong>{user.email}</strong>
              <small><i /> {user.role === "admin" ? "Administrator" : "Creator account"}</small>
            </span>
            <button className="icon-button" onClick={()=>void logout()} aria-label="Log out"><LogOut size={16}/></button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="menu-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}

      <main className="app-main">
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="icon-button menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            aria-controls="primary-sidebar"
          >
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
          </div>
          <div className="topbar-state" aria-label="System status">
            <span><Boxes size={15} /><b>Local engine</b><small>On-device</small></span>
            <Link href="/diagnostics" className="status-dot"><i /> System check <ArrowUpRight size={13} /></Link>
          </div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
      <FeedbackWidget />

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 4).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === href : path.startsWith(href);
          return (
            <Link href={href} key={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={19} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open more navigation options">
          <Menu size={19} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}

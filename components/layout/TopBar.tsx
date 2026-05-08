"use client";

import { useState, useRef, useEffect } from "react";

import Image from "next/image";
import Link from "next/link";

import logo from "@/public/images/logo.png";
import { ThemeToggle } from "@/lib/theme/ThemeToggle";
import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/AuthContext";
import NotificationBell from "@/components/NotificationBell";

import SearchModal from "./SearchModal";

function HamburgerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      {...props}
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
    </svg>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      {...props}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </svg>
  );
}


function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 00.12-.64l-2-3.46a.5.5 0 00-.61-.22l-2.49 1a7.03 7.03 0 00-1.69-.98l-.38-2.65A.49.49 0 0014 2h-4a.49.49 0 00-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 00-.61.22l-2 3.46a.5.5 0 00.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 00-.12.64l2 3.46a.5.5 0 00.61.22l2.49-1c.52.39 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65a7.03 7.03 0 001.69-.98l2.49 1a.5.5 0 00.61-.22l2-3.46a.5.5 0 00-.12-.64l-2.11-1.65zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
    </svg>
  );
}

function ProfileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

type TopBarProps = {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleMobileMenu?: () => void;
  isMobileMenuOpen?: boolean;
};

export default function TopBar({
  isSidebarCollapsed,
  onToggleSidebar,
  onToggleMobileMenu,
  isMobileMenuOpen = false,
}: TopBarProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const { user, logout } = useAuth();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    setIsProfileDropdownOpen(false);
  };

  const getUserInitials = () => {
    if (!user?.name) return "U";
    return user.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur transition-colors duration-300 ${
          isDark
            ? "border-dark-border bg-dark-card/95"
            : "border-light-grey bg-pure-white/95"
        }`}
      >
        <div className="flex items-center justify-between gap-2 sm:gap-4 px-4 py-3 sm:px-6 lg:px-10 min-w-0">
          {/* Left side */}
          <div className="flex items-center shrink-0 min-w-0">
            {/* Hamburger – desktop (toggles sidebar) */}
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-pressed={!isSidebarCollapsed}
              aria-label="Toggle sidebar"
              className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-blue dark:text-[var(--color-brand-soft)] transition hover:bg-light-blue/40 dark:hover:bg-[var(--color-hover)]"
            >
              <HamburgerIcon className="h-6 w-6" />
            </button>

            {/* Mobile hamburger (toggles mobile menu) */}
            <button
              type="button"
              onClick={onToggleMobileMenu}
              aria-pressed={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              className={`flex md:hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-primary-blue dark:text-[var(--color-brand-soft)] transition hover:bg-light-blue/40 dark:hover:bg-[var(--color-hover)] ${
                isDark ? "border-dark-border" : "border-light-blue"
              }`}
            >
              {isMobileMenuOpen ? (
                <CloseIcon className="h-6 w-6" />
              ) : (
                <HamburgerIcon className="h-6 w-6" />
              )}
            </button>

            {/* Dynamic spacer – adjusts based on sidebar state (desktop only) */}
            <div
              className={`hidden md:block shrink-0 transition-[width] duration-200 ${
                isSidebarCollapsed ? "w-4" : "w-40 lg:w-52 xl:w-64"
              }`}
            />

            {/* Logo + Title – positioned near main content area */}
            <div className="ml-4 md:ml-0 flex items-center gap-2 sm:gap-3 shrink-0">
              <Image
                src={logo}
                alt="Pop Up Advertising And Information Enterprise"
                width={40}
                height={40}
                priority
              />
              <div className="hidden sm:block">
                <p
                  className={`text-base font-semibold leading-tight transition-colors ${
                    isDark ? "text-dark-text" : "text-dark-charcoal"
                  }`}
                >
                  Flood Management
                </p>
                <p className="text-xs uppercase tracking-wide text-primary-blue dark:text-[var(--color-brand-soft)]">
                  IoT Command Center
                </p>
              </div>
            </div>
          </div>

          {/* Center - Search Button */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className={`flex flex-1 min-w-0 max-w-md items-center gap-2 sm:gap-3 rounded-full border px-2 sm:px-4 py-2.5 text-sm transition shrink ${
              isDark
                ? "border-dark-border bg-dark-bg/50 text-dark-text-muted hover:border-primary-blue/50 hover:bg-dark-card"
                : "border-light-grey bg-very-light-grey/50 text-dark-charcoal/50 hover:border-primary-blue/50 hover:bg-pure-white hover:shadow-sm"
            }`}
          >
            <SearchIcon className="h-5 w-5 shrink-0" />
            <span className="hidden sm:inline flex-1 text-left truncate min-w-0">Search pages...</span>
            <kbd
              className={`hidden lg:inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium shrink-0 ${
                isDark
                  ? "border-dark-border bg-dark-card text-dark-text-muted"
                  : "border-light-grey bg-pure-white text-dark-charcoal/50"
              }`}
            >
              <span className="text-xs">⌘</span>K
            </kbd>
          </button>

          {/* Right side actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Single notification bell — live SSE-style flood alerts with sound + dropdown.
                The previous static "/alerts" link was removed because it duplicated the
                dropdown's own "View all alerts" affordance. */}
            <NotificationBell />
            <Link
              href="/settings"
              className={`hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                isDark
                  ? "border-dark-border text-dark-text hover:text-primary-blue hover:border-primary-blue"
                  : "border-light-grey text-dark-charcoal hover:text-primary-blue hover:border-primary-blue"
              }`}
              aria-label="Settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>

            {/* Profile card with user info and dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                className={`relative flex shrink-0 items-center gap-2 rounded-xl border border-primary-blue px-2 sm:px-3 py-1.5 transition ${
                  isDark
                    ? "bg-dark-card hover:bg-primary-blue/10"
                    : "bg-pure-white hover:bg-light-blue/30"
                }`}
              >
                {/* Avatar: photo if available, else initials */}
                {user?.avatarUrl ? (
                  <div className="h-8 w-8 rounded-lg border border-primary-blue overflow-hidden flex-shrink-0">
                    <Image
                      src={user.avatarUrl}
                      alt={user.name || "Profile"}
                      width={32}
                      height={32}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary-blue bg-primary-blue text-xs font-bold text-pure-white flex-shrink-0">
                    {getUserInitials()}
                  </div>
                )}
                <div className="hidden sm:block text-left">
                  <p
                    className={`text-xs font-semibold leading-tight ${
                      isDark ? "text-dark-text" : "text-dark-charcoal"
                    }`}
                  >
                    {user?.name || "User"}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-green" />
                    <span
                      className={`text-[10px] ${
                        isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"
                      }`}
                    >
                      {user?.role || "User"}
                    </span>
                  </div>
                </div>
              </button>

              {/* Dropdown Menu */}
              {isProfileDropdownOpen && (
                <div
                  className={`absolute right-0 top-full mt-2 w-48 rounded-xl border shadow-lg transition-colors ${
                    isDark
                      ? "border-dark-border bg-dark-card"
                      : "border-light-grey bg-pure-white"
                  }`}
                >
                  <div className={`p-2 border-b ${isDark ? "border-dark-border" : "border-light-grey"}`}>
                    <p
                      className={`text-sm font-semibold ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}
                    >
                      {user?.name}
                    </p>
                    <p
                      className={`text-xs ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}
                    >
                      {user?.email}
                    </p>
                  </div>
                  <div className="p-1">
                    <Link
                      href="/admin"
                      onClick={() => setIsProfileDropdownOpen(false)}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                        isDark
                          ? "text-dark-text hover:bg-dark-bg"
                          : "text-dark-charcoal hover:bg-very-light-grey"
                      }`}
                    >
                      <ProfileIcon className="h-4 w-4" />
                      Account Settings
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary-red transition ${
                        isDark ? "hover:bg-dark-bg" : "hover:bg-very-light-grey"
                      }`}
                    >
                      <LogoutIcon className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Search Modal */}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </>
  );
}

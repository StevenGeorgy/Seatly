// Tracks the most recent URL the user was on OUTSIDE the /account/*
// area, so the AccountShell "Back" button can return there in one
// click instead of unwinding the sub-page history step by step.
//
// Mounted once at the app router level. Every route change checks the
// current pathname — if it's outside /account/*, that URL is captured
// to sessionStorage. AccountShell's Back button reads it on click;
// missing entry (e.g. user opened /account directly) falls back to
// /discover.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "cenaiva.account.originUrl";

export function useTrackOrigin(): void {
  const location = useLocation();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (location.pathname.startsWith("/account")) return;
    const url = `${location.pathname}${location.search}`;
    window.sessionStorage.setItem(STORAGE_KEY, url);
  }, [location.pathname, location.search]);
}

export function getAccountOriginUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

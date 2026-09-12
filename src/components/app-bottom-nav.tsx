"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/dashboard", icon: "⌂", label: "Home" },
  { href: "/path", icon: "✦", label: "Path" },
  { href: "/resources", icon: "▱", label: "Saves" },
  { href: "/progress", icon: "◉", label: "Progress" },
] as const;

const APP_PREFIXES = ["/dashboard", "/path", "/resources", "/progress", "/connections", "/add", "/session"];

export function AppBottomNav() {
  const pathname = usePathname();
  if (!APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  return (
    <nav aria-label="Mobile application navigation" className="app-bottom-nav md:hidden">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={item.href} key={item.href}><span aria-hidden>{item.icon}</span><small>{item.label}</small></Link>;
      })}
    </nav>
  );
}

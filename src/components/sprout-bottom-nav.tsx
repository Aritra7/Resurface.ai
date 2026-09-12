"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  ["⌂", "Home", "/"],
  ["✦", "My path", "/path"],
  ["▱", "Saves", "/resources"],
  ["◉", "Progress", "/progress"],
] as const;

export function SproutBottomNav() {
  const pathname = usePathname();
  return <nav className="sprout-bottom-nav" aria-label="Main navigation">{tabs.map(([icon, label, href]) => <Link className={pathname === href ? "active" : ""} href={href} key={href}><span>{icon}</span><small>{label}</small></Link>)}</nav>;
}

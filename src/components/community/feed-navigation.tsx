import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";

export type FeedView = "all" | "photos" | "resident" | "events";
const views: { value: FeedView; label: string; icon: IconName }[] = [
  { value: "all", label: "Вся лента", icon: "message" },
  { value: "photos", label: "В объективе", icon: "camera" },
  { value: "resident", label: "От жителей", icon: "pin" },
  { value: "events", label: "Куда сходить", icon: "sun" },
];

export function FeedNavigation({ activeView, onView, hasEvents = true }: {
  activeView?: FeedView | null; onView?: (view: FeedView) => void; hasEvents?: boolean;
}) {
  return <nav className="ch-feedbar cm-container" aria-label="Пульс города">
    <span className="ch-feedbar-title"><svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 18h7l4-9 6 15 4-6h7" /></svg><span>Пульс города<small>Выберите, что вам близко</small></span></span>
    <div className="ch-feed-links">
      {views.filter(view => hasEvents || view.value !== "events").map(view => onView
        ? <button key={view.value} type="button" className={activeView === view.value ? "is-active" : ""} aria-pressed={activeView === view.value} onClick={() => onView(view.value)}><Icon name={view.icon} size={17} />{view.label}</button>
        : <Link key={view.value} href={view.value === "all" ? "/#community-feed" : `/?view=${view.value}#community-feed`}><Icon name={view.icon} size={17} />{view.label}</Link>)}
    </div>
  </nav>;
}

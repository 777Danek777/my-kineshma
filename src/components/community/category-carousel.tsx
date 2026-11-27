"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { advanceCarousel } from "@/lib/carousel-motion";

const motionQuery = "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback); document.addEventListener("visibilitychange", callback);
  return () => { media.removeEventListener("change", callback); document.removeEventListener("visibilitychange", callback); };
}
const motionSnapshot = () => !document.hidden && window.matchMedia(motionQuery).matches;
const serverSnapshot = () => false;

export function CategoryCarousel({ categories, activeCategory, onCategory }: {
  categories: string[]; activeCategory: string | null; onCategory: (category: string | null) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const direction = useRef<1 | -1>(1);
  const maximum = useRef(0);
  const drag = useRef<{ id: number; x: number; start: number; moved: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const [edges, setEdges] = useState({ left: false, right: false });
  const previousEdges = useRef({ left: false, right: false });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const motionAllowed = useSyncExternalStore(subscribeMotion, motionSnapshot, serverSnapshot);
  const overflows = edges.left || edges.right;
  useEffect(() => {
    const view = viewport.current; const content = track.current;
    if (!view || !content) return;
    const updateEdges = () => {
      const left = view.scrollLeft > 1; const right = maximum.current - view.scrollLeft > 1;
      if (previousEdges.current.left !== left || previousEdges.current.right !== right) {
        previousEdges.current = { left, right }; setEdges({ left, right });
      }
    };
    const measure = () => { maximum.current = Math.max(0, view.scrollWidth - view.clientWidth); updateEdges(); };
    const resize = new ResizeObserver(measure); resize.observe(view); resize.observe(content);
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    intersection.observe(view); view.addEventListener("scroll", updateEdges, { passive: true });
    return () => { resize.disconnect(); intersection.disconnect(); view.removeEventListener("scroll", updateEdges); };
  }, []);
  useEffect(() => {
    const view = viewport.current; const button = track.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!view || !button) return;
    const rect = button.getBoundingClientRect(); const bounds = view.getBoundingClientRect();
    if (rect.left < bounds.left) view.scrollLeft -= bounds.left - rect.left + 8;
    else if (rect.right > bounds.right) view.scrollLeft += rect.right - bounds.right + 8;
  }, [activeCategory]);
  useEffect(() => {
    const view = viewport.current;
    if (!view || !motionAllowed || !overflows || !visible || hovered || focused || paused) return;
    let frame = 0; let previous = 0; let holdUntil = 0; let position = view.scrollLeft;
    const move = (time: number) => {
      if (previous && time >= holdUntil) {
        const next = advanceCarousel(position, direction.current, Math.min(time - previous, 48) * 0.022, maximum.current);
        position = next.position; view.scrollLeft = position;
        if (next.direction !== direction.current) holdUntil = time + 1100;
        direction.current = next.direction;
      }
      previous = time; frame = window.requestAnimationFrame(move);
    };
    frame = window.requestAnimationFrame(move);
    return () => window.cancelAnimationFrame(frame);
  }, [motionAllowed, overflows, visible, hovered, focused, paused, activeCategory]);
  function step(side: 1 | -1) {
    setPaused(true);
    viewport.current?.scrollBy({ left: side * Math.max(120, viewport.current.clientWidth * 0.65), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  function endDrag() {
    if (drag.current?.moved) suppressClickUntil.current = Date.now() + 300;
    drag.current = null; viewport.current?.classList.remove("is-dragging");
  }
  return <div className="cm-category-carousel" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={event => setFocused(event.target.matches(":focus-visible"))} onKeyDownCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <button className="cm-rail-arrow cm-rail-arrow--back" type="button" aria-label="Предыдущие темы" disabled={!edges.left} onClick={() => step(-1)}><Icon name="chevron" size={16} /></button>
    <div ref={viewport} className="cm-category-viewport" data-left={edges.left || undefined} data-right={edges.right || undefined}
      onPointerDown={event => { if (event.pointerType === "mouse" && event.button === 0) drag.current = { id: event.pointerId, x: event.clientX, start: event.currentTarget.scrollLeft, moved: false }; }}
      onPointerMove={event => {
        const current = drag.current; if (!current || current.id !== event.pointerId) return;
        if (!current.moved && Math.abs(event.clientX - current.x) < 6) return;
        if (!current.moved) { current.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add("is-dragging"); setPaused(true); }
        event.preventDefault(); event.currentTarget.scrollLeft = current.start - (event.clientX - current.x);
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onPointerLeave={() => { if (drag.current && !drag.current.moved) endDrag(); }}
      onClickCapture={event => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
      onTouchStart={() => setPaused(true)}>
      <div ref={track} className="cm-category-track" role="group" aria-label="Темы публикаций">
        {[null, ...categories].map(name => <button type="button" key={name ?? "all"} className={activeCategory === name ? "is-active" : ""} aria-pressed={activeCategory === name} onClick={() => onCategory(name)}>{name ?? "Всё"}</button>)}
      </div>
    </div>
    <button className="cm-rail-arrow" type="button" aria-label="Следующие темы" disabled={!edges.right} onClick={() => step(1)}><Icon name="chevron" size={16} /></button>
    <button className="cm-rail-play" type="button" aria-label={paused ? "Включить движение тем" : "Остановить движение тем"} title={paused ? "Включить движение тем" : "Остановить движение тем"} aria-pressed={paused} disabled={!overflows} onClick={() => setPaused(!paused)}>
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">{paused ? <path d="m6 3 10 7-10 7Z" /> : <path d="M5 3h3v14H5zm7 0h3v14h-3Z" />}</svg>
    </button>
  </div>;
}

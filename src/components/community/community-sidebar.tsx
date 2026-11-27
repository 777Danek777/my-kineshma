"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

export function CommunitySidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const releaseScroll = useRef<(() => void) | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    const opener = trigger.current;
    const desktop = window.matchMedia("(min-width: 851px)");
    let released = false;
    const unlock = () => { if (!released) { released = true; document.body.style.overflow = previousOverflow; } };
    releaseScroll.current = unlock;
    const resized = () => { if (desktop.matches) dialog.close(); };
    dialog.showModal(); document.body.style.overflow = "hidden";
    desktop.addEventListener("change", resized);
    return () => {
      desktop.removeEventListener("change", resized);
      if (dialog.open) dialog.close();
      unlock(); releaseScroll.current = null;
      if (!desktop.matches && opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus({ preventScroll: true });
    };
  }, [open]);
  return <>
    <aside className="cm-sidebar cm-sidebar--desktop" aria-label="Городское сообщество" tabIndex={0}>
      <div className="cm-sidebar-heading"><span className="cm-presence-dot" aria-hidden="true" />Город рядом<Icon name="pin" size={16} /></div>
      {children}
    </aside>
    <button ref={trigger} className="cm-community-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "community-sheet" : undefined} onClick={() => setOpen(true)}><Icon name="pin" size={19} /><span>Город рядом</span></button>
    {open && <dialog ref={dialogRef} id="community-sheet" className="cm-community-sheet" aria-labelledby="community-sheet-title" onClose={() => setOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}>
      <div className="cm-sheet-heading"><div><span className="cm-eyebrow">МОЯ КИНЕШМА</span><h2 id="community-sheet-title">Город рядом</h2></div><button type="button" autoFocus aria-label="Закрыть городскую панель" onClick={() => dialogRef.current?.close()}><Icon name="close" size={21} /></button></div>
      <div className="cm-sidebar cm-sidebar--sheet" onClickCapture={event => {
        if (event.target instanceof Element && event.target.closest("a,button")) { releaseScroll.current?.(); dialogRef.current?.close(); }
      }}>{children}</div>
    </dialog>}
  </>;
}

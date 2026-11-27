"use client";

import { useEffect, useId, useRef, useState, type AriaAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import "./theme-select.css";

export type ThemeSelectOption = { value: string; label: string; disabled?: boolean };
type ThemeSelectProps = {
  id?: string;
  name?: string;
  form?: string;
  value: string;
  options: readonly ThemeSelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  variant?: "field" | "quiet";
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};
type Placement = { left: number; top: number; width: number; maxHeight: number; above: boolean };

/** A select-only combobox. The clipped select retains native form validation and FormData. */
export function ThemeSelect({ id, name, form, value, options, onValueChange, disabled = false, required = false, variant = "field", placeholder = "Выберите вариант", className = "", ...aria }: ThemeSelectProps) {
  const generatedId = useId();
  const controlId = id ?? `theme-select-${generatedId}`;
  const listId = `${controlId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [active, setActive] = useState(-1);
  const [validationRequested, setValidationRequested] = useState(false);
  const selected = options.findIndex(option => option.value === value);
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const open = placement !== null && !disabled;
  const invalid = validationRequested && required && (selected < 0 || value === "");
  const description = [aria["aria-describedby"], invalid ? `${controlId}-error` : null].filter(Boolean).join(" ") || undefined;
  // A control disabled by its form must not reopen when the request finishes.
  if (disabled && placement !== null) setPlacement(null);

  function close(restoreFocus = false) {
    setPlacement(null);
    search.current = { text: "", time: 0 };
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function show(index = selected >= 0 && !options[selected].disabled ? selected : enabled[0] ?? -1) {
    if (disabled || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
    const topEdge = (viewport?.offsetTop ?? 0) + 8;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.min(Math.max(rect.width, 228), Math.max(0, viewportWidth - 16));
    const below = topEdge + viewportHeight - 16 - rect.bottom - 6;
    const aboveSpace = rect.top - topEdge - 6;
    const above = below < Math.min(240, options.length * 44 + 12) && aboveSpace > below;
    const available = above ? aboveSpace : below;
    const cramped = available < 88;
    setActive(index);
    setPlacement({
      left: Math.max(leftEdge, Math.min(rect.left, leftEdge + viewportWidth - 16 - width)),
      top: cramped ? topEdge : above ? rect.top - 6 : rect.bottom + 6,
      width,
      maxHeight: Math.max(0, Math.min(336, cramped ? viewportHeight - 16 : available)),
      above: !cramped && above,
    });
  }

  function commit(index: number, restoreFocus = true) {
    const option = options[index];
    if (option && !option.disabled) {
      onValueChange(option.value);
      setValidationRequested(false);
    }
    close(restoreFocus);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
    const position = enabled.indexOf(active);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (event.altKey && event.key === "ArrowUp" && open) { commit(active); return; }
        if (!open) show(selected >= 0 && !options[selected].disabled ? selected : event.key === "ArrowUp" ? enabled.at(-1) ?? -1 : enabled[0] ?? -1);
        else setActive(enabled[Math.max(0, Math.min(enabled.length - 1, position + (event.key === "ArrowDown" ? 1 : -1)))] ?? -1);
        return;
      }
      case "Home":
      case "End": {
        event.preventDefault();
        const next = event.key === "Home" ? enabled[0] ?? -1 : enabled.at(-1) ?? -1;
        if (open) setActive(next); else show(next);
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(active); else show();
        return;
      case "Escape":
        if (open) { event.preventDefault(); event.stopPropagation(); close(true); }
        return;
      case "Tab":
        if (open) commit(active, false);
        return;
    }
    if (event.altKey || event.key.length !== 1) return;
    event.preventDefault();
    const now = Date.now();
    const character = event.key.toLocaleLowerCase("ru");
    const previous = now - search.current.time < 700 ? search.current.text : "";
    const text = previous + character;
    search.current = { text, time: now };
    const prefix = [...text].every(letter => letter === character) ? character : text;
    const current = open ? active : selected;
    const start = Math.max(0, enabled.indexOf(current) + (prefix.length === 1 ? 1 : 0));
    const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
    const next = ordered.find(index => options[index].label.toLocaleLowerCase("ru").startsWith(prefix));
    if (open) { if (next !== undefined) setActive(next); }
    else show(next ?? (selected >= 0 ? selected : enabled[0] ?? -1));
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = () => { setPlacement(null); search.current = { text: "", time: 0 }; };
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !trigger.current?.contains(target) && !list.current?.contains(target)) dismiss();
    };
    const scroll = (event: Event) => {
      // Only scroll containers that move the trigger invalidate its placement.
      // Sibling carousels and the popup's own scroll must leave the menu open.
      const target = event.target;
      if (target === document || target === window || (target instanceof Element && trigger.current && target.contains(trigger.current))) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.visualViewport?.addEventListener("resize", dismiss);
    window.visualViewport?.addEventListener("scroll", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.visualViewport?.removeEventListener("resize", dismiss);
      window.visualViewport?.removeEventListener("scroll", dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const option = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    const menu = list.current;
    if (!option || !menu) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [active, open]);

  return <span className={`theme-select theme-select--${variant} ${className}`}>
    <button ref={trigger} id={controlId} type="button" className="theme-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined} aria-required={required || undefined} aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]} aria-describedby={description} aria-invalid={invalid || aria["aria-invalid"]} disabled={disabled} onKeyDown={onKeyDown} onClick={() => open ? close() : show()}>
      <span className="theme-select-value">{options[selected]?.label ?? placeholder}</span>
      <svg className="theme-select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <select className="theme-select-native" tabIndex={-1} aria-hidden="true" name={name} form={form} value={value} required={required} disabled={disabled} onFocus={() => trigger.current?.focus({ preventScroll: true })} onChange={event => { onValueChange(event.target.value); setValidationRequested(false); }} onInvalid={event => { event.preventDefault(); setValidationRequested(true); trigger.current?.focus(); }}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    {invalid && <span id={`${controlId}-error`} className="theme-select-error" role="alert">Выберите вариант.</span>}
    {open && placement && createPortal(<div ref={list} id={listId} className="theme-select-popup" role="listbox" aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"] ?? (!aria["aria-label"] ? controlId : undefined)} style={{ left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight, transform: placement.above ? "translateY(-100%)" : undefined }} onMouseDown={event => event.preventDefault()} onKeyDown={onKeyDown}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-index={index} data-active={active === index || undefined} className="theme-select-option" onPointerMove={event => { if (event.pointerType === "mouse" && !option.disabled) setActive(index); }} onClick={() => { if (!option.disabled) commit(index); }}>
        <span>{option.label}</span><span className="theme-select-check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
      </div>)}
      {!options.length && <div className="theme-select-empty">Нет доступных вариантов</div>}
    </div>, document.body)}
  </span>;
}

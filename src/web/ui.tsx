import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export const tap =
  "transition-[scale,background-color,color,opacity] duration-150 ease-out active:scale-[0.96] disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Global Escape-to-dismiss shared by every overlay layer. */
function useEscapeToDismiss(open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4 text-[13px] font-semibold leading-none text-ink-tertiary">
      {children}
    </div>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-surface p-1">{children}</div>;
}

export function Hairline({ inset = true }: { inset?: boolean }) {
  return <div className={`${inset ? "ms-9" : "mx-1"} h-px bg-separator`} role="presentation" />;
}

export function RowButton({
  children,
  className = "",
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[15px] leading-tight ${tap} ${focusRing} ${
        active ? "bg-surface-selected text-accent" : "text-ink hover:bg-surface-hover"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Interruptible popover: stays mounted so open/close can reverse mid-flight. */
export function PopoverLayer({
  open,
  onDismiss,
  labelledBy,
  label,
  placement,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  labelledBy?: string;
  label?: string;
  placement: "top" | "bottom";
  children: ReactNode;
}) {
  const place = placement === "top" ? "top-full mt-1 origin-top" : "bottom-full mb-1 origin-bottom";
  const hiddenY = placement === "top" ? "translate-y-2" : "-translate-y-2";
  useEscapeToDismiss(open, onDismiss);
  return (
    <>
      <div
        inert={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`fixed inset-0 z-10 bg-ink/20 transition-opacity ease-out motion-reduce:transition-none ${
          open ? "duration-200 opacity-100" : "duration-150 opacity-0"
        }`}
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-hidden={!open}
        inert={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`absolute inset-x-0 z-20 flex max-h-[min(28rem,70vh)] flex-col overflow-hidden rounded-xl bg-surface shadow-popover transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none ${place} ${
          open
            ? "translate-y-0 scale-100 opacity-100 duration-200"
            : `${hiddenY} scale-[0.98] opacity-0 duration-150`
        }`}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Overlay drawer anchored to the leading edge of its positioned parent.
 * Stays mounted so open/close can reverse mid-flight (CSS transitions).
 */
export function DrawerLayer({
  open,
  onDismiss,
  labelledBy,
  label,
  id,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  labelledBy?: string;
  label?: string;
  id?: string;
  children: ReactNode;
}) {
  useEscapeToDismiss(open, onDismiss);
  return (
    <>
      <div
        inert={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`absolute inset-0 z-10 bg-ink/20 transition-opacity ease-out motion-reduce:transition-none ${
          open ? "duration-200 opacity-100" : "duration-150 opacity-0"
        }`}
        onClick={onDismiss}
      />
      <div
        id={id}
        role="dialog"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`absolute inset-y-2 start-2 z-20 flex w-[min(20rem,calc(100%-1rem))] flex-col overflow-hidden rounded-xl bg-surface shadow-sheet outline-none transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none overscroll-contain ${
          open
            ? "translate-x-0 opacity-100 duration-200"
            : "-translate-x-full opacity-0 duration-150"
        }`}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Centered modal dialog over a dimmed backdrop. Stays mounted so open/close
 * can reverse mid-flight (CSS transitions); Escape and backdrop click dismiss.
 */
export function ModalLayer({
  open,
  onDismiss,
  labelledBy,
  label,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  labelledBy?: string;
  label?: string;
  children: ReactNode;
}) {
  useEscapeToDismiss(open, onDismiss);
  return (
    <>
      <div
        inert={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
        className={`fixed inset-0 z-30 bg-ink/20 transition-opacity ease-out motion-reduce:transition-none ${
          open ? "duration-200 opacity-100" : "duration-150 opacity-0"
        }`}
        onClick={onDismiss}
      />
      <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-hidden={!open}
          inert={!open}
          style={{ pointerEvents: open ? "auto" : "none" }}
          className={`w-full max-w-sm rounded-[20px] bg-surface p-5 shadow-sheet transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none ${
            open
              ? "translate-y-0 scale-100 opacity-100 duration-200"
              : "translate-y-1 scale-[0.98] opacity-0 duration-150"
          }`}
        >
          {children}
        </div>
      </div>
    </>
  );
}

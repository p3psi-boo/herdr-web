/** One currentColor SVG set. Outline is default; fill marks the active state. */

const svg = {
  viewBox: "0 0 16 16",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  className: "size-4 shrink-0",
};

export function PlusIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13 13" />
    </svg>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M8 2.6a3.1 3.1 0 0 0-3.1 3.1c0 2.1-1.1 3.2-1.1 3.2h8.4s-1.1-1.1-1.1-3.2A3.1 3.1 0 0 0 8 2.6Z" />
      <path d="M6.5 12.4a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function BellFillIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className ?? "size-4 shrink-0"}
      fill="currentColor"
    >
      <path d="M8 1.8a3.5 3.5 0 0 0-3.5 3.5c0 1.7-.7 2.7-1.15 3.3-.3.4-.45.6-.45.9 0 .3.24.5.6.5h9c.36 0 .6-.2.6-.5 0-.3-.15-.5-.45-.9-.45-.6-1.15-1.6-1.15-3.3A3.5 3.5 0 0 0 8 1.8Zm-1.3 11.1a1.3 1.3 0 0 0 2.6 0H6.7Z" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M4.5 6.2 8 9.8l3.5-3.6" />
    </svg>
  );
}

export function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M3.5 10 8 5.5l4.5 4.5" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M3.5 6 8 10.5l4.5-4.5" />
    </svg>
  );
}

export function LaptopIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <rect x="3" y="3.2" width="10" height="7.2" rx="1.2" />
      <path d="M2.4 12.8h11.2" />
    </svg>
  );
}

export function ServerIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <rect x="2.6" y="3" width="10.8" height="4" rx="1" />
      <rect x="2.6" y="9" width="10.8" height="4" rx="1" />
      <path d="M5 5h.01M5 11h.01" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M3.4 8.2 6.5 11.2 12.6 4.8" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg {...svg} className={className ?? svg.className}>
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </svg>
  );
}

const STATUS_FILL: Record<string, string> = {
  working: "bg-warning",
  blocked: "bg-danger",
  idle: "bg-success",
  done: "bg-ink-tertiary",
  unknown: "bg-separator",
  connecting: "bg-warning",
  connected: "bg-success",
  disconnected: "bg-separator",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_FILL[status] ?? STATUS_FILL.unknown}`}
      title={status}
    />
  );
}

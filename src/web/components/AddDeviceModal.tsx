import { useEffect, useId, useRef, useState } from "react";
import { appClient } from "../ws.ts";
import { useStore } from "../store.ts";
import { CheckIcon, SearchIcon, ServerIcon } from "../icons.tsx";
import { Hairline, ModalLayer, focusRing, tap } from "../ui.tsx";

const field =
  "w-full rounded-xl bg-canvas px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-tertiary sm:text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Interruptible modal: stays mounted so open/close can reverse mid-flight (CSS transitions). */
export function AddDeviceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const devices = useStore((s) => s.devices);
  const sshHosts = useStore((s) => s.sshHosts);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [sshQuery, setSshQuery] = useState("");
  const titleId = useId();
  const sshSearchId = useId();
  const nameId = useId();
  const hostId = useId();
  const sshSearchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const existing = new Set(devices.map((d) => d.host));
  const suggestions = sshHosts.filter((h) => !existing.has(h.alias));
  const hasSuggestions = suggestions.length > 0;
  const normalizedQuery = sshQuery.trim().toLowerCase();
  const filteredSuggestions = normalizedQuery
    ? suggestions.filter((h) =>
        [h.alias, h.user, h.hostName, h.port]
          .some((value) => value?.toLowerCase().includes(normalizedQuery)),
      )
    : suggestions;

  // Reset the form and re-request hosts every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setHost("");
    setSshQuery("");
    appClient.requestSshHosts();
  }, [open]);

  // Persistently mounted, so autoFocus won't fire: focus manually once the
  // open transition starts. Search box wins when SSH suggestions exist.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      (hasSuggestions ? sshSearchRef : nameRef).current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, hasSuggestions]);

  const pick = (alias: string) => {
    setHost(alias);
    if (!name.trim()) setName(alias);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = host.trim();
    if (!h) return;
    appClient.addDevice(name.trim() || h, h);
    onClose();
  };

  return (
    <ModalLayer open={open} onDismiss={onClose} labelledBy={titleId}>
      <form onSubmit={submit}>
        <div id={titleId} className="mb-4 text-[17px] font-semibold tracking-tight text-ink text-balance">
          Add Device
        </div>

        {hasSuggestions && (
          <>
            <div className="mb-1.5 px-1 text-[13px] font-semibold text-ink-tertiary">From SSH config</div>
            <label htmlFor={sshSearchId} className="sr-only">Search SSH config</label>
            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
              <input
                id={sshSearchId}
                ref={sshSearchRef}
                type="search"
                value={sshQuery}
                onChange={(e) => setSshQuery(e.target.value)}
                placeholder="Search SSH hosts"
                className={`${field} ps-9`}
              />
            </div>
            <div className="mb-4 max-h-44 overflow-y-auto rounded-xl bg-canvas p-1">
              {filteredSuggestions.map((h, i) => (
                <div key={h.alias}>
                  {i > 0 && <Hairline />}
                  <button
                    type="button"
                    onClick={() => pick(h.alias)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start hover:bg-surface-hover ${tap} ${focusRing} ${
                      host === h.alias ? "bg-surface-selected" : ""
                    }`}
                  >
                    <ServerIcon className="size-4 text-ink-secondary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{h.alias}</span>
                      {(h.user || h.hostName) && (
                        <span className="block truncate text-[13px] text-ink-tertiary">
                          {[h.user, h.hostName].filter(Boolean).join("@")}
                          {h.port ? `:${h.port}` : ""}
                        </span>
                      )}
                    </span>
                    {host === h.alias && <CheckIcon className="size-4 text-accent" />}
                  </button>
                </div>
              ))}
              {filteredSuggestions.length === 0 && (
                <div role="status" className="px-2 py-3 text-center text-[13px] text-ink-tertiary">
                  No matching SSH hosts
                </div>
              )}
            </div>
          </>
        )}

        <label htmlFor={nameId} className="mb-1 block px-1 text-[13px] font-semibold text-ink-tertiary">
          Name
        </label>
        <input
          id={nameId}
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="studio"
          className={`mb-3 ${field}`}
        />
        <label htmlFor={hostId} className="mb-1 block px-1 text-[13px] font-semibold text-ink-tertiary">
          SSH host
        </label>
        <input
          id={hostId}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="vincent@10.10.10.87"
          className={`mb-4 ${field}`}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-xl px-4 py-2 text-[15px] text-accent ${tap} ${focusRing}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!host.trim()}
            className={`rounded-xl bg-accent px-4 py-2 text-[15px] font-medium text-accent-fg disabled:opacity-40 ${tap} ${focusRing}`}
          >
            Add
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}

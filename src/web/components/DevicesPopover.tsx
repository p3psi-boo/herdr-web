import { appClient } from "../ws.ts";
import { useStore } from "../store.ts";
import { AddDeviceModal } from "./AddDeviceModal.tsx";
import { CheckIcon, CloseIcon, LaptopIcon, PlusIcon, ServerIcon, StatusDot } from "../icons.tsx";
import { Hairline, PopoverLayer, focusRing, tap } from "../ui.tsx";

export function DevicesPopover() {
  const overlay = useStore((state) => state.overlay);
  const open = overlay.type === "devices";
  const devices = useStore((s) => s.devices);
  const activeDeviceId = useStore((s) => s.activeDeviceId);
  const setOverlay = useStore((state) => state.setOverlay);

  return (
    <>
      <PopoverLayer open={open} onDismiss={() => setOverlay({ type: "none" })} label="Devices" placement="bottom">
        <div className="px-3 pt-3 text-[13px] font-semibold text-ink-tertiary">Devices</div>
        <div className="p-1">
          {devices.map((device, i) => (
            <div key={device.id}>
              {i > 0 && <Hairline />}
              <div className="group flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    appClient.selectDevice(device.id);
                  }}
                  className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-start hover:bg-surface-hover ${tap} ${focusRing}`}
                >
                  <span className="text-ink-secondary">
                    {device.type === "ssh" ? <ServerIcon /> : <LaptopIcon />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[15px] font-medium text-ink">
                      <StatusDot status={device.status} />
                      <span className="truncate">{device.name}</span>
                    </span>
                    <span className="block truncate text-[13px] text-ink-tertiary">
                      {device.type === "ssh" ? device.host : "This Mac"}
                    </span>
                  </span>
                  {device.id === activeDeviceId && (
                    <CheckIcon className="size-4 shrink-0 text-accent" />
                  )}
                </button>
                {device.type === "ssh" && (
                  <button
                    type="button"
                    aria-label={`Remove ${device.name}`}
                    onClick={() => appClient.removeDevice(device.id)}
                    className={`me-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary hover:bg-surface-hover hover:text-danger ${tap} ${focusRing}`}
                  >
                    <CloseIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Hairline inset={false} />
          <button
            type="button"
            onClick={() => setOverlay({ type: "add-device" })}
            className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[15px] text-accent ${tap} ${focusRing} hover:bg-surface-hover`}
          >
            <PlusIcon className="size-4" />
            Add Device
          </button>
        </div>
      </PopoverLayer>
      <AddDeviceModal
        open={overlay.type === "add-device"}
        onClose={() => setOverlay({ type: "none" })}
      />
    </>
  );
}

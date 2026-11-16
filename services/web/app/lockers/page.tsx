"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CircleCheck,
  Wifi,
  Plus,
  LayoutGrid,
  Table2,
  Search,
} from "lucide-react";
import RequireAdminAuth from "../components/RequireAdminAuth";
import { apiUrl, authFetch } from "../lib/auth";
import { getApiErrorMessage } from "../lib/ui";
import { useDeviceManagement } from "../devices/useDeviceManagement";
import DeviceDrawer from "../devices/DeviceDrawer";
import LockersList, { type Locker } from "./LockersList";
import AddLocker from "./AddLocker";
import styles from "./inventory.module.css";

export default function LockersPage() {
  return (
    <RequireAdminAuth>
      <Inventory />
    </RequireAdminAuth>
  );
}
function Inventory() {
  const hardware = useDeviceManagement();
  const [lockers, setLockers] = useState<Locker[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [selection, setSelection] = useState<{
    deviceId: string;
    lockerId: string;
    opener: HTMLElement;
  } | null>(null);
  const inventoryRequest = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inventoryRequest.current?.abort();
    const request = new AbortController();
    inventoryRequest.current = request;
    try {
      const res = await authFetch(apiUrl("/lockers"), {
        cache: "no-store",
        signal: request.signal,
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(getApiErrorMessage(data, "Unable to load inventory"));
      if (!request.signal.aborted) {
        setLockers(data);
        setError("");
      }
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to load inventory");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      try {
        if (localStorage.getItem("locker-inventory-view") === "table")
          setView("table");
      } catch {
        /* optional preference */
      }
      void load();
    }, 0);
    return () => {
      clearTimeout(initial);
      inventoryRequest.current?.abort();
    };
  }, [load]);
  function choose(value: "cards" | "table") {
    setView(value);
    try {
      localStorage.setItem("locker-inventory-view", value);
    } catch {
      /* keep in-memory preference */
    }
  }
  const byLocker = useMemo(
    () => new Map(hardware.devices?.map((d) => [d.lockerId, d])),
    [hardware.devices],
  );
  const linked = selection && byLocker.get(selection.lockerId);
  const owner = selection && lockers?.find((l) => l.id === selection.lockerId);
  const selected =
    linked && owner && linked.id === selection?.deviceId ? linked : undefined;
  const drawerDevice =
    selected && owner
      ? {
          ...selected,
          locker: { code: owner.code },
          unlock: owner.isActive
            ? selected.unlock
            : {
                ...selected.unlock,
                allowed: false,
                blockedReason: "Locker inactive",
              },
        }
      : undefined;
  const stale = !!hardware.connectionError;
  const term = search.trim().toLowerCase();
  const visible = lockers?.filter((l) =>
    [l.code, l.location, byLocker.get(l.id)?.id].some((v) =>
      v?.toLowerCase().includes(term),
    ),
  );
  const metrics = [
    { label: "Total lockers", Icon: Archive, value: lockers?.length },
    {
      label: "Active lockers",
      Icon: CircleCheck,
      value: lockers?.filter((l) => l.isActive).length,
    },
    {
      label: "Online devices",
      Icon: Wifi,
      value: stale ? null : hardware.devices?.filter((d) => d.online).length,
    },
  ];
  async function changed() {
    await Promise.all([load(), hardware.refresh(true)]);
  }
  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory &amp; hardware</p>
          <h1 id="lockers-title" tabIndex={-1} className="page-title">
            Lockers
          </h1>
          <p className="lede">
            Manage inventory, devices, and supervised tests.
          </p>
        </div>
      </header>
      <div className={styles.overview}>
        <dl className={styles.metrics}>
          {metrics.map(({ label, Icon, value }) => (
            <div key={label}>
              <Icon aria-hidden="true" size={19} />
              <dt>{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <button
          className="button"
          onClick={(e) => setAdding(e.currentTarget)}
          aria-haspopup="dialog"
        >
          <Plus size={17} />
          Add locker
        </button>
      </div>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}. <button onClick={() => void load()}>Retry inventory</button>
        </p>
      )}
      {stale && (
        <p role="alert" className="alert alert-error">
          Device updates paused. Requests are disabled until updates resume.
        </p>
      )}
      {notice && (
        <p role="status" className="alert alert-success">
          {notice}
        </p>
      )}
      <div className={styles.toolbar}>
        <h2 className="section-title">Locker inventory</h2>
        <label className={styles.search}>
          <Search size={16} />
          <input
            type="search"
            aria-label="Filter lockers"
            placeholder="Filter lockers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Inventory view" className={styles.switch}>
          {(["cards", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              onClick={() => choose(v)}
            >
              {v === "cards" ? <LayoutGrid size={15} /> : <Table2 size={15} />}{" "}
              {v === "cards" ? "Cards" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {!lockers && !error && <p className="loading-state">Loading lockers…</p>}
      {visible && (
        <LockersList
          lockers={visible}
          view={view}
          byLocker={byLocker}
          loadingHardware={!hardware.devices && !stale}
          stale={stale}
          filtered={!!term}
          changed={changed}
          manage={(deviceId, lockerId, opener) =>
            setSelection({ deviceId, lockerId, opener })
          }
        />
      )}
      {adding && (
        <AddLocker
          opener={adding}
          close={() => setAdding(null)}
          created={() => {
            setAdding(null);
            setNotice("Locker created.");
            changed();
          }}
        />
      )}
      {selection && (
        <DeviceDrawer
          key={selection.deviceId}
          device={drawerDevice}
          opener={selection.opener}
          disconnected={stale || !!error}
          close={() => setSelection(null)}
          busy={hardware.busy}
          feedback={hardware.feedback}
          pulse={hardware.pulse}
          clock={hardware.clock}
          revalidate={hardware.refresh}
        />
      )}
    </main>
  );
}

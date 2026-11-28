import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  available,
  firstStart,
  restoreBookings,
  validSlot,
  type Booking,
  type Locker,
  type Mode,
  type Slot,
} from "./model";
const key = "lockerreserve.demo.bookings.v1";
function useStore() {
  const [mode, setMode] = useState<Mode>("demo");
  const [slot, setSlot] = useState<Slot>(() => ({
    start: firstStart(),
    hours: 2,
  }));
  const [selected, select] = useState<Locker | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key)
      .then(restoreBookings)
      .then((rows) => {
        if (active) {
          setBookings(rows);
          setReady(true);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Saved previews could not be loaded. Retry before checking out.",
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function confirm() {
    if (
      mode !== "demo" ||
      !ready ||
      !selected ||
      !validSlot(slot) ||
      saving.current ||
      !available(slot, bookings).some((l) => l.id === selected.id)
    )
      throw Error("Choose an available demo locker and a future time.");
    saving.current = true;
    try {
      const booking = {
        ...slot,
        id: "preview-" + Date.now().toString(36),
        locker: selected,
      };
      const next = [booking, ...bookings];
      await AsyncStorage.setItem(key, JSON.stringify(next));
      setBookings(next);
      select(null);
      return booking.id;
    } finally {
      saving.current = false;
    }
  }
  return {
    mode,
    changeMode: (value: Mode) => {
      select(null);
      setMode(value);
    },
    slot,
    changeSlot: (value: Slot) => {
      select(null);
      setSlot(value);
    },
    selected,
    select,
    bookings,
    ready,
    error,
    retry: () => retry((n) => n + 1),
    confirm,
  };
}
const Context = createContext<ReturnType<typeof useStore> | null>(null);
export function Provider({ children }: PropsWithChildren) {
  return <Context.Provider value={useStore()}>{children}</Context.Provider>;
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw Error("Missing session");
  return value;
}

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import CreateLockerForm from "./CreateLockerForm";
import styles from "./inventory.module.css";

export default function AddLocker({
  close,
  created,
  opener,
}: {
  close: () => void;
  created: () => void;
  opener: HTMLElement;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector("input")?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d.close();
      document.body.style.overflow = previous;
      opener.focus();
    };
  }, [opener]);
  return (
    <dialog
      className={"confirmation " + styles.modal}
      ref={ref}
      aria-labelledby="add-locker-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="add-locker-title" className="section-title">
          Add locker
        </h2>
        <button
          className={styles.close}
          aria-label="Close add locker"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <CreateLockerForm onChanged={created} />
    </dialog>
  );
}

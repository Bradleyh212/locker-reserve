'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type Question = { title: string; detail?: string; keep: string; confirm: string }

export default function ConfirmAction({ question, onAction, children, disabled, className }: {
  question?: Question; onAction: () => void; children: ReactNode; disabled: boolean; className: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const modal = dialog.current
    const opener = trigger.current
    modal?.showModal()
    modal?.querySelector('button')?.focus()
    return () => { modal?.close(); opener?.focus() }
  }, [open])
  return <>
    <button type="button" ref={trigger} disabled={disabled} className={className}
      aria-haspopup={question ? 'dialog' : undefined}
      onClick={() => question ? setOpen(true) : onAction()}>{children}</button>
    {open && question && <dialog ref={dialog} className="confirmation" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); setOpen(false) }}>
      <h2 id={titleId} className="section-title">{question.title}</h2>
      {question.detail && <p>{question.detail}</p>}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>{question.keep}</button>
        <button type="button" className="button button-danger" disabled={disabled}
          onClick={() => { setOpen(false); onAction() }}>{question.confirm}</button>
      </div>
    </dialog>}
  </>
}

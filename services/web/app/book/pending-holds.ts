import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { apiUrl } from '../lib/auth'

export type Reservation = {
	id: string; lockerId: string; startTime: string; endTime: string; expiresAt: string
	locker: { code: string; location: string }
}

const key = 'locker:pending-checkouts:' + apiUrl('')
const change = 'locker:pending-checkouts-changed'
let fallback = '[]'
let storageBlocked = false

function snapshot() {
	try { if (!storageBlocked) return sessionStorage.getItem(key) ?? '[]' } catch { storageBlocked = true }
	return fallback
}

function parse(raw: string): Reservation[] {
	try {
		const rows: unknown = JSON.parse(raw)
		if (!Array.isArray(rows)) return []
		return rows.filter(r => r && typeof r.id === 'string' && typeof r.lockerId === 'string' &&
			typeof r.locker?.code === 'string' && typeof r.locker.location === 'string' &&
			[r.startTime, r.endTime, r.expiresAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v))))
	} catch { return [] }
}

function write(rows: Reservation[]) {
	fallback = JSON.stringify(rows.filter(r => Date.parse(r.expiresAt) > Date.now()))
	try { sessionStorage.setItem(key, fallback) } catch { storageBlocked = true }
	window.dispatchEvent(new Event(change))
}

export function rememberHold({ id, lockerId, startTime, endTime, expiresAt, locker }: Reservation) {
	write([{ id, lockerId, startTime, endTime, expiresAt, locker: { code: locker.code, location: locker.location } },
		...parse(snapshot()).filter(r => r.id !== id)])
}

export function forgetHold(id: string) { write(parse(snapshot()).filter(r => r.id !== id)) }

function subscribe(update: () => void) {
	window.addEventListener(change, update)
	return () => window.removeEventListener(change, update)
}

export function usePendingHolds() {
	const raw = useSyncExternalStore(subscribe, snapshot, () => '[]')
	const rows = useMemo(() => parse(raw), [raw])
	useEffect(() => {
		if (!rows.length) return
		const expiry = Math.min(...rows.map(r => Date.parse(r.expiresAt)))
		const timer = window.setTimeout(() => write(parse(snapshot())), Math.max(0, expiry - Date.now()))
		return () => clearTimeout(timer)
	}, [rows])
	return rows
}

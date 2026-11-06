'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { loadStripe } from '@stripe/stripe-js'
import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from '@stripe/react-stripe-js'
import { apiUrl } from '../lib/auth'
import { formatDateTime, getApiErrorMessage } from '../lib/ui'

import { forgetHold, rememberHold, usePendingHolds, type Reservation } from './pending-holds'

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
	? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
	: null

type Locker = {
	id: string
	code: string
	location: string
	isActive: boolean
}

export default function BookingPage() {
	const [startTime, setStartTime] = useState('')
	const [endTime, setEndTime] = useState('')
	const [location, setLocation] = useState('')
	const [lockers, setLockers] = useState<Locker[]>([])
	const [selectedLockerId, setSelectedLockerId] = useState('')
	const holds = usePendingHolds()
	const [activeId, setActiveId] = useState('')
	const hold = holds.find(r => r.id === activeId)
	const requesting = useRef(false)
	const [clientSecret, setClientSecret] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [searched, setSearched] = useState(false)
	const [paymentComplete, setPaymentComplete] = useState(false)

	const selectedLocker = useMemo(
		() => lockers.find((locker) => locker.id === selectedLockerId),
		[lockers, selectedLockerId],
	)

	function resetCheckout() {
		setActiveId('')
		setClientSecret(null)
		setPaymentComplete(false)
	}

	function validateDates() {
		if (!startTime || !endTime) {
			return 'Choose a start and end time.'
		}

		if (new Date(endTime) <= new Date(startTime)) {
			return 'End time must be after start time.'
		}

		return null
	}

	async function checkAvailability(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		resetCheckout()

		const validationError = validateDates()

		if (validationError) {
			setError(validationError)
			return
		}

		setLoading(true)
		setSearched(true)

		try {
			const params = new URLSearchParams({
				startTime: new Date(startTime).toISOString(),
				endTime: new Date(endTime).toISOString(),
			})

			if (location.trim()) {
				params.set('location', location.trim())
			}

			const res = await fetch(
				apiUrl(`/public/lockers/availability?${params.toString()}`),
				{ cache: 'no-store' },
			)
			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				setLockers([])
				return
			}

			setLockers(data)
			setSelectedLockerId(data[0]?.id ?? '')
		} catch (e: unknown) {
			setError((e as { message?: string } | null)?.message ?? 'Network error')
			setLockers([])
		} finally {
			setLoading(false)
		}
	}

	async function checkout(existing?: Reservation) {
		if (requesting.current) return
		setError(null)
		resetCheckout()
		if (!existing) {
			const invalid = validateDates()
			if (invalid || !selectedLockerId) { setError(invalid || 'Choose an available locker.'); return }
		}
		requesting.current = true
		setLoading(true)
		try {
			let receipt = existing
			if (!receipt) {
				const range = { lockerId: selectedLockerId, startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString() }
				receipt = holds.find(r => r.lockerId === range.lockerId && r.startTime === range.startTime && r.endTime === range.endTime && Date.parse(r.expiresAt) > Date.now())
				if (!receipt) {
					const res = await fetch(apiUrl('/public/reservations/hold'), {
						method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(range),
					})
					const data = await res.json()
					if (!res.ok) throw new Error(getApiErrorMessage(data, 'Could not create hold.'))
					receipt = data as Reservation
					rememberHold(receipt)
				}
			}
			setActiveId(receipt.id)
			const res = await fetch(apiUrl('/public/payments/create-intent'), {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reservationId: receipt.id }),
			})
			const data = await res.json()
			if (!res.ok) {
				if (res.status === 400 || res.status === 404) forgetHold(receipt.id)
				throw new Error(getApiErrorMessage(data, 'Payment setup failed.'))
			}
			setClientSecret(data.client_secret)
		} catch (e) { setError(e instanceof Error ? e.message : 'Network error') }
		finally { requesting.current = false; setLoading(false) }
	}

	return (
		<main className="public-page">
			<header className="page-header">
				<div>
					<p className="eyebrow">Public booking</p>
					<h1 className="page-title">Reserve a locker</h1>
					<p className="lede">
						Choose a time window, pick an available locker, and complete
						payment to reserve it. No account required.
					</p>
				</div>
				<Link href="/login" className="button button-secondary">
					Admin login
				</Link>
			</header>

			<section className="booking-steps" aria-label="Booking steps">
				<Step number="1" title="Search" body="Choose a reservation period." />
				<Step number="2" title="Hold" body="Select an available locker." />
				<Step number="3" title="Pay" body="Complete checkout with Stripe." />
			</section>

			{holds.filter(r => r.id !== activeId || !clientSecret).map(r => (
				<section key={r.id} className="card card-pad" style={{ marginBottom: 14 }}>
					<h2 className="section-title">Unpaid hold · {r.locker.code}</h2>
					<p>{formatDateTime(r.startTime)} – {formatDateTime(r.endTime)}</p>
					<p className="metric-note">Complete payment before {formatDateTime(r.expiresAt)}.</p>
					<button className="button" disabled={loading} onClick={() => void checkout(r)} style={{ marginTop: 12 }}>Continue payment</button>
				</section>
			))}

			<form onSubmit={checkAvailability} className="card card-pad form-grid">
				<div className="form-grid form-grid-two">
					<label className="field">
						Start time
						<input
							type="datetime-local"
							value={startTime}
							onChange={(e) => setStartTime(e.target.value)}
						/>
					</label>

					<label className="field">
						End time
						<input
							type="datetime-local"
							value={endTime}
							onChange={(e) => setEndTime(e.target.value)}
						/>
					</label>

					<label className="field">
						Location
						<input
							value={location}
							onChange={(e) => setLocation(e.target.value)}
							placeholder="Optional, e.g. Site - Floor 1"
						/>
					</label>
				</div>

				<div className="button-row">
					<button type="submit" className="button" disabled={loading}>
						{loading ? 'Checking...' : 'Check availability'}
					</button>
					{searched ? (
						<p className="metric-note">
							{lockers.length} locker{lockers.length === 1 ? '' : 's'} found
						</p>
					) : null}
				</div>

				{error ? <p className="alert alert-error">{error}</p> : null}
			</form>

			{searched && lockers.length === 0 && !error ? (
				<p className="empty-state" style={{ marginTop: 18 }}>
					No lockers are available for that time range.
				</p>
			) : null}

			{lockers.length > 0 ? (
				<section style={{ marginTop: 24 }}>
					<h2 className="section-title">Choose a locker</h2>
					<div className="grid action-grid">
						{lockers.map((locker) => {
							const selected = locker.id === selectedLockerId

							return (
								<button
									type="button"
									key={locker.id}
									onClick={() => {
										setSelectedLockerId(locker.id)
										resetCheckout()
									}}
									className="card card-pad"
									style={{
										textAlign: 'left',
										borderColor: selected
											? 'var(--primary)'
											: 'var(--border)',
										boxShadow: selected
											? '0 0 0 3px var(--primary-soft)'
											: 'var(--shadow)',
									}}
								>
									<span className="badge badge-success">Available</span>
									<h3 style={{ margin: '12px 0 4px' }}>{locker.code}</h3>
									<p className="metric-note">{locker.location}</p>
								</button>
							)
						})}
					</div>

					<div className="card card-pad" style={{ marginTop: 18 }}>
						<h2 className="section-title">Reservation summary</h2>
						<p className="metric-note">
							{selectedLocker
								? `${selectedLocker.code} at ${selectedLocker.location}`
								: 'Choose a locker to continue.'}
						</p>
						<p className="metric-note">
							{startTime && endTime
								? `${formatDateTime(
										new Date(startTime).toISOString(),
									)} to ${formatDateTime(new Date(endTime).toISOString())}`
								: 'Choose a reservation window.'}
						</p>
						<button
							type="button"
							className="button"
							disabled={loading || !selectedLockerId || Boolean(hold && clientSecret)}
							onClick={() => void checkout()}
							style={{ marginTop: 12 }}
						>
							{loading ? 'Preparing checkout...' : 'Create hold and pay'}
						</button>
					</div>
				</section>
			) : null}

			{hold && clientSecret ? (
				<section className="card card-pad" style={{ marginTop: 24 }}>
					<h2 className="section-title">Checkout</h2>
					<p className="metric-note">
						Hold created for {hold.locker.code}. Complete payment before{' '}
						{formatDateTime(hold.expiresAt)}.
					</p>

					{clientSecret && stripePromise ? (
						<Elements stripe={stripePromise} options={{ clientSecret }}>
							<PublicPaymentForm
								onComplete={() => { forgetHold(hold.id); setClientSecret(null); setPaymentComplete(true) }}
							/>
						</Elements>
					) : (
						<p className="alert alert-error">
							Stripe is not configured for this environment.
						</p>
					)}
				</section>
			) : null}

			{paymentComplete ? (
				<section className="alert alert-success" style={{ marginTop: 18 }}>
					<strong>Payment received.</strong> Your reservation is being finalized.
				</section>
			) : null}
		</main>
	)
}

function Step({
	number,
	title,
	body,
}: {
	number: string
	title: string
	body: string
}) {
	return (
		<article className="step-card">
			<span className="step-number">{number}</span>
			<h2 className="section-title">{title}</h2>
			<p className="metric-note">{body}</p>
		</article>
	)
}

function PublicPaymentForm({ onComplete }: { onComplete: () => void }) {
	const stripe = useStripe()
	const elements = useElements()
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function submitPayment(e: React.FormEvent) {
		e.preventDefault()

		if (!stripe || !elements) {
			return
		}

		setError(null)
		setLoading(true)

		const result = await stripe.confirmPayment({
			elements,
			redirect: 'if_required',
		})

		if (result.error) {
			setError(result.error.message ?? 'Payment failed')
			setLoading(false)
			return
		}

		onComplete()
		setLoading(false)
	}

	return (
		<form onSubmit={submitPayment} className="form-grid" style={{ marginTop: 18 }}>
			<PaymentElement />
			<button
				type="submit"
				className="button"
				disabled={!stripe || loading}
			>
				{loading ? 'Processing...' : 'Submit payment'}
			</button>
			{error ? <p className="alert alert-error">{error}</p> : null}
		</form>
	)
}

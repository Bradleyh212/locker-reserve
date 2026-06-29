'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from '@stripe/react-stripe-js'
import { apiUrl, authFetch } from '../lib/auth'
import { getApiErrorMessage } from '../lib/ui'

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
)

export default function PayReservationButton({
	reservationId,
	onChanged,
}: {
	reservationId: string
	onChanged: () => void | Promise<void>
}) {
	const [clientSecret, setClientSecret] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function startPayment() {
		setError(null)
		setLoading(true)

		try {
			const res = await authFetch(apiUrl('/payments/create-intent'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reservationId }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(getApiErrorMessage(data, `Request failed (${res.status})`))
				return
			}

			setClientSecret(data.client_secret)
		} catch (e: any) {
			setError(e?.message ?? 'Network error')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div>
			<button
				onClick={startPayment}
				disabled={loading}
				className="button"
			>
				{loading ? 'Preparing payment...' : 'Pay'}
			</button>

			{error ? <p className="alert alert-error">{error}</p> : null}

			{clientSecret ? (
				<Elements stripe={stripePromise} options={{ clientSecret }}>
					<PaymentForm onChanged={onChanged} />
				</Elements>
			) : null}
		</div>
	)
}

function PaymentForm({
	onChanged,
}: {
	onChanged: () => void | Promise<void>
}) {
	const stripe = useStripe()
	const elements = useElements()
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [success, setSuccess] = useState(false)

	function refreshReservationAfterPayment() {
		const refreshDelays = [0, 1000, 3000, 6000]

		refreshDelays.forEach((delay) => {
			window.setTimeout(() => {
				void Promise.resolve(onChanged()).catch(() => undefined)
			}, delay)
		})
	}

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

		setSuccess(true)
		refreshReservationAfterPayment()
		setLoading(false)
	}

	if (success) {
		return (
			<p className="alert alert-success" style={{ marginTop: 12 }}>
				Payment completed successfully. Refreshing reservation status...
			</p>
		)
	}

	return (
		<form onSubmit={submitPayment} className="card card-pad" style={{ marginTop: 12 }}>
			<PaymentElement />

			<button
				type="submit"
				disabled={!stripe || loading}
				className="button"
				style={{ marginTop: 12 }}
			>
				{loading ? 'Processing...' : 'Submit payment'}
			</button>

			{error ? <p className="alert alert-error">{error}</p> : null}
		</form>
	)
}

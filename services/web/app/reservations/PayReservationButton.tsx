'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'
import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from '@stripe/react-stripe-js'

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
)

export default function PayReservationButton({
	reservationId,
}: {
	reservationId: string
}) {
	const [clientSecret, setClientSecret] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function startPayment() {
		setError(null)
		setLoading(true)

		try {
			const res = await fetch('http://localhost:3001/payments/create-intent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reservationId }),
			})

			const data = await res.json().catch(() => null)

			if (!res.ok) {
				setError(data?.message ?? `Request failed (${res.status})`)
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
		<div style={{ marginTop: 8 }}>
			<button
				onClick={startPayment}
				disabled={loading}
				style={{
					padding: '8px 14px',
					backgroundColor: '#1f2f1f',
					color: 'white',
					border: '1px solid #44aa44',
					borderRadius: 6,
					cursor: loading ? 'not-allowed' : 'pointer',
					opacity: loading ? 0.7 : 1,
				}}
			>
				{loading ? 'Preparing payment...' : 'Pay'}
			</button>

			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

			{clientSecret ? (
				<Elements stripe={stripePromise} options={{ clientSecret }}>
					<PaymentForm />
				</Elements>
			) : null}
		</div>
	)
}

function PaymentForm() {
	const stripe = useStripe()
	const elements = useElements()
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [success, setSuccess] = useState(false)

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

		setTimeout(() => {
			router.refresh()
		}, 1500)

		setLoading(false)
	}

	if (success) {
		return (
			<p style={{ color: 'green', marginTop: 12 }}>
				Payment completed successfully.
			</p>
		)
	}

	return (
		<form onSubmit={submitPayment} style={{ marginTop: 12 }}>
			<PaymentElement />

			<button
				type="submit"
				disabled={!stripe || loading}
				style={{
					marginTop: 12,
					padding: '8px 14px',
					backgroundColor: '#1f1f1f',
					color: 'white',
					border: '1px solid #555',
					borderRadius: 6,
					cursor: loading ? 'not-allowed' : 'pointer',
				}}
			>
				{loading ? 'Processing...' : 'Submit payment'}
			</button>

			{error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
		</form>
	)
}
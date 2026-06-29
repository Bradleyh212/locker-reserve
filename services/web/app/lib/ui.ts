export type ReservationStatus = 'HOLD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED'

export function formatDateTime(value: string) {
	return new Date(value).toLocaleString([], {
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}

export function getApiErrorMessage(data: any, fallback: string) {
	if (Array.isArray(data?.message)) {
		return data.message.join(', ')
	}

	return data?.message ?? fallback
}

export function getDisplayReservationStatus(reservation: {
	status: string
	expiresAt: string
}) {
	if (
		reservation.status === 'HOLD' &&
		new Date(reservation.expiresAt) <= new Date()
	) {
		return 'EXPIRED'
	}

	return reservation.status
}

export function getReservationStatusClass(status: string) {
	switch (status) {
		case 'HOLD':
			return 'badge badge-warning'
		case 'CONFIRMED':
			return 'badge badge-success'
		case 'CANCELLED':
			return 'badge badge-danger'
		case 'EXPIRED':
			return 'badge badge-muted'
		default:
			return 'badge badge-info'
	}
}

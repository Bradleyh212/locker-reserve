import Link from "next/link";

// Admin visibility of an ID is not proof that the admin owns the customer's payment.
export default function PayReservationButton() {
  return (
    <Link href="/book" className="button">
      Pay with private receipt
    </Link>
  );
}

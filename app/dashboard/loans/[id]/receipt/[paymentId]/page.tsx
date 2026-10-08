import { redirect } from "next/navigation";

// Item 15: receipts print from the thermal route.
export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { paymentId } = await params;
  redirect(`/print/receipt/${paymentId}`);
}

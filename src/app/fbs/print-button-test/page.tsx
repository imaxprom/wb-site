import { notFound } from "next/navigation";
import { PrintButtonPreview } from "./preview";

export default function PrintButtonTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PrintButtonPreview />;
}

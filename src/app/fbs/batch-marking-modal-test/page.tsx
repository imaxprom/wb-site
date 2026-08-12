import { notFound } from "next/navigation";
import { BatchMarkingModalPreview } from "./preview";

export default function BatchMarkingModalTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BatchMarkingModalPreview />;
}

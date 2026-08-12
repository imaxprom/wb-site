import { notFound } from "next/navigation";
import { MarkingStagePreview } from "./preview";

export default function MarkingStageTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MarkingStagePreview />;
}

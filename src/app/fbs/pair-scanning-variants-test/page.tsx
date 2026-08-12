import { notFound } from "next/navigation";
import { PairScanningVariantsPreview } from "./preview";

export default function PairScanningVariantsTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PairScanningVariantsPreview />;
}

import { notFound } from "next/navigation";
import { AssemblyDataMatrixPreview } from "./preview";

export default function AssemblyDataMatrixTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssemblyDataMatrixPreview />;
}

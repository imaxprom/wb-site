import { notFound } from "next/navigation";
import { AssemblyStatusCompactPreview } from "./preview";

export default function AssemblyStatusCompactTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssemblyStatusCompactPreview />;
}

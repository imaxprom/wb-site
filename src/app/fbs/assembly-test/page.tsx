import { notFound } from "next/navigation";
import { AssemblyDesignPreview } from "./preview";

export default function AssemblyTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssemblyDesignPreview />;
}

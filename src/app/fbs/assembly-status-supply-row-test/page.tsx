import { notFound } from "next/navigation";
import { AssemblyStatusSupplyRowPreview } from "./preview";

export default function AssemblyStatusSupplyRowTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssemblyStatusSupplyRowPreview />;
}

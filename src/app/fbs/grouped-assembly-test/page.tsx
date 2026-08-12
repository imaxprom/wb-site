import { notFound } from "next/navigation";
import { GroupedAssemblyPreview } from "./preview";

export default function GroupedAssemblyTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GroupedAssemblyPreview />;
}

import { ReviewSettingsWorkspace } from "@/components/ReviewSettingsWorkspace";

export default function ReviewComplaintsPage() {
  return (
    <ReviewSettingsWorkspace
      tab="auto-complaints"
      title="Автожалобы"
      description="Настройка автоматической подачи жалоб на негативные отзывы."
    />
  );
}

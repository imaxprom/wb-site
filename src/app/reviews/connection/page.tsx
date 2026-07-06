import { ReviewSettingsWorkspace } from "@/components/ReviewSettingsWorkspace";

export default function ReviewConnectionPage() {
  return (
    <ReviewSettingsWorkspace
      tab="connection"
      title="Подключение WB"
      description="API-ключи, токены кабинета, прокси и состояние базы отзывов."
    />
  );
}

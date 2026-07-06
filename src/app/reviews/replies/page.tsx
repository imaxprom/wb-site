import { ReviewSettingsWorkspace } from "@/components/ReviewSettingsWorkspace";

export default function ReviewRepliesPage() {
  return (
    <ReviewSettingsWorkspace
      tab="auto-replies"
      title="Автоответы"
      description="Настройка автоматических ответов на отзывы по оценкам и общей подписи."
    />
  );
}

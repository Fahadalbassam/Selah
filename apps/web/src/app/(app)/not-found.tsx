import { NotFoundMessage } from "@/components/not-found-message";

// A notFound() inside the signed-in app (a record that is missing, or that the
// reader may not open) is drawn inside the app shell, whose top bar has the
// language switch: no second one here (screen re-check of batch 0, fault 1).
export default function NotFound() {
  return <NotFoundMessage />;
}

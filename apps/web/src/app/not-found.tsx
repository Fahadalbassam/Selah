import { CornerLocaleToggle } from "@/components/corner-locale-toggle";
import { NotFoundMessage } from "@/components/not-found-message";

// An address that matches nothing, or a notFound() outside the signed-in app:
// drawn in the root layout alone, with no header, so a signed-out reader who
// lands here in the wrong language can switch. Inside the app, (app)/not-found.tsx.
export default function NotFound() {
  return <NotFoundMessage corner={<CornerLocaleToggle />} />;
}

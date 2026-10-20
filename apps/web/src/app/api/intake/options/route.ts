import { publicRoute } from "@/server/http";
import { intakeOptions } from "@/services/intake";

// The inquiry form's choices. Public.
export const GET = publicRoute({ maxBytes: 0 }, ({ tx }) => intakeOptions(tx));

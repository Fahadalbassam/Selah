// The client's response to a recommendation (F10). What each stance must
// give, held once here for the form and the route; check_recommendation_response()
// in the recommendation_responses migration is the authority, and
// tests/db/recommendation-responses.test.ts proves the two agree.

export const STANCES = ["agree", "partly_agree", "disagree"] as const;
export type Stance = (typeof STANCES)[number];

/** Agreeing (fully or partly) gives the planned action and its date; partly agreeing or disagreeing gives the reason. */
export const STANCE_NEEDS: Record<Stance, { plan: boolean; reason: boolean }> = {
  agree: { plan: true, reason: false },
  partly_agree: { plan: true, reason: true },
  disagree: { plan: false, reason: true },
};

/** Where a recommendation stands with the client (app_recommendation_stances()). "disagree" is the disputed state. */
export type StanceState = Stance | "unconfirmed" | "awaiting";

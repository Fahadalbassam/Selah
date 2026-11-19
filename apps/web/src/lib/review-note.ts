/**
 * What the action page says about who reviews a round the firm sent or
 * recorded (N25, review D5). Nobody reviews work they own or sent, so on a
 * client project with one consultant nobody else on the team can: the firm
 * admin must. This only says so; the rule itself is unchanged (action.review
 * is open to the firm admin, and the database holds the same line).
 *
 *   names      other people on the team review it (named)
 *   firmAdmin  nobody else on the team can, so the firm admin reviews it
 *   nobody     nobody else can, and the reader is the firm admin
 */
export function reviewNote(reviewers: readonly string[], readerIsFirmAdmin: boolean): "names" | "firmAdmin" | "nobody" {
  if (reviewers.length) return "names";
  return readerIsFirmAdmin ? "nobody" : "firmAdmin";
}

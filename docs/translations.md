# Translations

Selah is used in Arabic and English, and people write in either. Text is stored once, in the language it was written in. The other language is made only when someone asks for it, then kept, so a model is called once per text and language, and never for text nobody reads in the other language. Rules in the Translations section of `drizzle/0000_baseline.sql`; `src/services/translations.ts`; the AI service's `POST /v1/translate`.

## What can be translated

| Record | Fields |
|---|---|
| Recommendation | title, rationale, target outcome, required evidence |
| Action | title, description, blocked reason, closure note |
| Finding | title, description |
| Meeting summary | main points |
| Meeting decision | text |
| Progress update | body |
| Assessment answer | comment |
| Assistant answer | content (its owner only; see docs/assistant.md) |

The list lives in `app_translation_source()` and `src/lib/translations.ts`. Anything else is refused. The language of a text is told from its script: Arabic when it has at least as many Arabic letters as Latin ones.

## How it works

`POST /api/translations` with `entityType`, `entityId`, `field` and `to` (`ar` or `en`).

1. The original is read with the caller's own rights. A record they can't see answers 404, the same as one that doesn't exist.
2. If the text is already in the language asked for, the original comes back (`original: true`) and no model is called.
3. A kept translation of exactly this text is returned if there is one. Otherwise the model translates it once and the result is kept with the model's name.
4. If the model is down, the answer is 503 and the original stays on screen.

On screen ("Show in English" / "اعرض بالعربية"), a translation is labelled **Machine translated** with **Show original** next to it. Firm staff can **mark it reviewed** (`PATCH /api/translations/:id`, optionally with corrected text), and then it reads "Translation reviewed by the firm". Recommendations and decisions are governance records: the original language stays the authority.

The first screens with it are the action page (description, progress updates) and the project page (recommendation rationale).

## Rules the database keeps

- **Visibility follows the source.** A translation is readable, and can be made, only by someone who can read the original under row-level security, and only while the original's SHA-256 still matches. A client never sees a translation of a firm-private record.
- **Edits retire translations.** Changing a translated field deletes its translations, and deleting the record deletes all of them (`drop_translations` triggers). Minimal-records purges blank fields the same way, so no old wording outlives the original.
- **Reviews:** only firm staff, and only the text can change; who reviewed it and when are recorded by the database. Nobody deletes a translation from the app.
- **Cost cap:** at most 200 new translations per person an hour (each is a model call).
- **Masking for a hosted model, for every reader:** before text reaches a hosted model its known names become placeholders (docs/assistant.md). A translation never fetches the project's list of names (`app_mask_terms()`, refused for action owners since migration `0087_owner_definers`: it names everyone at the client and the firm). It asks `app_mask_terms_in(project, text)` (migration `0089_mask_terms_in_text`), which gives back only the names written in that text, which the reader already sees there: each as written in the list, or the part of it in the text ("Noura" of "Noura Al-Qahtani"), with a number shared by one person's names instead of a record id, and nothing for a project the reader can't see. The masker (`lib/masking.ts`) then masks with those names exactly as it would with the whole list: the database finds a name at least wherever the masker would (same spellings, prefixes and marks; a test compares both on the same texts). So action owners keep machine translation with a hosted model too.

## Prompt safety

The text is sent as data inside `<text>` tags, escaped so it can't close them, and the model is told not to follow instructions in it. It has no tools. It returns JSON with one field, and an empty or malformed reply is refused (502).

## Not done yet

- No model has been run for this here: tests use a fake translator, and the live check used a stub service. The quality of Arabic from a small local model (qwen3:4b) is unknown and should be checked on sample text before relying on it.
- Meeting and assessment screens don't exist yet, so their translate buttons will come with those screens.

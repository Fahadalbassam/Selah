"use client";

import { useEffect } from "react";

export type ValidityMessages = {
  required: string;
  choose: string;
  email: string;
  url: string;
  format: string;
  tooShort: string;
  tooLong: string;
  tooLow: string;
  tooHigh: string;
};

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const MARK = "data-selah-validity";

function messageFor(el: Field, m: ValidityMessages): string | null {
  const v = el.validity;
  const fill = (s: string, n: string | number) => s.replace("{n}", String(n));
  if (v.valueMissing) return el instanceof HTMLSelectElement || el.type === "radio" || el.type === "checkbox" ? m.choose : m.required;
  if (v.typeMismatch) return el.type === "email" ? m.email : el.type === "url" ? m.url : m.format;
  if (v.tooShort && !(el instanceof HTMLSelectElement)) return fill(m.tooShort, el.minLength);
  if (v.tooLong && !(el instanceof HTMLSelectElement)) return fill(m.tooLong, el.maxLength);
  if (v.rangeUnderflow) return fill(m.tooLow, el.getAttribute("min") ?? "");
  if (v.rangeOverflow) return fill(m.tooHigh, el.getAttribute("max") ?? "");
  if (v.patternMismatch || v.badInput || v.stepMismatch) return m.format;
  return null;
}

/**
 * The browser's own "Please fill out this field." bubble speaks the
 * browser's language, not the page's: an Arabic screen showed it in English
 * and the person didn't see why nothing was saved. This puts the page's
 * words in the bubble for every form. A field the app gave its own message
 * is left alone; ours are cleared on the next input, change or click in the
 * form, so the browser checks the field afresh on the next submit.
 */
export function FormValidity({ messages }: { messages: ValidityMessages }) {
  useEffect(() => {
    function onInvalid(e: Event) {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
      if (el.validity.customError && !el.hasAttribute(MARK)) return;
      const message = messageFor(el, messages);
      if (!message) return;
      el.setCustomValidity(message);
      el.setAttribute(MARK, "");
    }
    function onTouch(e: Event) {
      const el = e.target instanceof Element ? e.target : null;
      const scope = (el && "form" in el && (el as Field).form) || el?.closest("form");
      const marked = scope ? scope.querySelectorAll<Field>(`[${MARK}]`) : [];
      for (const f of [...marked, ...(el?.hasAttribute(MARK) ? [el as Field] : [])]) {
        f.setCustomValidity("");
        f.removeAttribute(MARK);
      }
    }
    document.addEventListener("invalid", onInvalid, true);
    for (const type of ["input", "change", "click"]) document.addEventListener(type, onTouch, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      for (const type of ["input", "change", "click"]) document.removeEventListener(type, onTouch, true);
    };
  }, [messages]);
  return null;
}

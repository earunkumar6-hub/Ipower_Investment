import { startTransition, type FormEvent } from "react";

/**
 * Submit a form to a useActionState action without React's automatic form reset,
 * so the user's input survives a validation error.
 */
export const submitKeepingValues = (action: (form: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  startTransition(() => action(form));
};

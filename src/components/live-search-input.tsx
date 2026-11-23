"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<"input">, "onChange"> & {
  /** Called ~250 ms after typing stops. Default: put the enclosing form's fields in the address (same as submitting it). */
  onSearch?: (value: string, input: HTMLInputElement) => void;
};

/** Search box that updates the list while you type – no Search button needed, the cursor stays where it is. */
export function LiveSearchInput({ onSearch, ...props }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const applied = useRef(String(props.defaultValue ?? "").trim());
  useEffect(() => () => clearTimeout(timer.current), []);

  function search(input: HTMLInputElement) {
    const value = input.value.trim();
    if (value === applied.current) return;
    applied.current = value;
    if (onSearch) return onSearch(value, input);
    const params = new URLSearchParams();
    if (input.form) for (const [k, v] of new FormData(input.form)) if (v) params.set(k, String(v));
    router.replace(params.size ? `${pathname}?${params}` : pathname);
  }

  return (
    <Input
      type="search" autoComplete="off" {...props}
      onChange={(e) => {
        const input = e.currentTarget;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => search(input), 250);
      }}
    />
  );
}

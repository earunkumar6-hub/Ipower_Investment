"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const DEMO_USERS = [
  { username: "arun", label: "Arun · User" },
  { username: "admin", label: "R. Murali · Admin" },
  { username: "superadmin", label: "Owner · Super Admin" },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await authClient.signIn.username({ username, password });
    setBusy(false);
    if (error) return setError(error.message ?? "Login failed");
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-saffron-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Image src="/logo.png" alt="IPower Investments logo" width={96} height={96} priority className="mx-auto" />
          <CardTitle className="text-xl">IPower Investments</CardTitle>
          <CardDescription>Smart Investments For Good Life</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="mt-6 border-t pt-4 text-xs text-muted-foreground">
            <p className="mb-2">Demo users (password <code>demo1234</code>):</p>
            <div className="flex flex-wrap gap-2">
              {DEMO_USERS.map((u) => (
                <Button key={u.username} type="button" variant="outline" size="xs"
                  onClick={() => { setUsername(u.username); setPassword("demo1234"); }}>
                  {u.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

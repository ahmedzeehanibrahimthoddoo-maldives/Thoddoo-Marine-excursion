"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface LoginFormProps {
  mode: "pms" | "cms";
  title: string;
  subtitle: string;
  redirectTo: string;
}

function setAppCookie(mode: "pms" | "cms") {
  document.cookie = `ob-app=${mode}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export default function LoginForm({ mode, title, subtitle, redirectTo }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    setAppCookie(mode);
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginHeader">
          <img src="/images/logo-transparent.png" alt="Thoddoo Marine" className="loginLogo" />
          <h1>THODDOO MARINE</h1>
          <p className="loginAppBadge">{title}</p>
          <p>{subtitle}</p>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="loginError">{error}</div>}
          <div className="formRow">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              required
              placeholder="you@thoddoomarine.mv"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="formRow">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              required
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="loginBtn" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <p className="loginSwitchHint">
            Same credentials for both. Prefer the{" "}
            <a href={mode === "pms" ? "/login/cms" : "/login/pms"}>{mode === "pms" ? "CMS" : "PMS"}</a>?
          </p>
        </form>
      </div>
    </div>
  );
}